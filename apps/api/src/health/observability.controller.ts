import {
  Controller,
  Get,
  Post,
  Param,
  Headers,
  ServiceUnavailableException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentsService } from '../modules/documents/documents.service';

/**
 * Tablero de observabilidad: errores por org y tiempos de procesamiento.
 * Protegido por OBSERVABILITY_TOKEN (opcional; si no está configurado devuelve 503).
 */
@Controller('observability')
export class ObservabilityController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  @Get('workflows')
  async getWorkflowStats(
    @Headers('x-observability-token') token: string | undefined,
  ) {
    const expectedToken = process.env.OBSERVABILITY_TOKEN?.trim();
    if (!expectedToken) {
      throw new ServiceUnavailableException(
        'OBSERVABILITY_TOKEN no está configurado.',
      );
    }
    if (!token || token.trim() !== expectedToken) {
      throw new UnauthorizedException('Token de observabilidad inválido.');
    }

    const [errorsByOrg, processingStats] = await Promise.all([
      this.getErrorsByOrg(),
      this.getProcessingStats(),
    ]);

    return {
      workflowErrorsByOrg: errorsByOrg,
      workflowProcessingStats: processingStats,
    };
  }

  private async getErrorsByOrg() {
    const rows = await this.prisma.raw.$queryRaw<
      Array<{ organization_id: string; failed_count: bigint }>
    >`
      SELECT organization_id, COUNT(*)::bigint AS failed_count
      FROM workflow_executions
      WHERE status = 'failed'
      GROUP BY organization_id
      ORDER BY failed_count DESC
    `;
    return rows.map((r) => ({
      organizationId: r.organization_id,
      failedCount: Number(r.failed_count),
    }));
  }

  @Post('workflows/:id/retry')
  async retryWorkflow(
    @Headers('x-observability-token') token: string | undefined,
    @Param('id') id: string,
  ) {
    const expectedToken = process.env.OBSERVABILITY_TOKEN?.trim();
    if (!expectedToken) {
      throw new ServiceUnavailableException(
        'OBSERVABILITY_TOKEN no está configurado.',
      );
    }
    if (!token || token.trim() !== expectedToken) {
      throw new UnauthorizedException('Token de observabilidad inválido.');
    }

    const rows = await this.prisma.raw.$queryRawUnsafe<
      Array<{ organization_id: string; document_id: string | null; workflow_type: string; status: string }>
    >(
      `SELECT organization_id, document_id, workflow_type, status
       FROM workflow_executions WHERE id = $1`,
      id,
    );
    if (!rows.length || rows[0].status !== 'failed') {
      throw new NotFoundException(
        'Workflow no encontrado o no está en estado failed.',
      );
    }

    const wf = rows[0];
    if (wf.workflow_type !== 'DOCUMENT_AI' || !wf.document_id) {
      throw new NotFoundException(
        'Solo se pueden reintentar workflows DOCUMENT_AI con document_id.',
      );
    }

    await this.documents.reanalyze(wf.organization_id, wf.document_id);
    return { ok: true, message: 'Reanálisis encolado.' };
  }

  private async getProcessingStats() {
    const rows = await this.prisma.raw.$queryRaw<
      Array<{
        organization_id: string;
        completed_count: bigint;
        avg_seconds: string | null;
      }>
    >`
      SELECT
        organization_id,
        COUNT(*)::bigint AS completed_count,
        AVG(EXTRACT(EPOCH FROM (finished_at - started_at)))::text AS avg_seconds
      FROM workflow_executions
      WHERE status = 'completed'
        AND started_at IS NOT NULL
        AND finished_at IS NOT NULL
      GROUP BY organization_id
    `;
    return rows.map((r) => ({
      organizationId: r.organization_id,
      completedCount: Number(r.completed_count),
      avgProcessingSeconds:
        r.avg_seconds != null ? Math.round(Number(r.avg_seconds)) : null,
    }));
  }
}
