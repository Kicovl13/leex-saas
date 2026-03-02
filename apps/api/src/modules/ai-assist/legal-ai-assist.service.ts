import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { DeadlinesService } from '../deadlines/deadlines.service';
import { TasksService } from '../tasks/tasks.service';
import { S3Service } from '../documents/s3.service';
import { DeadlineType } from '../../generated/prisma';

const MATERIA_TO_DAYS: Record<string, { contestacion: number; otros: Record<string, number> }> = {
  CIVIL: { contestacion: 15, otros: { audiencia: 10, apelacion: 9 } },
  MERCANTIL: { contestacion: 9, otros: { audiencia: 5, apelacion: 9 } },
  LABORAL: { contestacion: 9, otros: { audiencia: 15, apelacion: 9 } },
  FAMILIAR: { contestacion: 15, otros: { audiencia: 10, apelacion: 9 } },
  ADMINISTRATIVO: { contestacion: 15, otros: { audiencia: 20, apelacion: 15 } },
  PENAL: { contestacion: 6, otros: { audiencia: 10, apelacion: 5 } },
  FISCAL: { contestacion: 45, otros: { audiencia: 30, apelacion: 15 } },
  OTRO: { contestacion: 15, otros: { audiencia: 10, apelacion: 9 } },
};

@Injectable()
export class LegalAIAssistService {
  private readonly logger = new Logger(LegalAIAssistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deadlines: DeadlinesService,
    private readonly tasks: TasksService,
    private readonly s3: S3Service,
  ) {}

  private async callLLM(
    prompt: string,
    systemHint = 'Responde únicamente con JSON válido. No incluyas markdown.',
    options?: { maxTokens?: number },
  ): Promise<string> {
    const maxTokens = options?.maxTokens ?? 2048;
    const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
    const openaiKey = process.env.OPENAI_API_KEY?.trim();
    const geminiKey = process.env.GEMINI_API_KEY?.trim();

    if (!anthropicKey && !openaiKey && !geminiKey) {
      throw new BadRequestException('Configura ANTHROPIC_API_KEY, OPENAI_API_KEY o GEMINI_API_KEY.');
    }

    const text = prompt.slice(0, 120000);

    if (anthropicKey) {
      try {
        const { ChatAnthropic } = await import('@langchain/anthropic');
        const { HumanMessage } = await import('@langchain/core/messages');
        const model = new ChatAnthropic({
          anthropicApiKey: anthropicKey,
          modelName: 'claude-sonnet-4-5-20250929',
          maxTokens,
        });
        const response = await model.invoke([
          new HumanMessage(`${systemHint}\n\n---\n\n${text}`),
        ]);
        return typeof response.content === 'string' ? response.content : String(response.content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if ((msg.includes('credit') || msg.includes('quota') || msg.includes('insuficiente')) && (openaiKey || geminiKey)) {
          this.logger.warn('Anthropic falló, usando fallback');
        } else throw err;
      }
    }

    if (openaiKey) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            max_tokens: maxTokens,
            messages: [
              { role: 'system', content: systemHint },
              { role: 'user', content: text },
            ],
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err?.error as { message?: string })?.message ?? `OpenAI ${res.status}`);
        }
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = data?.choices?.[0]?.message?.content ?? '';
        if (content) return content;
      } catch (err) {
        this.logger.warn(`OpenAI fallback falló: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (geminiKey) {
      const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemHint}\n\n---\n\n${text}` }] }],
          generationConfig: { maxOutputTokens: maxTokens },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err?.error as { message?: string })?.message ?? `Gemini ${res.status}`);
      }
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const content = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      if (content) return content;
    }

    throw new BadRequestException('Ninguna API de IA disponible.');
  }

  private parseJson(content: string): Record<string, unknown> | null {
    const trimmed = content.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}') + 1;
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // ─── 1. PLAZOS / DEADLINES ─────────────────────────────────────────────────

  /** Plazos procesales sugeridos por materia. */
  async suggestDeadlinesByMatter(organizationId: string, classification: string) {
    const materia = (classification?.toUpperCase() || 'OTRO').replace(/[^A-Z]/g, '');
    const rules = MATERIA_TO_DAYS[materia] ?? MATERIA_TO_DAYS.OTRO;
    const fromDate = new Date();
    const contestacionDate = await this.deadlines.computeDueDate(organizationId, fromDate, rules.contestacion);
    return {
      materia,
      suggested: [
        { type: 'RESPONSE', title: 'Plazo para contestar demanda', days: rules.contestacion, dueDate: contestacionDate.toISOString().slice(0, 10) },
        { type: 'HEARING', title: 'Audiencia', days: rules.otros.audiencia },
        { type: 'FILING', title: 'Apelación', days: rules.otros.apelacion },
      ],
    };
  }

  /** Crear plazos desde análisis de documento. */
  async createDeadlinesFromDocument(
    organizationId: string,
    documentId: string,
    matterId: string,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId, matterId },
      select: { aiMetadata: true },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    const meta = (doc.aiMetadata as { deadlines?: Array<{ description?: string; date?: string }> }) ?? {};
    const deadlines = Array.isArray(meta.deadlines) ? meta.deadlines : [];
    const created: Array<{ id: string; title: string; dueDate: string }> = [];
    for (const d of deadlines) {
      const desc = typeof d.description === 'string' ? d.description : 'Plazo detectado';
      const dateStr = typeof d.date === 'string' ? d.date : null;
      const dueDate = dateStr ? new Date(dateStr) : await this.deadlines.computeDueDate(organizationId, new Date(), 15);
      const dl = await this.deadlines.create(organizationId, {
        matterId,
        title: desc.slice(0, 255),
        dueDate: dueDate.toISOString(),
        deadlineType: DeadlineType.OTHER,
      });
      created.push({ id: dl.id, title: desc, dueDate: dueDate.toISOString().slice(0, 10) });
    }
    return { created, count: created.length };
  }

  /** Avisos inteligentes con contexto de riesgo. */
  async getSmartDeadlineAlerts(organizationId: string, limit = 15) {
    const list = await this.deadlines.upcoming(organizationId, limit);
    const enriched = await Promise.all(
      list.map(async (d) => {
        const docs = await this.prisma.document.findFirst({
          where: { matterId: d.matterId, organizationId, aiSummary: { not: null } },
          select: { aiMetadata: true },
        });
        const meta = (docs?.aiMetadata as { riskLevel?: string }) ?? {};
        return {
          ...d,
          riskLevel: meta.riskLevel ?? null,
          alertMessage: meta.riskLevel === 'ALTO'
            ? 'Riesgo alto: presenta antes de la fecha límite'
            : null,
        };
      }),
    );
    return enriched;
  }

  // ─── 2. TAREAS ─────────────────────────────────────────────────────────────

  /** Tareas sugeridas desde análisis de documento. */
  async suggestTasksFromDocument(
    organizationId: string,
    documentId: string,
    matterId: string,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId, matterId },
      select: { aiMetadata: true, aiSummary: true, name: true },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    const meta = (doc.aiMetadata as { deadlines?: Array<{ description?: string; date?: string }> }) ?? {};
    const tasks: Array<{ title: string; dueDate?: string }> = [];
    if (Array.isArray(meta.deadlines)) {
      for (const d of meta.deadlines) {
        const desc = typeof d.description === 'string' ? d.description : 'Plazo';
        const dateStr = typeof d.date === 'string' ? d.date : null;
        tasks.push({
          title: `Preparar para: ${desc}`,
          dueDate: dateStr ? `${dateStr}T00:00:00` : undefined,
        });
      }
    }
    if (tasks.length === 0) {
      tasks.push({ title: `Revisar documento: ${doc.name}`, dueDate: undefined });
    }
    return { suggested: tasks };
  }

  /** Crear tareas sugeridas y opcionalmente asignar. */
  async createSuggestedTasks(
    organizationId: string,
    matterId: string,
    documentId: string,
    assignToId?: string,
  ) {
    const { suggested } = await this.suggestTasksFromDocument(organizationId, documentId, matterId);
    const created: Awaited<ReturnType<TasksService['create']>>[] = [];
    for (const t of suggested) {
      const task = await this.tasks.create(organizationId, {
        matterId,
        title: t.title,
        dueDate: t.dueDate ? new Date(t.dueDate) : undefined,
        status: 'TODO',
        assignedToId: assignToId ?? undefined,
      });
      created.push(task);
    }
    return { created };
  }

  /** Sugerir asignación según carga de trabajo. */
  async suggestTaskAssignment(organizationId: string, matterId: string) {
    const users = await this.prisma.user.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    });
    const counts = await Promise.all(
      users.map(async (u) => {
        const c = await this.prisma.task.count({
          where: { organizationId, assignedToId: u.id, status: { not: 'DONE' } },
        });
        return { userId: u.id, name: u.name, pendingTasks: c };
      }),
    );
    counts.sort((a, b) => a.pendingTasks - b.pendingTasks);
    return { suggested: counts[0] ?? null, all: counts };
  }

  // ─── 3. RESUMEN EXPEDIENTE ─────────────────────────────────────────────────

  /** Resumen automático del expediente. */
  async getMatterSummary(organizationId: string, matterId: string) {
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId },
      include: {
        client: { select: { name: true } },
        documents: {
          where: { deletedAt: null, aiSummary: { not: null } },
          select: { name: true, aiSummary: true, aiMetadata: true },
        },
        deadlines: { where: { completedAt: null }, select: { title: true, dueDate: true }, orderBy: { dueDate: 'asc' }, take: 10 },
        tasks: { where: { status: { not: 'DONE' } }, select: { title: true, status: true }, take: 10 },
      },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado.');
    const docSummaries = matter.documents
      .map((d) => `- ${d.name}: ${(d.aiSummary ?? '').slice(0, 200)}`)
      .join('\n');
    const prompt = `Genera un resumen ejecutivo del expediente en español en 4-6 oraciones. Incluye: estado general, documentos clave analizados, plazos críticos y tareas pendientes.

Expediente: ${matter.name}
Cliente: ${matter.client?.name ?? 'N/A'}
Documentos: ${docSummaries || 'Sin documentos analizados'}
Plazos: ${matter.deadlines.map((d) => `${d.title} (${d.dueDate.toISOString().slice(0, 10)})`).join(', ') || 'Ninguno'}
Tareas pendientes: ${matter.tasks.map((t) => t.title).join(', ') || 'Ninguna'}

Devuelve JSON: { "summary": "resumen aquí" }`;
    const content = await this.callLLM(prompt);
    const json = this.parseJson(content);
    return { summary: (json?.summary as string) ?? (docSummaries || 'Sin datos suficientes.') };
  }

  /** Siguientes pasos sugeridos. */
  async getNextSteps(organizationId: string, matterId: string) {
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId },
      include: {
        documents: { where: { deletedAt: null, aiMetadata: { path: ['status'], equals: 'done' } }, select: { aiMetadata: true } },
        deadlines: { where: { completedAt: null, dueDate: { gte: new Date() } }, select: { title: true, dueDate: true }, orderBy: { dueDate: 'asc' }, take: 5 },
        tasks: { where: { status: { not: 'DONE' } }, select: { title: true } },
      },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado.');
    const prompt = `Como abogado senior, sugiere los 3-5 siguientes pasos más importantes para este expediente. Responde JSON: { "steps": ["paso 1", "paso 2", ...] }

Estado: ${matter.status}
Plazos próximos: ${matter.deadlines.map((d) => `${d.title} (${d.dueDate.toISOString().slice(0, 10)})`).join(', ')}
Tareas pendientes: ${matter.tasks.map((t) => t.title).join(', ')}
Documentos analizados: ${matter.documents.length}`;
    const content = await this.callLLM(prompt);
    const json = this.parseJson(content);
    const steps = Array.isArray(json?.steps) ? json.steps : [];
    return { steps };
  }

  // ─── 4. PLANTILLAS ────────────────────────────────────────────────────────

  /** Rellenar plantilla con datos del expediente (datos extendidos con IA). */
  async getExtendedTemplateData(organizationId: string, templateId: string, matterId: string) {
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId },
      include: {
        client: true,
        documents: { where: { deletedAt: null, aiMetadata: { path: ['status'], equals: 'done' } }, select: { aiMetadata: true, aiSummary: true, name: true } },
      },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado.');
    const parties = matter.documents
      .map((d) => (d.aiMetadata as { parties?: { actor?: string; demandado?: string } })?.parties)
      .filter(Boolean);
    const lastDoc = matter.documents[0];
    const meta = lastDoc ? (lastDoc.aiMetadata as Record<string, unknown>) : {};
    return {
      client_name: matter.client.name ?? '',
      matter_title: matter.name ?? '',
      actor: (meta.parties as { actor?: string })?.actor ?? parties.find((p) => (p as { actor?: string })?.actor) ?? '',
      demandado: (meta.parties as { demandado?: string })?.demandado ?? parties.find((p) => (p as { demandado?: string })?.demandado) ?? '',
      amount: (meta as { amount?: string }).amount ?? '',
      today_date: new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }),
      ...meta,
    };
  }

  /** Generar borrador con contexto IA. */
  async generateDraftWithContext(
    organizationId: string,
    templateId: string,
    matterId: string,
    context?: string,
  ) {
    const data = await this.getExtendedTemplateData(organizationId, templateId, matterId);
    if (context) {
      const prompt = `Contexto adicional del expediente: ${context}\n\nGenera datos JSON adicionales para rellenar una plantilla legal (partes, montos, fechas). Responde solo JSON.`;
      const content = await this.callLLM(prompt);
      const json = this.parseJson(content);
      if (json) Object.assign(data, json);
    }
    return data;
  }

  // ─── 5. NOTAS / ACTIVIDADES ────────────────────────────────────────────────

  /** Resumir nota larga. */
  async summarizeNote(content: string) {
    if (!content?.trim() || content.length < 100) {
      return { summary: content || '', shortened: false };
    }
    const prompt = `Resume en 2-4 oraciones el siguiente texto (acta de reunión o nota legal):\n\n${content.slice(0, 8000)}\n\nDevuelve JSON: { "summary": "resumen aquí" }`;
    const response = await this.callLLM(prompt);
    const json = this.parseJson(response);
    return { summary: (json?.summary as string) ?? content.slice(0, 500), shortened: true };
  }

  /** Extraer acciones pendientes de una nota. */
  async extractActionsFromNote(content: string) {
    if (!content?.trim()) return { actions: [] };
    const prompt = `Extrae las acciones pendientes o tareas mencionadas en este texto. Devuelve JSON: { "actions": ["acción 1", "acción 2", ...] } máximo 10.\n\n${content.slice(0, 4000)}`;
    const response = await this.callLLM(prompt);
    const json = this.parseJson(response);
    const actions = Array.isArray(json?.actions) ? json.actions : [];
    return { actions };
  }

  // ─── 7. BÚSQUEDA SEMÁNTICA ─────────────────────────────────────────────────

  /** Búsqueda asistida por IA (extrae términos y busca). */
  async aiAssistedSearch(organizationId: string, query: string, matterId?: string) {
    const prompt = `De la consulta del usuario, extrae 3-5 términos clave para buscar en documentos legales. Devuelve JSON: { "keywords": ["término1", "término2"] }

Consulta: ${query}`;
    const response = await this.callLLM(prompt);
    const json = this.parseJson(response);
    const keywords = Array.isArray(json?.keywords) ? (json.keywords as string[]) : [query];
    const searchTerms = keywords.join(' ').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s]/g, '').trim();
    const terms = searchTerms.split(/\s+/).filter(Boolean);
    const where: Record<string, unknown> = {
      organizationId,
      deletedAt: null,
    };
    if (matterId) where.matterId = matterId;
    if (terms.length > 0) {
      where.OR = terms.flatMap((t) => [
        { name: { contains: t, mode: 'insensitive' } },
        { aiSummary: { contains: t, mode: 'insensitive' } },
      ]);
    }
    const docs = await this.prisma.document.findMany({
      where: where as Prisma.DocumentWhereInput,
      select: { id: true, name: true, aiSummary: true, matterId: true },
      take: 20,
    });
    return { keywords: terms, documents: docs };
  }

  // ─── 8. COMPARACIÓN DE VERSIONES ───────────────────────────────────────────

  /** Resumen de cambios entre versiones. */
  async getVersionComparisonSummary(
    organizationId: string,
    documentId: string,
    versionId1: string,
    versionId2: string,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    const v1 = await this.prisma.raw.documentVersion.findFirst({
      where: { documentId, id: versionId1, organizationId },
      select: { extractedText: true },
    });
    const v2 = await this.prisma.raw.documentVersion.findFirst({
      where: { documentId, id: versionId2, organizationId },
      select: { extractedText: true },
    });
    if (!v1?.extractedText || !v2?.extractedText) {
      throw new BadRequestException('Una o ambas versiones no tienen texto extraído.');
    }
    const t1 = v1.extractedText.slice(0, 15000);
    const t2 = v2.extractedText.slice(0, 15000);
    const prompt = `Compara estos dos textos (versiones de un documento legal) y genera:
1. Resumen de cambios principales (3-5 puntos)
2. Cláusulas o párrafos que parecen modificados (lista breve)

Versión 1 (antes):
---
${t1}
---

Versión 2 (después):
---
${t2}
---

Devuelve JSON: { "summary": "resumen", "modifiedSections": ["sección 1", "sección 2"] }`;
    const response = await this.callLLM(prompt);
    const json = this.parseJson(response);
    return {
      summary: (json?.summary as string) ?? 'Diferencias detectadas.',
      modifiedSections: Array.isArray(json?.modifiedSections) ? json.modifiedSections : [],
    };
  }

  // ─── 9. CONTESTACIÓN DE DEMANDA ────────────────────────────────────────────

  /** Generar borrador de contestación de demanda a partir del documento de demanda. */
  async generateContestacionDemanda(
    organizationId: string,
    documentId: string,
    matterId: string,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId, matterId },
      select: { id: true, name: true, aiMetadata: true, aiSummary: true },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');

    // Obtener texto extraído: primero document_text_index, luego última versión
    let text = '';
    const textIndex = await this.prisma.raw.documentTextIndex.findFirst({
      where: { documentId, organizationId },
      select: { extractedText: true },
    });
    if (textIndex?.extractedText?.trim()) {
      text = textIndex.extractedText;
    } else {
      const latestVersion = await this.prisma.raw.documentVersion.findFirst({
        where: { documentId, organizationId },
        orderBy: { version: 'desc' },
        select: { extractedText: true },
      });
      if (latestVersion?.extractedText?.trim()) {
        text = latestVersion.extractedText;
      }
    }
    if (!text || text.trim().length < 100) {
      throw new BadRequestException(
        'El documento no tiene texto extraído suficiente. Reanaliza el documento o sube un PDF con texto.',
      );
    }

    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId },
      include: {
        client: { select: { name: true } },
      },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado.');

    const meta = (doc.aiMetadata as Record<string, unknown>) ?? {};
    const parties = meta.parties as { actor?: string; demandado?: string } | undefined;
    const actor = parties?.actor ?? '';
    const demandado = parties?.demandado ?? matter.client?.name ?? '';
    const classification = (meta.classification as string) ?? (meta.documentType as string) ?? 'CIVIL';

    const prompt = `Eres un abogado experto en derecho procesal mexicano (Ciudad de México). Genera un borrador COMPLETO de CONTESTACIÓN DE DEMANDA, formal y con argumentación jurídica sólida.

## Contexto
- Expediente: ${matter.name}
- Demandado (nuestro cliente): ${demandado}
- Actor/demandante: ${actor}
- Materia: ${classification}
- Tribunal: Juzgado de lo Civil (CDMX)

## Texto de la demanda
---
${text.slice(0, 80000)}
---

## Estructura OBLIGATORIA (genera todas las secciones completas)
1. ENCABEZADO: "C. JUEZ [correspondiente] P R E S E N T E." + comparecencia del demandado con nombre de la empresa o persona, representación legal, domicilio para oír y recibir notificaciones.
2. ANTECEDENTES: Resumen breve de la demanda (hechos alegados por el actor).
3. HECHOS: Versión del demandado, contestando punto por punto cada hecho alegado. Incluye argumentos para desvirtuar o matizar (ej. pago parcial, mora no imputable, cláusulas no cumplidas por el actor, etc.).
4. DERECHO: Fundamentos jurídicos para rebatir cada petitorio (A, B, C, D) de la demanda. Cita artículos aplicables del Código Civil y Código de Procedimientos Civiles de la CDMX.
5. PRUEBAS: Ofrece las pruebas que convengan (documental, testimonial, confesional, etc.).
6. PETITORIO: Solicitudes numeradas (ej. PRIMERO.- Tener por contestada. SEGUNDO.- Desestimar la demanda. TERCERO.- Condenar al actor en costas.).
7. CIERRE: "PROTESTO LO NECESARIO", lugar y fecha, firma del representante legal.

IMPORTANTE: La contestación debe ser COMPLETA, NO truncada. Responde TODA la contestación en un solo bloque de texto. Usa lenguaje forense y argumentación jurídica seria. Responde únicamente con el texto, sin JSON ni metadatos.`;

    const systemHint =
      'Responde ÚNICAMENTE con el texto completo de la contestación jurídica. No incluyas explicaciones previas, JSON ni metadatos. Genera la contestación completa hasta el cierre con firma.';
    const draft = await this.callLLM(prompt, systemHint, { maxTokens: 8192 });
    return { draft: draft?.trim() ?? '', documentName: doc.name };
  }

  /** Convierte el borrador de contestación a DOCX con formato profesional. */
  async draftContestacionToDocx(draft: string): Promise<Buffer> {
    const { Document, Packer, Paragraph, TextRun, AlignmentType } = await import('docx');

    const sectionHeaders = [
      'ANTECEDENTES', 'HECHOS', 'DERECHO', 'FUNDAMENTOS', 'PRUEBAS', 'PETICIONES', 'P E T I C I O N E S',
      'PETITORIO', 'CIERRE', 'PROTESTO',
    ];
    const lines = draft.split(/\r?\n/);
    const children: InstanceType<typeof Paragraph>[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        children.push(new Paragraph({ text: '', spacing: { after: 100 } }));
        continue;
      }
      const isHeader = sectionHeaders.some((h) => trimmed.toUpperCase().startsWith(h)) ||
        (trimmed.length < 70 && /^[A-ZÁÉÍÓÚÑ\s\.]+$/u.test(trimmed));
      const isCentered = /P\s*R\s*E\s*S\s*E\s*N\s*T\s*E/.test(trimmed) || trimmed.includes('PRESENTE.');
      children.push(
        new Paragraph({
          alignment: isCentered ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
          spacing: { before: isHeader ? 200 : 0, after: 100 },
          children: [
            new TextRun({ text: trimmed, bold: isHeader, font: 'Times New Roman', size: 24 }),
          ],
        }),
      );
    }

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
            },
          },
          children,
        },
      ],
    });

    return Buffer.from(await Packer.toBuffer(doc));
  }
}
