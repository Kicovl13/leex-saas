import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from './s3.service';
import { AuditService } from '../audit/audit.service';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage } from '@langchain/core/messages';

const LEGAL_PROMPT = `Eres un Abogado Senior Mexicano experto en análisis de documentos judiciales y legales.
Tu tarea es analizar el texto completo y devolver ÚNICAMENTE un objeto JSON válido (sin markdown, sin explicaciones) con esta estructura exacta:

{
  "summary": "Resumen ejecutivo breve del documento en 3-5 frases, identificando tipo de escrito, materia y pretensiones principales",
  "classification": "Materia jurídica: CIVIL | MERCANTIL | LABORAL | FAMILIAR | ADMINISTRATIVO | PENAL | FISCAL | OTRO",
  "documentType": "Tipo de documento: demanda | contestación | sentencia | oficio | contrato | recurso | escrito | otro",
  "parties": {
    "actor": "Nombre o identificación completa del actor/demandante/solicitante",
    "demandado": "Nombre o identificación completa del demandado/solicitado"
  },
  "amount": "Cuantía reclamada en pesos MXN, o descripción si no hay monto específico",
  "deadlines": [{"description": "Descripción clara del plazo o evento", "date": "YYYY-MM-DD si se menciona fecha"}],
  "riskLevel": "BAJO | MEDIO | ALTO según el análisis de riesgos procesales y económicos",
  "proceduralRisks": ["Riesgo procesal 1 con breve explicación", "Riesgo procesal 2"],
  "executiveSummary": "Resumen ejecutivo de 3-5 oraciones para toma de decisiones: contexto, pretensiones, plazos críticos y recomendaciones",
  "keyPoints": ["Punto clave 1", "Punto clave 2", "Punto clave 3", "Punto clave 4"]
}

Reglas:
- Si no encuentras información para algún campo, usa null o array vacío según corresponda.
- Para plazos, extrae todas las fechas relevantes (audiencias, contestación, apelación, etc.).
- En parties, usa objetos con actor y demandado; si es contrato, adapta a las partes contratantes.
- El executiveSummary debe ser accionable para un despacho.
- IMPORTANTE: Genera el JSON COMPLETO. No trunques el summary, executiveSummary ni ningún campo. Completa todas las oraciones.
- Responde únicamente con el JSON, sin texto adicional.`;

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  const o = err as { error?: { error?: { message?: string }; message?: string }; message?: string };
  return o?.error?.error?.message ?? o?.error?.message ?? o?.message ?? String(err);
}

@Injectable()
export class LegalAIService {
  private readonly logger = new Logger(LegalAIService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly audit: AuditService,
  ) {}

  async analyzeDocument(documentId: string): Promise<void> {
    const doc = await this.prisma.raw.document.findUnique({
      where: { id: documentId },
      select: { id: true, organizationId: true, s3Key: true, mimeType: true, name: true },
    });
    if (!doc) {
      this.logger.warn(`Document ${documentId} not found`);
      return;
    }
    if (doc.mimeType !== 'application/pdf' && !doc.name.toLowerCase().endsWith('.pdf')) {
      await this.updateDocumentResult(documentId, null, { status: 'skipped', reason: 'Not a PDF' });
      return;
    }
    try {
      const buffer = await this.s3.getObject(doc.s3Key);
      const text = await this.extractTextFromPdf(buffer);
      if (!text || text.trim().length < 50) {
        await this.updateDocumentResult(documentId, null, { status: 'failed', reason: 'No text extracted' });
        return;
      }
      await this.updateDocumentVersionExtractedText(
        documentId,
        doc.organizationId,
        doc.s3Key,
        text,
      );
      const useMock = process.env.LEGAL_AI_MOCK === 'true' || process.env.LEGAL_AI_MOCK === '1';
      if (useMock) {
        const summary =
          text.length > 400
            ? text.slice(0, 400).trim() + '…'
            : text.trim() || 'Documento de prueba (análisis simulado).';
        await this.updateDocumentResult(documentId, summary, {
          status: 'done',
          mock: true,
          parties: [],
          deadlines: [],
          keyPoints: ['Análisis simulado (LEGAL_AI_MOCK=true). Sin uso de API.'],
        });
        this.logger.log(`Document ${documentId} analyzed (mock mode)`);
        return;
      }

      const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
      const openaiKey = process.env.OPENAI_API_KEY?.trim();
      const geminiKey = process.env.GEMINI_API_KEY?.trim();
      if (!anthropicKey && !openaiKey && !geminiKey) {
        await this.updateDocumentResult(documentId, null, {
          status: 'failed',
          reason: 'Configura al menos una: ANTHROPIC_API_KEY, OPENAI_API_KEY o GEMINI_API_KEY.',
        });
        return;
      }

      let content: string;
      let usedProvider: string;

      // 1. Intentar Anthropic
      if (anthropicKey) {
        try {
          const model = new ChatAnthropic({
            anthropicApiKey: anthropicKey,
            modelName: 'claude-sonnet-4-5-20250929',
            maxTokens: 8192,
          });
          const response = await model.invoke([
            new HumanMessage(LEGAL_PROMPT + '\n\n---\n\n' + text.slice(0, 120000)),
          ]);
          content = typeof response.content === 'string' ? response.content : String(response.content);
          usedProvider = 'anthropic';
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          const isAnthropicUnavailable =
            message.includes('credit balance') ||
            message.includes('too low') ||
            message.includes('Plans & Billing') ||
            message.includes('insuficiente');
          if (isAnthropicUnavailable && (openaiKey || geminiKey)) {
            const fallback = await this.tryFallbackProviders(text, openaiKey, geminiKey);
            content = fallback.content;
            usedProvider = fallback.provider;
          } else if (isAnthropicUnavailable) {
            this.logger.warn(
              `Analyze skipped for ${documentId}: Anthropic sin créditos. Configura OPENAI_API_KEY o GEMINI_API_KEY.`,
            );
            await this.updateDocumentResult(documentId, null, {
              status: 'failed',
              error: 'Anthropic sin créditos. Configura OPENAI_API_KEY o GEMINI_API_KEY para fallback.',
            });
            return;
          } else {
            throw err;
          }
        }
      } else {
        const fallback = await this.tryFallbackProviders(text, openaiKey, geminiKey);
        content = fallback.content;
        usedProvider = fallback.provider;
      }

      const json = this.parseJsonFromResponse(content);
      const summary =
        typeof json?.summary === 'string'
          ? json.summary
          : typeof json?.executiveSummary === 'string'
            ? json.executiveSummary
            : content.slice(0, 2000);
      const parties = json?.parties ?? {};
      const aiMetadata = {
        status: 'done',
        parties: typeof parties === 'object' && !Array.isArray(parties) ? parties : { actor: null, demandado: null },
        deadlines: Array.isArray(json?.deadlines) ? json.deadlines : [],
        keyPoints: Array.isArray(json?.keyPoints) ? json.keyPoints : [],
        classification: typeof json?.classification === 'string' ? json.classification : null,
        documentType: typeof json?.documentType === 'string' ? json.documentType : null,
        amount: typeof json?.amount === 'string' ? json.amount : null,
        riskLevel: typeof json?.riskLevel === 'string' ? json.riskLevel : null,
        proceduralRisks: Array.isArray(json?.proceduralRisks) ? json.proceduralRisks : [],
        executiveSummary: typeof json?.executiveSummary === 'string' ? json.executiveSummary : null,
        provider: usedProvider,
      };
      const classification = typeof json?.classification === 'string' ? json.classification : undefined;
      await this.updateDocumentResult(documentId, summary, aiMetadata, classification);
      this.logger.log(`Document ${documentId} analyzed successfully (${usedProvider})`);
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      this.logger.error(`Analyze failed for ${documentId}`, err);
      await this.updateDocumentResult(documentId, null, {
        status: 'failed',
        error: message,
      });
    }
  }

  private async updateDocumentVersionExtractedText(
    documentId: string,
    organizationId: string,
    s3Key: string,
    text: string,
  ): Promise<void> {
    try {
      await this.prisma.raw.$executeRawUnsafe(
        `
        UPDATE "document_versions"
        SET "extracted_text" = $4
        WHERE "document_id" = $1
          AND "organization_id" = $2
          AND "file_url" = $3
        `,
        documentId,
        organizationId,
        s3Key,
        text,
      );
    } catch (e) {
      this.logger.debug(
        `No se pudo actualizar extracted_text en versiones para ${documentId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async updateDocumentResult(
    documentId: string,
    aiSummary: string | null,
    aiMetadata: Record<string, unknown>,
    classification?: string,
  ): Promise<void> {
    const before = await this.prisma.raw.document.findUnique({
      where: { id: documentId },
      select: { organizationId: true, aiSummary: true, aiMetadata: true, classification: true },
    });
    const data: { aiSummary: string | null; aiMetadata: Prisma.InputJsonValue; classification?: string } = {
      aiSummary,
      aiMetadata: aiMetadata as Prisma.InputJsonValue,
    };
    if (classification !== undefined) data.classification = classification;
    await this.prisma.raw.document.update({
      where: { id: documentId },
      data,
    });
    if (before) {
      await this.audit.log({
        organizationId: before.organizationId,
        entityType: 'Document',
        entityId: documentId,
        action: 'UPDATE',
        oldData: { aiSummary: before.aiSummary, aiMetadata: before.aiMetadata, classification: before.classification } as Record<string, unknown>,
        newData: { aiSummary, aiMetadata, ...(classification !== undefined && { classification }) },
      });
    }
    this.logger.log(
      `Document ${documentId}: aiSummary persisted in DB (will be served from storage on GET, no re-computation)`,
    );
  }

  /**
   * Intenta OpenAI y luego Gemini. Lanza si ambos fallan.
   */
  private async tryFallbackProviders(
    text: string,
    openaiKey: string | undefined,
    geminiKey: string | undefined,
  ): Promise<{ content: string; provider: string }> {
    let lastError: Error | null = null;
    if (openaiKey) {
      try {
        const content = await this.callOpenAIAnalysis(text, openaiKey);
        return { content, provider: 'openai-fallback' };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(`OpenAI fallback falló: ${lastError.message}`);
      }
    }
    if (geminiKey) {
      try {
        const content = await this.callGeminiAnalysis(text, geminiKey);
        return { content, provider: 'gemini-fallback' };
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(`Gemini fallback falló: ${e.message}`);
        lastError = e;
      }
    }
    throw lastError ?? new Error('Ningún proveedor de fallback configurado.');
  }

  /**
   * Fallback usando OpenAI (gpt-4o-mini) cuando Anthropic no está disponible.
   */
  private async callOpenAIAnalysis(text: string, apiKey: string): Promise<string> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        max_tokens: 8192,
        messages: [
          { role: 'system', content: 'Responde únicamente con JSON válido. No incluyas markdown.' },
          { role: 'user', content: LEGAL_PROMPT + '\n\n---\n\n' + text.slice(0, 120000) },
        ],
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = (err?.error as { message?: string })?.message ?? err?.message ?? res.statusText;
      throw new Error(msg || `OpenAI API error ${res.status}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data?.choices?.[0]?.message?.content ?? '';
    if (!content) throw new Error('OpenAI devolvió respuesta vacía');
    return content;
  }

  /**
   * Fallback usando Google Gemini cuando Anthropic y OpenAI no están disponibles.
   */
  private async callGeminiAnalysis(text: string, apiKey: string): Promise<string> {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: LEGAL_PROMPT + '\n\n---\n\n' + text.slice(0, 120000) }] }],
        generationConfig: { maxOutputTokens: 8192 },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = (err?.error as { message?: string })?.message ?? err?.message ?? res.statusText;
      throw new Error(msg || `Gemini API error ${res.status}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const textPart = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!textPart) throw new Error('Gemini devolvió respuesta vacía');
    return textPart;
  }

  private parseJsonFromResponse(content: string): Record<string, unknown> | null {
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

  private async extractTextFromPdf(buffer: Buffer): Promise<string> {
    const pdfParse = await import('pdf-parse');
    const data = await pdfParse.default(buffer);
    return data.text ?? '';
  }

  /**
   * Extrae texto de un archivo en S3 para comparación de versiones.
   * Soporta PDF y DOCX. Para otros formatos devuelve null.
   */
  async extractTextForComparison(
    s3Key: string,
    mimeType?: string | null,
    fileName?: string | null,
  ): Promise<{ text: string } | { text: null; reason: string }> {
    try {
      const buffer = await this.s3.getObject(s3Key);
      const lower = (mimeType ?? '').toLowerCase();
      const ext = (fileName ?? s3Key).toLowerCase().split('.').pop() ?? '';

      if (lower === 'application/pdf' || ext === 'pdf') {
        const text = await this.extractTextFromPdf(buffer);
        return { text: text?.trim() ?? '' };
      }
      if (
        lower.includes('wordprocessingml') ||
        lower === 'application/msword' ||
        ext === 'docx' ||
        ext === 'doc'
      ) {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        const text = (result.value ?? '').trim();
        return { text };
      }
      return {
        text: null,
        reason: `Formato no soportado para extracción (mime: ${mimeType ?? 'desconocido'}). Solo PDF y Word.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`No se pudo extraer texto de ${s3Key}: ${msg}`);
      return { text: null, reason: `Error al extraer: ${msg}` };
    }
  }
}
