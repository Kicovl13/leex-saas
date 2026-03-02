import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../documents/s3.service';
import { MatterActivityService } from '../matter-activity/matter-activity.service';
import { MatterActivityType } from '../../generated/prisma';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TEMPLATE_PREFIX = 'templates';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

/**
 * Escapa caracteres especiales para uso dentro de un nodo de texto XML.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * En Word, un mismo texto (p. ej. {{today_date}}) puede quedar partido en varios
 * nodos w:r/w:t. Docxtemplater interpreta eso como "duplicate open/close tag".
 * Esta función une todos los w:t dentro de cada w:p en un solo run.
 */
function mergeParagraphRunsInDocumentXml(xml: string): string {
  const textRegex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t\s*>/g;
  return xml.replace(/<w:p(\s[^>]*)?>([\s\S]*?)<\/w:p\s*>/g, (fullMatch, attrs, content) => {
    const texts: string[] = [];
    let m: RegExpExecArray | null;
    textRegex.lastIndex = 0;
    while ((m = textRegex.exec(content)) !== null) {
      texts.push(m[1]);
    }
    if (texts.length <= 1) return fullMatch;
    const mergedText = texts.join('');
    const pPrMatch = content.match(/^(\s*(?:<w:pPr[\s\S]*?<\/w:pPr\s*>)?)\s*/);
    const pPr = pPrMatch ? pPrMatch[1] : '';
    const singleRun = mergedText
      ? `<w:r><w:t xml:space="preserve">${escapeXml(mergedText)}</w:t></w:r>`
      : '<w:r><w:t xml:space="preserve"> </w:t></w:r>';
    return `<w:p${attrs || ''}>${pPr}${singleRun}</w:p>`;
  });
}

function getEntryAsText(entry: { asText?: () => string; asNodeBuffer?: () => Buffer }): string | null {
  try {
    if (typeof entry.asText === 'function') return entry.asText();
    if (typeof (entry as { asNodeBuffer?: () => Buffer }).asNodeBuffer === 'function') {
      return (entry as { asNodeBuffer: () => Buffer }).asNodeBuffer().toString('utf-8');
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Aplica merge de runs a todos los XML de word/ (document.xml, headers, footers) para evitar
 * "Duplicate open/close tag" cuando Word parte etiquetas como {{client.name}} en varios runs.
 */
function applyMergeRunsToZip(zip: {
  files: Record<string, unknown>;
  file: (name: string, content: string) => void;
}): void {
  const keys = Object.keys(zip.files);
  for (const key of keys) {
    const norm = key.replace(/\\/g, '/').toLowerCase();
    if (!norm.includes('word/') || !norm.endsWith('.xml')) continue;
    const entry = zip.files[key] as { asText?: () => string; asNodeBuffer?: () => Buffer } | undefined;
    if (!entry) continue;
    const xml = getEntryAsText(entry);
    if (!xml || !xml.includes('<w:p') || !xml.includes('<w:t')) continue;
    try {
      const merged = mergeParagraphRunsInDocumentXml(xml);
      zip.file(key, merged);
    } catch {
      /* ignorar */
    }
  }
}

/** Archivo subido (multer); evita dependencia de Express.Multer. */
export interface UploadedTemplateFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly matterActivity: MatterActivityService,
  ) {}

  async upload(
    organizationId: string,
    file: UploadedTemplateFile,
    name: string,
    description?: string,
    matterType?: string | null,
  ) {
    if (!this.s3.isConfigured()) {
      throw new BadRequestException('S3 no está configurado. No se pueden subir plantillas.');
    }
    const isDocx =
      file.mimetype === DOCX_MIME ||
      file.originalname.toLowerCase().endsWith('.docx');
    if (!isDocx) {
      throw new BadRequestException('Solo se permiten archivos .docx');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('El archivo no puede superar 10 MB');
    }
    const safeName = sanitizeFileName(file.originalname);
    const key = `${organizationId}/${TEMPLATE_PREFIX}/${Date.now()}-${safeName}`;
    await this.s3.putObject(key, file.buffer, DOCX_MIME);
    return this.prisma.template.create({
      data: {
        organizationId,
        name: name.trim() || file.originalname,
        description: description?.trim() || null,
        fileUrl: key,
        matterType: matterType?.trim() || null,
      },
    });
  }

  async findAll(organizationId: string, matterType?: string | null) {
    const where: { organizationId: string; deletedAt: null; OR?: Array<{ matterType: null } | { matterType: string }> } = {
      organizationId,
      deletedAt: null,
    };
    if (matterType != null && matterType !== '') {
      where.OR = [{ matterType: null }, { matterType }];
    }
    return this.prisma.template.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(organizationId: string, id: string) {
    const t = await this.prisma.template.findFirst({
      where: { id, organizationId },
    });
    if (!t) throw new NotFoundException('Plantilla no encontrada.');
    return t;
  }

  async remove(organizationId: string, id: string) {
    const t = await this.findOne(organizationId, id);
    // Opcional: borrar el objeto de S3 (podría dejarse para no romper referencias)
    return this.prisma.template.delete({ where: { id: t.id } });
  }

  /**
   * Genera un .docx rellenando la plantilla con datos del Matter, Client, organización y abogado.
   * Etiquetas: client_name, client_id_number, matter_title, matter_court, matter_amount,
   * matter_file_number, responsible_lawyer, organization_name, today_date (y anidadas client.*, matter.*).
   */
  async generate(
    organizationId: string,
    templateId: string,
    matterId: string,
    userId?: string | null,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const template = await this.findOne(organizationId, templateId);
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId },
      include: {
        client: true,
        responsible: { select: { name: true } },
        organization: { select: { name: true, currency: true, logoUrl: true } },
      },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado.');
    if (!this.s3.isConfigured()) {
      throw new BadRequestException('S3 no está configurado.');
    }
    const docxBuffer = await this.s3.getObject(template.fileUrl);
    const PizZip = require('pizzip');
    const Docxtemplater = require('docxtemplater');
    let zip = new PizZip(docxBuffer);
    applyMergeRunsToZip(zip);
    // Regenerar el zip para que Docxtemplater reciba el XML ya fusionado (PizZip puede no actualizar in-place)
    const mergedBuffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    zip = new PizZip(mergedBuffer);
    const today = new Date();
    const todayStr = today.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const amountNum = matter.amount != null ? Number(matter.amount) : null;
    const currency = matter.organization?.currency ?? 'EUR';
    const matterAmountFormatted =
      amountNum != null
        ? new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(amountNum)
        : '';
    const courtName = matter.courtName ?? matter.matterType ?? '';
    const fileNumber = matter.fileNumber ?? '';
    let organizationLogoUrl: string | null = null;
    if (matter.organization?.logoUrl && this.s3.isConfigured()) {
      organizationLogoUrl = await this.s3.getReadSignedUrl(
        matter.organization.logoUrl,
        3600,
      );
    }
    const templateData: Record<string, unknown> = {
      client_name: matter.client.name ?? '',
      client_id_number: matter.client.taxId ?? '',
      matter_title: matter.name ?? '',
      matter_court: courtName,
      matter_amount: matterAmountFormatted,
      matter_file_number: fileNumber,
      responsible_lawyer: matter.responsible?.name?.trim() ?? '',
      organization_name: matter.organization?.name ?? '',
      organization_logo_url: organizationLogoUrl ?? '',
      today_date: todayStr,
      client: {
        name: matter.client.name ?? '',
        taxId: matter.client.taxId ?? '',
      },
      matter: {
        title: matter.name ?? '',
        court: courtName,
        amount: matterAmountFormatted,
        fileNumber,
      },
    };
    let imageModule: unknown = null;
    if (organizationLogoUrl) {
      templateData.organization_logo = organizationLogoUrl;
      try {
        const ImageModuleClass = require('docxtemplater-image-module-free');
        const sizeOf = require('image-size');
        const LOGO_MAX_WIDTH = 180;
        imageModule = new ImageModuleClass({
          getImage: (tagValue: string) => {
            return fetch(tagValue).then((r) => r.arrayBuffer()).then((ab) => Buffer.from(ab));
          },
          getSize: (img: Buffer) => {
            const dims = sizeOf(img);
            if (!dims.width || !dims.height) return [LOGO_MAX_WIDTH, 60];
            const ratio = LOGO_MAX_WIDTH / dims.width;
            return [LOGO_MAX_WIDTH, Math.round(dims.height * ratio)];
          },
        });
      } catch {
        this.logger.warn('Image module not available; organization_logo will not be embedded.');
      }
    }
    const docOptions: { paragraphLoop: boolean; linebreaks: boolean; modules?: unknown[] } = {
      paragraphLoop: true,
      linebreaks: true,
    };
    if (imageModule) docOptions.modules = [imageModule];
    const doc = new (Docxtemplater as any)(zip, docOptions);
    doc.setData(templateData);
    try {
      if (imageModule) {
        await doc.renderAsync();
      } else {
        doc.render();
      }
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && Array.isArray((err as { properties?: unknown }).properties)
          ? 'La plantilla tiene etiquetas partidas (p. ej. {{client.name}} en varios bloques). Guarda el .docx de nuevo en Word o reescribe las etiquetas sin espacios.'
          : err instanceof Error
            ? err.message
            : 'Error al procesar plantilla';
      throw new BadRequestException(msg);
    }
    const buffer = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    }) as Buffer;
    const safeTitle = matter.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 50);
    const filename = `generado-${safeTitle}-${Date.now()}.docx`;

    await this.matterActivity.create(organizationId, matterId, {
      type: MatterActivityType.NOTE,
      content: `Documento generado desde la plantilla "${template.name}".`,
      metadata: { templateId, templateName: template.name, generatedAt: new Date().toISOString() },
      userId: userId ?? undefined,
    });

    return { buffer, filename };
  }
}
