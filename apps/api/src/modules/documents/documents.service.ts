import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from './s3.service';
import { UsageLimitService } from './usage-limit.service';
import { MatterActivityService } from '../matter-activity/matter-activity.service';
import { AuditService } from '../audit/audit.service';
import { MatterActivityType, UserRole } from '../../generated/prisma';
import { DocumentEventsService } from './document-events.service';
import { LegalAIService } from './legal-ai.service';
import { N8nOrchestratorService } from './n8n-orchestrator.service';
import { AiCallbackDto } from './dto/ai-callback.dto';
import { JobsQueueService } from '../jobs/jobs-queue.service';
import { createHash, randomBytes } from 'node:crypto';

const SANITIZE_FILENAME = /[^a-zA-Z0-9._-]/g;
const MASSIVE_SUMMARY_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly documentEvents: DocumentEventsService,
    private readonly jobsQueue: JobsQueueService,
    private readonly legalAI: LegalAIService,
    private readonly n8n: N8nOrchestratorService,
    private readonly usageLimit: UsageLimitService,
    private readonly matterActivity: MatterActivityService,
    private readonly audit: AuditService,
  ) {}

  async getUploadUrl(
    organizationId: string,
    dto: { matterId: string; fileName: string; mimeType: string; sizeBytes: number; folder?: string },
    userId?: string,
  ) {
    if (!this.s3.isConfigured()) {
      throw new BadRequestException(
        'S3 no está configurado. Configura AWS_S3_BUCKET, AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY en apps/api/.env. Ver docs/AWS_S3_BUCKET_Y_USUARIO.md.',
      );
    }
    await this.prisma.raw.matter.findFirstOrThrow({
      where: { id: dto.matterId, organizationId },
    });
    const safeName = dto.fileName.replace(SANITIZE_FILENAME, '_').slice(0, 100);
    const key = `${organizationId}/${dto.matterId}/${cuidLike()}-${safeName}`;
    const doc = await this.prisma.document.create({
      data: {
        organizationId,
        matterId: dto.matterId,
        folder: dto.folder ?? null,
        name: dto.fileName,
        s3Key: key,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        uploadedById: userId ?? null,
        aiMetadata: { status: 'pending' },
      },
    });
    await this.matterActivity.create(organizationId, dto.matterId, {
      type: MatterActivityType.DOCUMENT_UPLOAD,
      content: `Documento subido: ${dto.fileName}`,
      metadata: { documentId: doc.id, fileName: dto.fileName, folder: dto.folder },
      userId,
    });
    await this.recordDocumentVersion({
      organizationId,
      documentId: doc.id,
      fileUrl: key,
      createdBy: userId ?? null,
    });
    const organization = await this.prisma.raw.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    const settings = (organization?.settings as Record<string, unknown> | null) ?? {};
    const kmsKeyId =
      typeof settings.kmsKeyId === 'string' && settings.kmsKeyId.trim().length > 0
        ? settings.kmsKeyId
        : process.env.DEFAULT_TENANT_KMS_KEY_ID;

    const uploadUrl = await this.s3.getUploadSignedUrl(key, dto.mimeType, kmsKeyId);
    return { uploadUrl, documentId: doc.id, s3Key: key };
  }

  async confirmUpload(organizationId: string, documentId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    const meta = (doc.aiMetadata as { status?: string }) ?? {};
    if (meta.status === 'processing') {
      return { document: doc, message: 'El documento ya está siendo procesado.' };
    }
    const isPdf = doc.mimeType === 'application/pdf' || doc.name.toLowerCase().endsWith('.pdf');

    // Hash para trazabilidad e integridad del archivo.
    let fileHash: string | null = null;
    let duplicateOfDocumentId: string | null = null;
    try {
      const buffer = await this.s3.getObject(doc.s3Key);
      fileHash = createHash('sha256').update(buffer).digest('hex');
      await this.prisma.raw.$executeRawUnsafe(
        `UPDATE "documents" SET "file_hash" = $2 WHERE "id" = $1`,
        documentId,
        fileHash,
      );
      const duplicates = await this.prisma.raw.$queryRawUnsafe<Array<{ id: string }>>(
        `
        SELECT "id"
        FROM "documents"
        WHERE "organization_id" = $1
          AND "id" <> $2
          AND "file_hash" = $3::text
          AND "deleted_at" IS NULL
        ORDER BY "created_at" DESC
        LIMIT 1
        `,
        organizationId,
        documentId,
        fileHash,
      );
      duplicateOfDocumentId = duplicates[0]?.id ?? null;
      if (duplicateOfDocumentId) {
        await this.prisma.raw.$executeRawUnsafe(
          `
          UPDATE "documents"
          SET "ai_metadata" = COALESCE("ai_metadata", '{}'::jsonb) || jsonb_build_object('duplicateOfDocumentId', $3::text)
          WHERE "id" = $1 AND "organization_id" = $2
          `,
          documentId,
          organizationId,
          duplicateOfDocumentId,
        );
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo calcular hash del documento ${documentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (isPdf) {
      await this.usageLimit.assertCanProcessDocument(organizationId);
      const executionId = await this.createWorkflowExecution({
        organizationId,
        workflowType: 'DOCUMENT_AI',
        documentId,
        status: 'queued',
        payload: {
          type: 'DOCUMENT_UPLOADED',
          documentId,
          organizationId,
          s3Key: doc.s3Key,
        },
      });
      const newMeta = { ...meta, status: 'processing' };
      await this.prisma.document.update({
        where: { id: documentId },
        data: { aiMetadata: newMeta },
      });
      await this.audit.log({
        organizationId,
        entityType: 'Document',
        entityId: documentId,
        action: 'UPDATE',
        oldData: doc as unknown as Record<string, unknown>,
        newData: { ...doc, aiMetadata: newMeta } as unknown as Record<string, unknown>,
      });

      const organization = await this.prisma.raw.organization.findUnique({
        where: { id: organizationId },
        select: { plan: true, settings: true },
      });
      const settings = (organization?.settings as Record<string, unknown> | null) ?? {};
      const featureFlags = Array.isArray(settings.featureFlags)
        ? (settings.featureFlags.filter((value) => typeof value === 'string') as string[])
        : undefined;
      const featuresRequested = this.resolveFeaturesRequested(organization?.plan, featureFlags);

      const published = await this.documentEvents.publishDocumentUploaded({
        type: 'DOCUMENT_UPLOADED',
        documentId,
        organizationId,
        s3Key: doc.s3Key,
        workflowExecutionId: executionId ?? undefined,
        plan: organization?.plan,
        featureFlags,
        featuresRequested,
      });

      if (!published) {
        this.logger.warn(
          'Event bus no disponible. Procesando documento localmente con LegalAIService.',
        );
        await this.updateWorkflowExecution(executionId, 'processing', undefined, {
          startedAt: new Date().toISOString(),
        });
        this.legalAI
          .analyzeDocument(documentId)
          .catch((err) =>
            this.logger.error(`Fallback analyze failed for ${documentId}`, err),
          );
        return {
          document: { ...doc, aiMetadata: newMeta },
          message:
            'Documento confirmado. El evento externo no está disponible; se procesa localmente.',
        };
      } else {
        await this.updateWorkflowExecution(executionId, 'processing', undefined, {
          startedAt: new Date().toISOString(),
        });
        await this.jobsQueue.enqueueHeavyJob(
          'documents.preprocess',
          {
            documentId,
            organizationId,
            s3Key: doc.s3Key,
          },
          { attempts: 3, backoffMs: 3000 },
        );
      }
    }

    // Disparar n8n cuando está configurado (orquestador externo)
    if (this.n8n.isConfigured()) {
      const taskType =
        doc.sizeBytes >= MASSIVE_SUMMARY_SIZE_BYTES
          ? 'MASSIVE_SUMMARY'
          : isPdf
            ? 'DEEP_ANALYSIS'
            : 'CLASSIFY';
      this.n8n
        .triggerDocumentWorkflow(
          doc.matterId,
          documentId,
          doc.s3Key,
          taskType,
          organizationId,
        )
        .catch((err) =>
          this.logger.warn(`n8n trigger failed for ${documentId}`, err),
        );
    }

    return {
      document: doc,
      message: isPdf ? 'Documento confirmado. El análisis con IA puede tardar unos segundos.' : 'Documento confirmado.',
      duplicateOfDocumentId,
    };
  }

  /** Reanaliza un documento con IA (para documentos fallidos o con análisis antiguo). */
  async reanalyze(
    organizationId: string,
    documentId: string,
    taskType?: 'CLASSIFY' | 'DEEP_ANALYSIS' | 'MASSIVE_SUMMARY',
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    const meta = (doc.aiMetadata as { status?: string }) ?? {};
    const isPdf = doc.mimeType === 'application/pdf' || doc.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      throw new BadRequestException('Solo se puede reanalizar documentos PDF.');
    }
    await this.usageLimit.assertCanProcessDocument(organizationId);

    const chosenTaskType =
      taskType ??
      (doc.sizeBytes >= MASSIVE_SUMMARY_SIZE_BYTES ? 'MASSIVE_SUMMARY' : 'DEEP_ANALYSIS');

    if (this.n8n.isConfigured()) {
      const triggered = await this.n8n.triggerDocumentWorkflow(
        doc.matterId,
        documentId,
        doc.s3Key,
        chosenTaskType,
        organizationId,
      );
      const newMeta = { ...meta, status: 'processing', reanalyzedAt: new Date().toISOString() };
      await this.prisma.document.update({
        where: { id: documentId },
        data: { aiMetadata: newMeta as Prisma.InputJsonValue },
      });
      return {
        document: { ...doc, aiMetadata: newMeta },
        message: triggered
          ? `Reanálisis iniciado (n8n, taskType=${chosenTaskType}).`
          : 'Reanálisis no pudo encolarse en n8n.',
      };
    }

    const executionId = await this.createWorkflowExecution({
      organizationId,
      workflowType: 'DOCUMENT_AI',
      documentId,
      status: 'queued',
      payload: {
        type: 'DOCUMENT_UPLOADED',
        reanalyze: true,
        documentId,
        organizationId,
        s3Key: doc.s3Key,
      },
    });
    const newMeta = { ...meta, status: 'processing', reanalyzedAt: new Date().toISOString() };
    await this.prisma.document.update({
      where: { id: documentId },
      data: { aiMetadata: newMeta as Prisma.InputJsonValue },
    });
    await this.audit.log({
      organizationId,
      entityType: 'Document',
      entityId: documentId,
      action: 'UPDATE',
      oldData: { aiMetadata: doc.aiMetadata } as Record<string, unknown>,
      newData: { aiMetadata: newMeta } as Record<string, unknown>,
    });

    const organization = await this.prisma.raw.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true, settings: true },
    });
    const settings = (organization?.settings as Record<string, unknown> | null) ?? {};
    const featureFlags = Array.isArray(settings.featureFlags)
      ? (settings.featureFlags.filter((v) => typeof v === 'string') as string[])
      : undefined;
    const featuresRequested = this.resolveFeaturesRequested(organization?.plan, featureFlags);

    const published = await this.documentEvents.publishDocumentUploaded({
      type: 'DOCUMENT_UPLOADED',
      documentId,
      organizationId,
      s3Key: doc.s3Key,
      workflowExecutionId: executionId ?? undefined,
      plan: organization?.plan,
      featureFlags,
      featuresRequested,
    });

    if (!published) {
      this.logger.warn(
        'Event bus no disponible para reanálisis. Procesando localmente con LegalAIService.',
      );
      await this.updateWorkflowExecution(executionId, 'processing', undefined, {
        startedAt: new Date().toISOString(),
      });
      this.legalAI
        .analyzeDocument(documentId)
        .catch((err) =>
          this.logger.error(`Fallback analyze failed for ${documentId}`, err),
        );
      return {
        document: { ...doc, aiMetadata: newMeta },
        message:
          'Reanálisis iniciado. El evento externo no está disponible; se procesa localmente.',
      };
    }

    await this.updateWorkflowExecution(executionId, 'processing', undefined, {
      startedAt: new Date().toISOString(),
    });
    await this.jobsQueue.enqueueHeavyJob(
      'documents.preprocess',
      { documentId, organizationId, s3Key: doc.s3Key },
      { attempts: 3, backoffMs: 3000 },
    );

    return {
      document: { ...doc, aiMetadata: newMeta },
      message: 'Reanálisis encolado. El documento se procesará en breve.',
    };
  }

  async saveAiResult(payload: AiCallbackDto) {
    return this.updateAiProcessingResult(payload);
  }

  /**
   * Actualiza los resultados de IA de un documento (callback desde n8n).
   */
  async updateDocumentAiResults(
    documentId: string,
    organizationId: string,
    body: { summary?: string; classification?: string; riskLevel?: string; aiMetadata?: Record<string, unknown> },
  ) {
    const doc = await this.prisma.raw.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, aiSummary: true, aiMetadata: true, classification: true },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');

    const mergedMetadata = {
      ...(doc.aiMetadata as Record<string, unknown> | null),
      ...body.aiMetadata,
      ...(body.riskLevel && { riskLevel: body.riskLevel }),
      status: 'completed',
      processedAt: new Date().toISOString(),
    };

    await this.prisma.raw.document.update({
      where: { id: documentId },
      data: {
        aiSummary: body.summary ?? doc.aiSummary,
        classification: body.classification ?? doc.classification,
        aiMetadata: mergedMetadata as Prisma.InputJsonValue,
      },
    });

    await this.audit.log({
      organizationId,
      entityType: 'Document',
      entityId: documentId,
      action: 'UPDATE',
      oldData: { aiSummary: doc.aiSummary, aiMetadata: doc.aiMetadata, classification: doc.classification } as Record<string, unknown>,
      newData: {
        aiSummary: body.summary ?? doc.aiSummary,
        aiMetadata: mergedMetadata,
        classification: body.classification ?? doc.classification,
      },
    });

    return { ok: true, documentId };
  }

  async updateAiProcessingResult(payload: AiCallbackDto) {
    const result = await this.prisma.raw.$transaction(async (tx) => {
      const doc = await tx.document.findFirst({
        where: {
          id: payload.documentId,
          organizationId: payload.organizationId,
        },
        select: {
          id: true,
          organizationId: true,
          s3Key: true,
          aiSummary: true,
          aiMetadata: true,
        },
      });
      if (!doc) {
        throw new NotFoundException('Documento no encontrado para callback IA.');
      }

      const summaryFromMetadata =
        typeof payload.aiMetadata.summary === 'string'
          ? payload.aiMetadata.summary
          : typeof payload.aiMetadata.ocrContent === 'string'
            ? payload.aiMetadata.ocrContent
            : null;
      const ocrText =
        typeof payload.aiMetadata.ocrContent === 'string'
          ? payload.aiMetadata.ocrContent
          : typeof payload.aiMetadata.text === 'string'
            ? payload.aiMetadata.text
            : null;
      const classification =
        typeof payload.aiMetadata.classification === 'string'
          ? payload.aiMetadata.classification
          : null;

      const mergedMetadata = {
        ...(doc.aiMetadata as Record<string, unknown> | null),
        ...payload.aiMetadata,
        status: payload.status,
        errorMessage: payload.errorMessage ?? null,
        processedAt: new Date().toISOString(),
      };

      const updated = await tx.document.update({
        where: { id: payload.documentId },
        data: {
          aiSummary: summaryFromMetadata ?? doc.aiSummary,
          aiMetadata: mergedMetadata as Prisma.InputJsonValue,
        },
        select: {
          id: true,
          organizationId: true,
          aiSummary: true,
          aiMetadata: true,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: payload.organizationId,
          entityType: 'Document',
          entityId: payload.documentId,
          action: 'UPDATE',
          oldData: {
            aiSummary: doc.aiSummary,
            aiMetadata: doc.aiMetadata,
          } as Prisma.InputJsonValue,
          newData: {
            aiSummary: updated.aiSummary,
            aiMetadata: updated.aiMetadata,
            callbackStatus: payload.status,
            callbackErrorMessage: payload.errorMessage ?? null,
          } as Prisma.InputJsonValue,
        },
      });

      if (ocrText && ocrText.trim().length > 0) {
        await tx.$executeRawUnsafe(
          `
          INSERT INTO "document_text_indexes"
            ("id", "organization_id", "document_id", "extracted_text", "updated_at", "created_at")
          VALUES
            ($1, $2, $3, $4, NOW(), NOW())
          ON CONFLICT ("document_id")
          DO UPDATE SET
            "extracted_text" = EXCLUDED."extracted_text",
            "updated_at" = NOW()
          `,
          cuidLike(),
          payload.organizationId,
          payload.documentId,
          ocrText,
        );
        if (doc.s3Key) {
          await tx.$executeRawUnsafe(
            `
            UPDATE "document_versions"
            SET "extracted_text" = $4
            WHERE "document_id" = $1
              AND "organization_id" = $2
              AND "file_url" = $3
            `,
            payload.documentId,
            payload.organizationId,
            doc.s3Key,
            ocrText,
          );
        }
      }

      const suggestedTags = Array.isArray(payload.aiMetadata.tags)
        ? payload.aiMetadata.tags.filter((x): x is string => typeof x === 'string').slice(0, 20)
        : [];
      for (const rawTag of suggestedTags) {
        const tag = rawTag.trim().toLowerCase();
        if (!tag) continue;
        await tx.$executeRawUnsafe(
          `
          INSERT INTO "document_tags"
            ("id", "organization_id", "document_id", "label", "source", "score", "created_at")
          VALUES ($1, $2, $3, $4, 'ai', NULL, NOW())
          ON CONFLICT ("document_id", "label")
          DO UPDATE SET "source" = 'ai'
          `,
          cuidLike(),
          payload.organizationId,
          payload.documentId,
          tag,
        );
      }

      if (classification) {
        await tx.$executeRawUnsafe(
          `
          UPDATE "documents"
          SET "classification" = $3
          WHERE "id" = $1 AND "organization_id" = $2
          `,
          payload.documentId,
          payload.organizationId,
          classification,
        );
      }

      await tx.$executeRawUnsafe(
        `
        UPDATE "workflow_executions"
        SET "status" = $3,
            "error_message" = $4,
            "finished_at" = NOW(),
            "updated_at" = NOW()
        WHERE "id" = (
          SELECT "id"
          FROM "workflow_executions"
          WHERE "organization_id" = $1
            AND "document_id" = $2
            AND "workflow_type" = 'DOCUMENT_AI'
            AND "status" IN ('queued', 'processing', 'failed')
          ORDER BY "created_at" DESC
          LIMIT 1
        )
        `,
        payload.organizationId,
        payload.documentId,
        payload.status,
        payload.errorMessage ?? null,
      );

      const matterRows = await tx.$queryRawUnsafe<Array<{ matter_id: string }>>(
        `SELECT "matter_id" FROM "documents" WHERE "id" = $1 AND "organization_id" = $2 LIMIT 1`,
        payload.documentId,
        payload.organizationId,
      );
      if (matterRows.length > 0) {
        await tx.matterActivity.create({
          data: {
            organizationId: payload.organizationId,
            matterId: matterRows[0].matter_id,
            type: MatterActivityType.NOTE,
            content:
              payload.status === 'completed'
                ? 'IA completada para documento.'
                : 'IA fallida para documento.',
            metadata: {
              documentId: payload.documentId,
              classification,
              tags: suggestedTags,
            } as Prisma.InputJsonValue,
          },
        });
      }

      return updated;
    });

    return {
      ok: true,
      documentId: result.id,
      organizationId: result.organizationId,
      status: payload.status,
    };
  }

  private async recordDocumentVersion(input: {
    organizationId: string;
    documentId: string;
    fileUrl: string;
    createdBy: string | null;
  }) {
    try {
      await this.prisma.raw.$executeRawUnsafe(
        `
        INSERT INTO "document_versions"
          ("id", "organization_id", "document_id", "version", "file_url", "created_by", "created_at")
        VALUES
          (
            $1,
            $2,
            $3,
            COALESCE((SELECT MAX("version") + 1 FROM "document_versions" WHERE "document_id" = $3), 1),
            $4,
            $5,
            NOW()
          )
        `,
        cuidLike(),
        input.organizationId,
        input.documentId,
        input.fileUrl,
        input.createdBy,
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo registrar DocumentVersion para documentId=${input.documentId}. Verifica migración prisma.`,
      );
      this.logger.debug(error instanceof Error ? error.message : String(error));
    }
  }

  private async createWorkflowExecution(input: {
    organizationId: string;
    workflowType: string;
    documentId: string;
    status: 'queued' | 'processing' | 'completed' | 'failed';
    payload?: Record<string, unknown>;
  }): Promise<string | null> {
    const id = cuidLike();
    try {
      await this.prisma.raw.$executeRawUnsafe(
        `
        INSERT INTO "workflow_executions"
          ("id", "organization_id", "workflow_type", "entity_type", "entity_id", "document_id", "status", "attempt_count", "payload", "created_at", "updated_at")
        VALUES
          ($1, $2, $3, 'Document', $4, $4, $5, 1, $6::jsonb, NOW(), NOW())
        `,
        id,
        input.organizationId,
        input.workflowType,
        input.documentId,
        input.status,
        JSON.stringify(input.payload ?? {}),
      );
      return id;
    } catch (error) {
      this.logger.warn(
        `No se pudo crear WorkflowExecution para documentId=${input.documentId}. Verifica migración prisma.`,
      );
      this.logger.debug(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  private async updateWorkflowExecution(
    id: string | null,
    status: 'queued' | 'processing' | 'completed' | 'failed',
    errorMessage?: string,
    options?: { startedAt?: string; externalExecutionId?: string },
  ) {
    if (!id) return;
    try {
      await this.prisma.raw.$executeRawUnsafe(
        `
        UPDATE "workflow_executions"
        SET "status" = $2,
            "error_message" = $3,
            "started_at" = COALESCE($4::timestamp, "started_at"),
            "external_execution_id" = COALESCE($5, "external_execution_id"),
            "updated_at" = NOW(),
            "finished_at" = CASE WHEN $2 IN ('completed', 'failed') THEN NOW() ELSE "finished_at" END
        WHERE "id" = $1
        `,
        id,
        status,
        errorMessage ?? null,
        options?.startedAt ?? null,
        options?.externalExecutionId ?? null,
      );
    } catch (error) {
      this.logger.debug(
        `No se pudo actualizar WorkflowExecution id=${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async completeWorkflowForDocument(input: {
    organizationId: string;
    documentId: string;
    status: 'completed' | 'failed';
    errorMessage?: string;
    executionId?: string;
    attemptCount?: number;
  }): Promise<{ attemptCount: number } | null> {
    try {
      if (input.executionId) {
        const rows = await this.prisma.raw.$queryRawUnsafe<Array<{ attempt_count: number }>>(
          `
          UPDATE "workflow_executions"
          SET "status" = $2,
              "error_message" = $3,
              "external_execution_id" = COALESCE($4, "external_execution_id"),
              "attempt_count" = CASE
                WHEN $2 = 'failed' THEN COALESCE($6, "attempt_count" + 1)
                ELSE "attempt_count"
              END,
              "finished_at" = NOW(),
              "updated_at" = NOW()
          WHERE "organization_id" = $1
            AND "document_id" = $5
            AND (
              "external_execution_id" = $4
              OR "id" = $4
            )
          RETURNING "attempt_count"
          `,
          input.organizationId,
          input.status,
          input.errorMessage ?? null,
          input.executionId,
          input.documentId,
          input.attemptCount ?? null,
        );
        if (rows.length > 0) {
          return { attemptCount: rows[0].attempt_count };
        }
      }

      const rows = await this.prisma.raw.$queryRawUnsafe<Array<{ attempt_count: number }>>(
        `
        UPDATE "workflow_executions"
        SET "status" = $3,
            "error_message" = $4,
            "attempt_count" = CASE
              WHEN $3 = 'failed' THEN COALESCE($5, "attempt_count" + 1)
              ELSE "attempt_count"
            END,
            "finished_at" = NOW(),
            "updated_at" = NOW()
        WHERE "id" = (
          SELECT "id"
          FROM "workflow_executions"
          WHERE "organization_id" = $1
            AND "document_id" = $2
            AND "workflow_type" = 'DOCUMENT_AI'
            AND "status" IN ('queued', 'processing', 'failed')
          ORDER BY "created_at" DESC
          LIMIT 1
        )
        RETURNING "attempt_count"
        `,
        input.organizationId,
        input.documentId,
        input.status,
        input.errorMessage ?? null,
        input.attemptCount ?? null,
      );
      if (rows.length > 0) {
        return { attemptCount: rows[0].attempt_count };
      }
    } catch (error) {
      this.logger.debug(
        `No se pudo completar WorkflowExecution para documentId=${input.documentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return null;
  }

  private async notifyWorkflowFailureIfNeeded(input: {
    organizationId: string;
    documentId: string;
    executionId?: string;
    attemptCount?: number;
    errorMessage?: string;
  }) {
    const thresholdRaw = process.env.WORKFLOW_FAILURE_ALERT_THRESHOLD?.trim();
    const threshold = thresholdRaw ? Number(thresholdRaw) : 3;
    if (!Number.isFinite(threshold) || threshold < 1) return;

    const attempts = input.attemptCount ?? 1;
    if (attempts < threshold) return;

    const webhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();
    if (!webhookUrl) return;

    const text =
      `:rotating_light: Workflow DOCUMENT_AI falló ${attempts} veces\n` +
      `organizationId=${input.organizationId}\n` +
      `documentId=${input.documentId}\n` +
      `executionId=${input.executionId ?? 'n/a'}\n` +
      `error=${input.errorMessage ?? 'sin detalle'}`;

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) {
        const err = await response.text().catch(() => '');
        this.logger.warn(`Slack alert failed (${response.status}): ${err || 'no body'}`);
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo enviar alerta Slack: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private resolveFeaturesRequested(
    plan: string | undefined,
    featureFlags?: string[],
  ): string[] {
    const flags = new Set(featureFlags ?? []);
    const common = ['summary', 'classification', 'risk_score'];

    if (plan === 'FREE') return common;

    if (plan === 'PRO') {
      const proFeatures = [...common];
      if (flags.has('financial_prediction')) {
        proFeatures.push('financial_prediction');
      }
      return proFeatures;
    }

    const enterpriseFeatures = [...common, 'financial_prediction', 'deadlines_extraction'];
    if (flags.has('advanced_prediction')) {
      enterpriseFeatures.push('advanced_prediction');
    }
    return enterpriseFeatures;
  }

  async findByMatter(
    organizationId: string,
    filters: {
      userId?: string;
      userRole?: UserRole;
      matterId?: string;
      name?: string;
      mimeType?: string;
      folder?: string;
      from?: Date;
      to?: Date;
      q?: string;
      tag?: string;
      classification?: string;
    },
  ) {
    if (filters.matterId) {
      await this.prisma.raw.matter.findFirstOrThrow({
        where: { id: filters.matterId, organizationId },
      });
    }
    const conditions: string[] = ['d."organization_id" = $1', 'd."deleted_at" IS NULL'];
    const params: unknown[] = [organizationId];

    if (filters.matterId) {
      params.push(filters.matterId);
      conditions.push(`d."matter_id" = $${params.length}`);
    }
    if (filters.name) {
      params.push(`%${filters.name}%`);
      conditions.push(`d."name" ILIKE $${params.length}`);
    }
    if (filters.mimeType) {
      params.push(filters.mimeType);
      conditions.push(`d."mime_type" = $${params.length}`);
    }
    if (filters.folder) {
      params.push(filters.folder);
      conditions.push(`d."folder" = $${params.length}`);
    }
    if (filters.from) {
      params.push(filters.from.toISOString());
      conditions.push(`d."created_at" >= $${params.length}::timestamp`);
    }
    if (filters.to) {
      params.push(filters.to.toISOString());
      conditions.push(`d."created_at" <= $${params.length}::timestamp`);
    }
    if (filters.classification) {
      params.push(filters.classification);
      conditions.push(`d."classification" = $${params.length}`);
    }
    if (filters.tag) {
      params.push(filters.tag.toLowerCase());
      conditions.push(
        `EXISTS (SELECT 1 FROM "document_tags" dt WHERE dt."document_id" = d."id" AND dt."label" = $${params.length})`,
      );
    }
    if (filters.q) {
      params.push(`%${filters.q}%`);
      conditions.push(
        `(d."name" ILIKE $${params.length} OR EXISTS (SELECT 1 FROM "document_text_indexes" dti WHERE dti."document_id" = d."id" AND dti."extracted_text" ILIKE $${params.length}))`,
      );
    }

    if (filters.userRole === UserRole.VIEWER && filters.userId) {
      params.push(filters.userId);
      conditions.push(
        `(d."restricted_to_user_id" IS NULL OR d."restricted_to_user_id" = $${params.length})`,
      );
    }

    const rows = await this.prisma.raw.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT
        "id",
        "organization_id" AS "organizationId",
        "matter_id" AS "matterId",
        "folder",
        "name",
        "s3_key" AS "s3Key",
        "mime_type" AS "mimeType",
        "size_bytes" AS "sizeBytes",
        "uploaded_by_id" AS "uploadedById",
        "file_hash" AS "fileHash",
        "is_pinned" AS "isPinned",
        "restricted_to_user_id" AS "restrictedToUserId",
        "confidentiality_level" AS "confidentialityLevel",
        "classification",
        COALESCE(
          (SELECT MAX("version") FROM "document_versions" dv WHERE dv."document_id" = d."id"),
          1
        ) AS "currentVersion",
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object('label', dt."label", 'source', dt."source")) FROM "document_tags" dt WHERE dt."document_id" = d."id"),
          '[]'::jsonb
        ) AS "tags",
        "ai_summary" AS "aiSummary",
        "ai_metadata" AS "aiMetadata",
        "created_at" AS "createdAt",
        "deleted_at" AS "deletedAt"
      FROM "documents" d
      WHERE ${conditions.join(' AND ')}
      ORDER BY "is_pinned" DESC, "created_at" DESC
      `,
      ...params,
    );
    return rows;
  }

  async findOne(
    organizationId: string,
    id: string,
    userId?: string,
    userRole?: UserRole,
  ) {
    const rows = await this.prisma.raw.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT
        "id",
        "organization_id" AS "organizationId",
        "matter_id" AS "matterId",
        "folder",
        "name",
        "s3_key" AS "s3Key",
        "mime_type" AS "mimeType",
        "size_bytes" AS "sizeBytes",
        "uploaded_by_id" AS "uploadedById",
        "file_hash" AS "fileHash",
        "is_pinned" AS "isPinned",
        "restricted_to_user_id" AS "restrictedToUserId",
        "confidentiality_level" AS "confidentialityLevel",
        "classification",
        COALESCE(
          (SELECT MAX("version") FROM "document_versions" dv WHERE dv."document_id" = d."id"),
          1
        ) AS "currentVersion",
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object('label', dt."label", 'source', dt."source")) FROM "document_tags" dt WHERE dt."document_id" = d."id"),
          '[]'::jsonb
        ) AS "tags",
        "ai_summary" AS "aiSummary",
        "ai_metadata" AS "aiMetadata",
        "created_at" AS "createdAt",
        "deleted_at" AS "deletedAt"
      FROM "documents" d
      WHERE "id" = $1 AND "organization_id" = $2 AND "deleted_at" IS NULL
      LIMIT 1
      `,
      id,
      organizationId,
    );
    const doc = rows[0];
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    this.assertCanAccessDocument(doc, userId, userRole);
    this.logger.debug(
      `GET document ${id}: returning stored data (aiSummary persisted, no IA re-computation)`,
    );
    return doc;
  }

  async getReadUrl(
    organizationId: string,
    id: string,
    userId?: string,
    userRole?: UserRole,
  ) {
    const doc = await this.findOne(organizationId, id, userId, userRole);
    const url = await this.s3.getReadSignedUrl(String(doc.s3Key), 600);
    await this.audit.log({
      organizationId,
      entityType: 'Document',
      entityId: id,
      action: 'UPDATE',
      oldData: null,
      newData: { event: 'READ_URL_GENERATED' },
    });
    return {
      url,
      expiresInSeconds: 600,
      watermark: `Confidencial | ${userId ?? 'anon'} | ${new Date().toISOString()}`,
    };
  }

  async getDownloadUrl(
    organizationId: string,
    id: string,
    userId?: string,
    userRole?: UserRole,
  ) {
    const doc = await this.findOne(organizationId, id, userId, userRole);
    const url = await this.s3.getReadSignedUrl(String(doc.s3Key), 120);
    await this.audit.log({
      organizationId,
      entityType: 'Document',
      entityId: id,
      action: 'UPDATE',
      oldData: null,
      newData: { event: 'DOWNLOAD_URL_GENERATED' },
    });
    return {
      url,
      expiresInSeconds: 120,
      watermark: `Descarga controlada | ${userId ?? 'anon'} | ${new Date().toISOString()}`,
    };
  }

  async updateDocumentMetadata(
    organizationId: string,
    id: string,
    input: { name?: string; folder?: string; isPinned?: boolean; restrictedToUserId?: string | null },
    userRole?: UserRole,
  ) {
    this.assertCanMutate(userRole);
    await this.findOne(organizationId, id);
    await this.prisma.raw.$executeRawUnsafe(
      `
      UPDATE "documents"
      SET
        "name" = COALESCE($3, "name"),
        "folder" = COALESCE($4, "folder"),
        "is_pinned" = COALESCE($5, "is_pinned"),
        "restricted_to_user_id" = CASE WHEN $6 THEN NULL ELSE COALESCE($7, "restricted_to_user_id") END
      WHERE "id" = $1 AND "organization_id" = $2
      `,
      id,
      organizationId,
      input.name ?? null,
      input.folder ?? null,
      input.isPinned ?? null,
      input.restrictedToUserId === null,
      input.restrictedToUserId ?? null,
    );
    return this.findOne(organizationId, id);
  }

  async createVersionUploadUrl(
    organizationId: string,
    id: string,
    input: { fileName: string; mimeType: string; sizeBytes: number; folder?: string },
    userId?: string,
    userRole?: UserRole,
  ) {
    this.assertCanMutate(userRole);
    const doc = await this.findOne(organizationId, id);
    const matterId = String(doc.matterId);
    const safeName = input.fileName.replace(SANITIZE_FILENAME, '_').slice(0, 100);
    const newKey = `${organizationId}/${matterId}/${cuidLike()}-${safeName}`;

    await this.prisma.raw.$executeRawUnsafe(
      `
      INSERT INTO "document_versions"
        ("id", "organization_id", "document_id", "version", "file_url", "status", "created_by", "created_at")
      VALUES
        (
          $1,
          $2,
          $3,
          COALESCE((SELECT MAX("version") + 1 FROM "document_versions" WHERE "document_id" = $3), 1),
          $4,
          'draft',
          $5,
          NOW()
        )
      `,
      cuidLike(),
      organizationId,
      id,
      newKey,
      userId ?? null,
    );

    await this.prisma.raw.$executeRawUnsafe(
      `
      UPDATE "documents"
      SET
        "name" = $3,
        "mime_type" = $4,
        "size_bytes" = $5,
        "folder" = COALESCE($6, "folder"),
        "s3_key" = $7,
        "uploaded_by_id" = $8,
        "file_hash" = NULL,
        "ai_metadata" = '{"status":"pending"}'::jsonb,
        "ai_summary" = NULL
      WHERE "id" = $1 AND "organization_id" = $2
      `,
      id,
      organizationId,
      input.fileName,
      input.mimeType,
      input.sizeBytes,
      input.folder ?? null,
      newKey,
      userId ?? null,
    );

    const uploadUrl = await this.s3.getUploadSignedUrl(newKey, input.mimeType);
    await this.matterActivity.create(organizationId, matterId, {
      type: MatterActivityType.DOCUMENT_UPLOAD,
      content: `Nueva versión de documento: ${input.fileName}`,
      metadata: { documentId: id, fileName: input.fileName, newVersion: true },
      userId,
    });
    return { uploadUrl, documentId: id, s3Key: newKey };
  }

  async listVersions(
    organizationId: string,
    documentId: string,
    userId?: string,
    userRole?: UserRole,
  ) {
    await this.findOne(organizationId, documentId, userId, userRole);
    return this.prisma.raw.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT
        "id",
        "document_id" AS "documentId",
        "version",
        "file_url" AS "fileUrl",
        "status",
        "review_requested_at" AS "reviewRequestedAt",
        "review_requested_by" AS "reviewRequestedBy",
        "approved_at" AS "approvedAt",
        "approved_by" AS "approvedBy",
        "rejected_at" AS "rejectedAt",
        "rejected_by" AS "rejectedBy",
        "rejection_reason" AS "rejectionReason",
        "created_by" AS "createdBy",
        "created_at" AS "createdAt"
      FROM "document_versions"
      WHERE "organization_id" = $1 AND "document_id" = $2
      ORDER BY "version" DESC
      `,
      organizationId,
      documentId,
    );
  }

  async restoreVersion(
    organizationId: string,
    documentId: string,
    versionId: string,
    userId?: string,
    userRole?: UserRole,
  ) {
    this.assertCanMutate(userRole);
    const versions = await this.prisma.raw.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT "id", "file_url" AS "fileUrl", "status"
      FROM "document_versions"
      WHERE "organization_id" = $1 AND "document_id" = $2 AND "id" = $3
      LIMIT 1
      `,
      organizationId,
      documentId,
      versionId,
    );
    if (versions.length === 0) throw new NotFoundException('Versión no encontrada.');
    if (String(versions[0].status) !== 'approved') {
      throw new BadRequestException('Solo se puede restaurar una versión aprobada.');
    }
    const fileUrl = String(versions[0].fileUrl);
    await this.prisma.raw.$executeRawUnsafe(
      `
      UPDATE "documents"
      SET "s3_key" = $3,
          "file_hash" = NULL,
          "ai_metadata" = '{"status":"pending"}'::jsonb,
          "ai_summary" = NULL
      WHERE "id" = $1 AND "organization_id" = $2
      `,
      documentId,
      organizationId,
      fileUrl,
    );
    const doc = await this.findOne(organizationId, documentId);
    await this.matterActivity.create(organizationId, String(doc.matterId), {
      type: MatterActivityType.NOTE,
      content: 'Versión de documento restaurada.',
      metadata: { documentId, versionId },
      userId,
    });
    return doc;
  }

  async addTag(
    organizationId: string,
    documentId: string,
    input: { label: string; source?: 'manual' | 'ai' },
    userRole?: UserRole,
  ) {
    this.assertCanMutate(userRole);
    await this.findOne(organizationId, documentId);
    const label = input.label.trim().toLowerCase();
    if (!label) throw new BadRequestException('Tag inválido.');
    await this.prisma.raw.$executeRawUnsafe(
      `
      INSERT INTO "document_tags"
        ("id", "organization_id", "document_id", "label", "source", "score", "created_at")
      VALUES ($1, $2, $3, $4, $5, NULL, NOW())
      ON CONFLICT ("document_id", "label")
      DO UPDATE SET "source" = EXCLUDED."source"
      `,
      cuidLike(),
      organizationId,
      documentId,
      label,
      input.source ?? 'manual',
    );
    return this.listTags(organizationId, documentId);
  }

  async listTags(
    organizationId: string,
    documentId: string,
    userId?: string,
    userRole?: UserRole,
  ) {
    await this.findOne(organizationId, documentId, userId, userRole);
    return this.prisma.raw.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT "label", "source", "score", "created_at" AS "createdAt"
      FROM "document_tags"
      WHERE "organization_id" = $1 AND "document_id" = $2
      ORDER BY "label" ASC
      `,
      organizationId,
      documentId,
    );
  }

  async removeTag(
    organizationId: string,
    documentId: string,
    tagLabel: string,
    userRole?: UserRole,
  ) {
    this.assertCanMutate(userRole);
    await this.findOne(organizationId, documentId);
    await this.prisma.raw.$executeRawUnsafe(
      `
      DELETE FROM "document_tags"
      WHERE "organization_id" = $1 AND "document_id" = $2 AND "label" = $3
      `,
      organizationId,
      documentId,
      tagLabel.trim().toLowerCase(),
    );
    return { ok: true };
  }

  async requestVersionReview(
    organizationId: string,
    documentId: string,
    versionId: string,
    userId?: string,
    userRole?: UserRole,
  ) {
    this.assertCanMutate(userRole);
    await this.findOne(organizationId, documentId);
    await this.prisma.raw.$executeRawUnsafe(
      `
      UPDATE "document_versions"
      SET "status" = 'in_review',
          "review_requested_at" = NOW(),
          "review_requested_by" = $4
      WHERE "organization_id" = $1 AND "document_id" = $2 AND "id" = $3
      `,
      organizationId,
      documentId,
      versionId,
      userId ?? null,
    );
    return { ok: true };
  }

  async approveVersion(
    organizationId: string,
    documentId: string,
    versionId: string,
    userId?: string,
    userRole?: UserRole,
  ) {
    if (!(userRole === UserRole.OWNER || userRole === UserRole.ADMIN)) {
      throw new BadRequestException('Solo OWNER/ADMIN puede aprobar versiones.');
    }
    await this.findOne(organizationId, documentId);
    await this.prisma.raw.$executeRawUnsafe(
      `
      UPDATE "document_versions"
      SET "status" = 'approved',
          "approved_at" = NOW(),
          "approved_by" = $4,
          "rejected_at" = NULL,
          "rejected_by" = NULL,
          "rejection_reason" = NULL
      WHERE "organization_id" = $1 AND "document_id" = $2 AND "id" = $3
      `,
      organizationId,
      documentId,
      versionId,
      userId ?? null,
    );
    return { ok: true };
  }

  async rejectVersion(
    organizationId: string,
    documentId: string,
    versionId: string,
    reason: string | undefined,
    userId?: string,
    userRole?: UserRole,
  ) {
    if (!(userRole === UserRole.OWNER || userRole === UserRole.ADMIN)) {
      throw new BadRequestException('Solo OWNER/ADMIN puede rechazar versiones.');
    }
    await this.findOne(organizationId, documentId);
    await this.prisma.raw.$executeRawUnsafe(
      `
      UPDATE "document_versions"
      SET "status" = 'rejected',
          "rejected_at" = NOW(),
          "rejected_by" = $4,
          "rejection_reason" = $5
      WHERE "organization_id" = $1 AND "document_id" = $2 AND "id" = $3
      `,
      organizationId,
      documentId,
      versionId,
      userId ?? null,
      reason ?? null,
    );
    return { ok: true };
  }

  async compareVersions(
    organizationId: string,
    documentId: string,
    fromVersionId: string,
    toVersionId: string,
    userId?: string,
    userRole?: UserRole,
  ) {
    await this.findOne(organizationId, documentId, userId, userRole);
    const versions = await this.prisma.raw.$queryRawUnsafe<
      Array<{ id: string; version: number; extracted_text: string | null; file_url: string }>
    >(
      `
      SELECT "id", "version", "extracted_text", "file_url"
      FROM "document_versions"
      WHERE "organization_id" = $1
        AND "document_id" = $2
        AND "id" IN ($3, $4)
      `,
      organizationId,
      documentId,
      fromVersionId,
      toVersionId,
    );
    const from = versions.find((v) => v.id === fromVersionId);
    const to = versions.find((v) => v.id === toVersionId);
    if (!from || !to) throw new NotFoundException('Versiones no encontradas para comparar.');

    const warnings: string[] = [];

    const ensureExtractedText = async (
      v: { id: string; version: number; extracted_text: string | null; file_url: string },
    ): Promise<string> => {
      if (v.extracted_text != null && v.extracted_text.trim().length > 0) {
        return v.extracted_text;
      }
      const result = await this.legalAI.extractTextForComparison(v.file_url, null, v.file_url);
      if (result.text !== null) {
        await this.prisma.raw.$executeRawUnsafe(
          `UPDATE "document_versions" SET "extracted_text" = $2 WHERE "id" = $1`,
          v.id,
          result.text,
        );
        return result.text;
      }
      warnings.push(
        `Versión ${v.version}: ${result.reason}`,
      );
      return '';
    };

    const fromText = await ensureExtractedText(from);
    const toText = await ensureExtractedText(to);

    const fromLines = fromText.split('\n').map((x) => x.trim()).filter(Boolean);
    const toLines = toText.split('\n').map((x) => x.trim()).filter(Boolean);
    const removed = fromLines.filter((line) => !toLines.includes(line)).slice(0, 200);
    const added = toLines.filter((line) => !fromLines.includes(line)).slice(0, 200);

    const out: {
      fromVersionId: string;
      toVersionId: string;
      fromVersion: number;
      toVersion: number;
      summary: { addedCount: number; removedCount: number };
      added: string[];
      removed: string[];
      warnings?: string[];
    } = {
      fromVersionId,
      toVersionId,
      fromVersion: from.version,
      toVersion: to.version,
      summary: { addedCount: added.length, removedCount: removed.length },
      added,
      removed,
    };
    if (warnings.length > 0) out.warnings = warnings;
    return out;
  }

  async createShareLink(
    organizationId: string,
    documentId: string,
    input: { expiresInMinutes?: number; maxUses?: number; watermarkText?: string },
    userId?: string,
    userRole?: UserRole,
  ) {
    this.assertCanMutate(userRole);
    const doc = await this.findOne(organizationId, documentId);
    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(
      Date.now() + (input.expiresInMinutes ?? 60) * 60 * 1000,
    ).toISOString();
    const id = cuidLike();
    await this.prisma.raw.$executeRawUnsafe(
      `
      INSERT INTO "document_share_links"
        ("id", "organization_id", "document_id", "token", "expires_at", "max_uses", "used_count", "watermark_text", "created_by", "created_at")
      VALUES ($1, $2, $3, $4, $5::timestamp, $6, 0, $7, $8, NOW())
      `,
      id,
      organizationId,
      documentId,
      token,
      expiresAt,
      input.maxUses ?? null,
      input.watermarkText ?? null,
      userId ?? null,
    );
    await this.matterActivity.create(organizationId, String(doc.matterId), {
      type: MatterActivityType.NOTE,
      content: 'Enlace temporal seguro creado.',
      metadata: { documentId, shareLinkId: id, expiresAt },
      userId,
    });
    return {
      id,
      token,
      url: `${process.env.PUBLIC_WEB_BASE_URL ?? 'http://localhost:3000'}/public/documents/shared/${token}`,
      expiresAt,
      maxUses: input.maxUses ?? null,
    };
  }

  async listShareLinks(
    organizationId: string,
    documentId: string,
    userId?: string,
    userRole?: UserRole,
  ) {
    await this.findOne(organizationId, documentId, userId, userRole);
    return this.prisma.raw.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT
        "id",
        "token",
        "expires_at" AS "expiresAt",
        "max_uses" AS "maxUses",
        "used_count" AS "usedCount",
        "revoked_at" AS "revokedAt",
        "created_at" AS "createdAt"
      FROM "document_share_links"
      WHERE "organization_id" = $1 AND "document_id" = $2
      ORDER BY "created_at" DESC
      `,
      organizationId,
      documentId,
    );
  }

  async revokeShareLink(
    organizationId: string,
    documentId: string,
    shareLinkId: string,
    userRole?: UserRole,
  ) {
    this.assertCanMutate(userRole);
    await this.findOne(organizationId, documentId);
    await this.prisma.raw.$executeRawUnsafe(
      `
      UPDATE "document_share_links"
      SET "revoked_at" = NOW()
      WHERE "organization_id" = $1 AND "document_id" = $2 AND "id" = $3
      `,
      organizationId,
      documentId,
      shareLinkId,
    );
    return { ok: true };
  }

  async createSignatureRequest(
    organizationId: string,
    documentId: string,
    input: { provider?: string; signers?: Array<{ name?: string; email: string }> },
    userId?: string,
    userRole?: UserRole,
  ) {
    this.assertCanMutate(userRole);
    await this.findOne(organizationId, documentId);
    const id = cuidLike();
    await this.prisma.raw.$executeRawUnsafe(
      `
      INSERT INTO "document_signature_requests"
        ("id", "organization_id", "document_id", "provider", "status", "signers", "requested_by", "requested_at", "created_at", "updated_at")
      VALUES ($1, $2, $3, $4, 'pending', $5::jsonb, $6, NOW(), NOW(), NOW())
      `,
      id,
      organizationId,
      documentId,
      input.provider ?? 'manual',
      JSON.stringify(input.signers ?? []),
      userId ?? null,
    );
    return { id, status: 'pending' };
  }

  async listSignatureRequests(
    organizationId: string,
    documentId: string,
    userId?: string,
    userRole?: UserRole,
  ) {
    await this.findOne(organizationId, documentId, userId, userRole);
    return this.prisma.raw.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT
        "id",
        "provider",
        "status",
        "external_request_id" AS "externalRequestId",
        "signers",
        "evidence_url" AS "evidenceUrl",
        "requested_at" AS "requestedAt",
        "signed_at" AS "signedAt",
        "cancelled_at" AS "cancelledAt",
        "updated_at" AS "updatedAt"
      FROM "document_signature_requests"
      WHERE "organization_id" = $1 AND "document_id" = $2
      ORDER BY "created_at" DESC
      `,
      organizationId,
      documentId,
    );
  }

  async updateSignatureRequest(
    organizationId: string,
    documentId: string,
    requestId: string,
    input: { status: 'pending' | 'sent' | 'signed' | 'failed' | 'cancelled'; evidenceUrl?: string },
    userRole?: UserRole,
  ) {
    this.assertCanMutate(userRole);
    await this.findOne(organizationId, documentId);
    await this.prisma.raw.$executeRawUnsafe(
      `
      UPDATE "document_signature_requests"
      SET "status" = $4,
          "evidence_url" = COALESCE($5, "evidence_url"),
          "signed_at" = CASE WHEN $4 = 'signed' THEN NOW() ELSE "signed_at" END,
          "cancelled_at" = CASE WHEN $4 = 'cancelled' THEN NOW() ELSE "cancelled_at" END,
          "updated_at" = NOW()
      WHERE "organization_id" = $1 AND "document_id" = $2 AND "id" = $3
      `,
      organizationId,
      documentId,
      requestId,
      input.status,
      input.evidenceUrl ?? null,
    );
    return { ok: true };
  }

  async upsertRetentionPolicy(
    organizationId: string,
    input: { documentType: string; retentionDays: number; autoHardDelete?: boolean },
    userRole?: UserRole,
  ) {
    if (!(userRole === UserRole.OWNER || userRole === UserRole.ADMIN)) {
      throw new BadRequestException('Solo OWNER/ADMIN puede gestionar retención.');
    }
    await this.prisma.raw.$executeRawUnsafe(
      `
      INSERT INTO "document_retention_policies"
        ("id", "organization_id", "document_type", "retention_days", "auto_hard_delete", "created_at", "updated_at")
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT ("organization_id", "document_type")
      DO UPDATE SET
        "retention_days" = EXCLUDED."retention_days",
        "auto_hard_delete" = EXCLUDED."auto_hard_delete",
        "updated_at" = NOW()
      `,
      cuidLike(),
      organizationId,
      input.documentType.toLowerCase(),
      input.retentionDays,
      Boolean(input.autoHardDelete),
    );
    return { ok: true };
  }

  async listRetentionPolicies(organizationId: string) {
    return this.prisma.raw.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT
        "id",
        "document_type" AS "documentType",
        "retention_days" AS "retentionDays",
        "auto_hard_delete" AS "autoHardDelete",
        "updated_at" AS "updatedAt"
      FROM "document_retention_policies"
      WHERE "organization_id" = $1
      ORDER BY "document_type" ASC
      `,
      organizationId,
    );
  }

  async runRetentionSweep(organizationId: string, userRole?: UserRole) {
    if (!(userRole === UserRole.OWNER || userRole === UserRole.ADMIN)) {
      throw new BadRequestException('Solo OWNER/ADMIN puede ejecutar retención.');
    }
    const candidates = await this.prisma.raw.$queryRawUnsafe<
      Array<{ id: string; matter_id: string; document_type: string; auto_hard_delete: boolean }>
    >(
      `
      SELECT
        d."id",
        d."matter_id",
        split_part(lower(d."mime_type"), '/', 1) AS "document_type",
        p."auto_hard_delete"
      FROM "documents" d
      JOIN "document_retention_policies" p
        ON p."organization_id" = d."organization_id"
       AND p."document_type" = split_part(lower(d."mime_type"), '/', 1)
      WHERE d."organization_id" = $1
        AND d."created_at" < NOW() - (p."retention_days" || ' days')::interval
      `,
      organizationId,
    );
    let softDeleted = 0;
    let hardDeleted = 0;
    for (const item of candidates) {
      if (item.auto_hard_delete) {
        await this.prisma.raw.$executeRawUnsafe(
          `DELETE FROM "documents" WHERE "organization_id" = $1 AND "id" = $2`,
          organizationId,
          item.id,
        );
        hardDeleted += 1;
      } else {
        await this.prisma.raw.$executeRawUnsafe(
          `
          UPDATE "documents"
          SET "deleted_at" = COALESCE("deleted_at", NOW())
          WHERE "organization_id" = $1 AND "id" = $2
          `,
          organizationId,
          item.id,
        );
        softDeleted += 1;
      }
    }
    return { scanned: candidates.length, softDeleted, hardDeleted };
  }

  async getTimeline(
    organizationId: string,
    documentId: string,
    userId?: string,
    userRole?: UserRole,
  ) {
    const doc = await this.findOne(organizationId, documentId, userId, userRole);
    const [audit, activities] = await Promise.all([
      this.prisma.raw.auditLog.findMany({
        where: { organizationId, entityType: 'Document', entityId: documentId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.raw.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `
        SELECT *
        FROM "matter_activities"
        WHERE "organization_id" = $1
          AND "matter_id" = $2
          AND "metadata"->>'documentId' = $3
        ORDER BY "created_at" DESC
        LIMIT 100
        `,
        organizationId,
        String(doc.matterId),
        documentId,
      ),
    ]);
    return {
      documentId,
      audit,
      matterActivity: activities,
    };
  }

  async resolveSharedLink(token: string, requesterIp?: string) {
    const rows = await this.prisma.raw.$queryRawUnsafe<
      Array<{
        id: string;
        organization_id: string;
        document_id: string;
        expires_at: Date | null;
        max_uses: number | null;
        used_count: number;
        revoked_at: Date | null;
        watermark_text: string | null;
      }>
    >(
      `
      SELECT
        "id",
        "organization_id",
        "document_id",
        "expires_at",
        "max_uses",
        "used_count",
        "revoked_at",
        "watermark_text"
      FROM "document_share_links"
      WHERE "token" = $1
      LIMIT 1
      `,
      token,
    );
    const link = rows[0];
    if (!link || link.revoked_at) {
      throw new NotFoundException('Enlace inválido o revocado.');
    }
    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
      throw new ForbiddenException('Enlace expirado.');
    }
    if (link.max_uses && link.used_count >= link.max_uses) {
      throw new ForbiddenException('Enlace sin usos disponibles.');
    }
    const docs = await this.prisma.raw.$queryRawUnsafe<Array<{ s3_key: string }>>(
      `
      SELECT "s3_key"
      FROM "documents"
      WHERE "organization_id" = $1 AND "id" = $2 AND "deleted_at" IS NULL
      LIMIT 1
      `,
      link.organization_id,
      link.document_id,
    );
    if (docs.length === 0) {
      throw new NotFoundException('Documento no encontrado.');
    }
    const url = await this.s3.getReadSignedUrl(String(docs[0].s3_key), 120);
    await this.prisma.raw.$executeRawUnsafe(
      `
      UPDATE "document_share_links"
      SET "used_count" = "used_count" + 1,
          "last_access_ip" = $2,
          "last_access_at" = NOW(),
          "updated_at" = NOW()
      WHERE "id" = $1
      `,
      link.id,
      requesterIp ?? null,
    );
    return {
      url,
      documentId: link.document_id,
      organizationId: link.organization_id,
      watermark: link.watermark_text ?? `Confidencial | ${new Date().toISOString()}`,
      expiresInSeconds: 120,
    };
  }

  async moveToTrash(organizationId: string, id: string, userId?: string, userRole?: UserRole) {
    this.assertCanMutate(userRole);
    const doc = await this.findOne(organizationId, id);
    await this.prisma.raw.$executeRawUnsafe(
      `
      UPDATE "documents"
      SET "deleted_at" = NOW(), "deleted_by_id" = $3
      WHERE "id" = $1 AND "organization_id" = $2
      `,
      id,
      organizationId,
      userId ?? null,
    );
    await this.audit.log({
      organizationId,
      userId,
      entityType: 'Document',
      entityId: id,
      action: 'DELETE',
      oldData: doc as Record<string, unknown>,
    });
    return { ok: true };
  }

  async listTrash(organizationId: string, matterId?: string) {
    const conditions = ['"organization_id" = $1', '"deleted_at" IS NOT NULL'];
    const params: unknown[] = [organizationId];
    if (matterId) {
      params.push(matterId);
      conditions.push(`"matter_id" = $${params.length}`);
    }
    return this.prisma.raw.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT
        "id",
        "matter_id" AS "matterId",
        "name",
        "mime_type" AS "mimeType",
        "size_bytes" AS "sizeBytes",
        "folder",
        "deleted_at" AS "deletedAt",
        "deleted_by_id" AS "deletedById",
        "created_at" AS "createdAt"
      FROM "documents"
      WHERE ${conditions.join(' AND ')}
      ORDER BY "deleted_at" DESC
      `,
      ...params,
    );
  }

  async getVersionReadUrl(
    organizationId: string,
    documentId: string,
    versionId: string,
    userId?: string,
    userRole?: UserRole,
  ) {
    await this.findOne(organizationId, documentId, userId, userRole);
    const versions = await this.prisma.raw.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT "file_url" AS "fileUrl"
      FROM "document_versions"
      WHERE "organization_id" = $1 AND "document_id" = $2 AND "id" = $3
      LIMIT 1
      `,
      organizationId,
      documentId,
      versionId,
    );
    if (versions.length === 0) throw new NotFoundException('Versión no encontrada.');
    const url = await this.s3.getReadSignedUrl(String(versions[0].fileUrl), 600);
    return { url, expiresInSeconds: 600 };
  }

  async getVersionDownloadUrl(
    organizationId: string,
    documentId: string,
    versionId: string,
    userId?: string,
    userRole?: UserRole,
  ) {
    await this.findOne(organizationId, documentId, userId, userRole);
    const versions = await this.prisma.raw.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT "file_url" AS "fileUrl"
      FROM "document_versions"
      WHERE "organization_id" = $1 AND "document_id" = $2 AND "id" = $3
      LIMIT 1
      `,
      organizationId,
      documentId,
      versionId,
    );
    if (versions.length === 0) throw new NotFoundException('Versión no encontrada.');
    const url = await this.s3.getReadSignedUrl(String(versions[0].fileUrl), 120);
    return { url, expiresInSeconds: 120 };
  }

  async restoreFromTrash(organizationId: string, id: string, userRole?: UserRole) {
    this.assertCanMutate(userRole);
    await this.prisma.raw.$executeRawUnsafe(
      `
      UPDATE "documents"
      SET "deleted_at" = NULL, "deleted_by_id" = NULL
      WHERE "id" = $1 AND "organization_id" = $2
      `,
      id,
      organizationId,
    );
    return this.findOne(organizationId, id);
  }

  async hardDelete(organizationId: string, id: string, userRole?: UserRole) {
    if (!(userRole === UserRole.OWNER || userRole === UserRole.ADMIN)) {
      throw new BadRequestException('Solo OWNER/ADMIN puede borrar permanentemente.');
    }
    const docs = await this.prisma.raw.$queryRawUnsafe<Array<{ s3_key: string }>>(
      `SELECT "s3_key" FROM "documents" WHERE "id" = $1 AND "organization_id" = $2`,
      id,
      organizationId,
    );
    if (docs.length === 0) {
      throw new NotFoundException('Documento no encontrado o ya eliminado permanentemente.');
    }
    const s3Key = docs[0].s3_key;
    const versions = await this.prisma.raw.$queryRawUnsafe<Array<{ file_url: string }>>(
      `SELECT "file_url" AS "file_url" FROM "document_versions" WHERE "document_id" = $1 AND "organization_id" = $2`,
      id,
      organizationId,
    );
    if (this.s3.isConfigured()) {
      await this.s3.deleteObject(s3Key);
      for (const v of versions) {
        if (v.file_url) await this.s3.deleteObject(v.file_url);
      }
    }
    await this.prisma.raw.$executeRawUnsafe(
      `DELETE FROM "document_versions" WHERE "document_id" = $1 AND "organization_id" = $2`,
      id,
      organizationId,
    );
    await this.prisma.raw.$executeRawUnsafe(
      `DELETE FROM "documents" WHERE "id" = $1 AND "organization_id" = $2`,
      id,
      organizationId,
    );
    return { ok: true };
  }

  private assertCanAccessDocument(
    doc: Record<string, unknown>,
    userId?: string,
    userRole?: UserRole,
  ) {
    const restrictedToUserId =
      typeof doc.restrictedToUserId === 'string' ? doc.restrictedToUserId : null;
    if (restrictedToUserId && restrictedToUserId !== userId) {
      throw new ForbiddenException('No tienes permiso para acceder a este documento.');
    }
    const confidentiality =
      typeof doc.confidentialityLevel === 'string'
        ? doc.confidentialityLevel.toUpperCase()
        : 'INTERNAL';
    if (confidentiality === 'STRICT' && !(userRole === UserRole.OWNER || userRole === UserRole.ADMIN)) {
      throw new ForbiddenException('Documento restringido por nivel de confidencialidad.');
    }
  }

  private assertCanMutate(userRole?: UserRole) {
    if (userRole === UserRole.VIEWER) {
      throw new BadRequestException('VIEWER no tiene permisos para modificar documentos.');
    }
  }

  /**
   * Subida pública de documento por token del expediente (portal del cliente).
   * No requiere autenticación; el token identifica el expediente.
   */
  async uploadByMatterToken(
    token: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ) {
    if (!this.s3.isConfigured()) {
      throw new BadRequestException('El servicio de almacenamiento no está disponible.');
    }
    const matter = await this.prisma.raw.matter.findFirst({
      where: { publicToken: token },
      select: { id: true, organizationId: true },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado o enlace no válido.');

    const MAX_SIZE = 25 * 1024 * 1024; // 25 MB
    if (file.size > MAX_SIZE) {
      throw new BadRequestException('El archivo no puede superar 25 MB.');
    }
    const allowed = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    const mime = file.mimetype?.toLowerCase() ?? '';
    const ext = file.originalname?.toLowerCase().split('.').pop() ?? '';
    const allowedByExt = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'];
    if (!allowed.includes(mime) && !allowedByExt.includes(ext)) {
      throw new BadRequestException('Solo se permiten PDF, imágenes o documentos Word.');
    }

    const safeName = file.originalname.replace(SANITIZE_FILENAME, '_').slice(0, 100);
    const key = `${matter.organizationId}/${matter.id}/public_${cuidLike()}-${safeName}`;

    const doc = await this.prisma.document.create({
      data: {
        organizationId: matter.organizationId,
        matterId: matter.id,
        folder: 'Cliente',
        name: file.originalname,
        s3Key: key,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedById: null,
        aiMetadata: { status: 'pending', source: 'portal' },
      },
    });

    await this.s3.putObject(key, file.buffer, file.mimetype);
    await this.recordDocumentVersion({
      organizationId: matter.organizationId,
      documentId: doc.id,
      fileUrl: key,
      createdBy: null,
    });
    await this.matterActivity.create(matter.organizationId, matter.id, {
      type: MatterActivityType.DOCUMENT_UPLOAD,
      content: `Documento subido por el cliente: ${file.originalname}`,
      metadata: { documentId: doc.id, fileName: file.originalname, folder: 'Cliente' },
      isPublic: true,
    });

    return { documentId: doc.id, name: doc.name };
  }
}

function cuidLike(): string {
  return `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
