import { Injectable, Logger } from '@nestjs/common';

export type DocumentWorkflowPayload = {
  matterId: string;
  documentId: string;
  s3Key: string;
  taskType: string;
  organizationId?: string;
};

@Injectable()
export class N8nOrchestratorService {
  private readonly logger = new Logger(N8nOrchestratorService.name);

  isConfigured(): boolean {
    if (process.env.USE_LOCAL_AI_ONLY === 'true' || process.env.USE_LOCAL_AI_ONLY === '1') {
      return false;
    }
    return Boolean(process.env.N8N_WEBHOOK_URL?.trim());
  }

  /**
   * Dispara un workflow de n8n enviando los datos del documento al webhook.
   * @returns true si el POST fue exitoso, false si no está configurado o falla
   */
  async triggerDocumentWorkflow(
    matterId: string,
    documentId: string,
    s3Key: string,
    taskType: string,
    organizationId?: string,
  ): Promise<boolean> {
    const url = process.env.N8N_WEBHOOK_URL?.trim();
    if (!url) {
      this.logger.debug('N8N_WEBHOOK_URL no configurado. Se omite el trigger.');
      return false;
    }

    const body: DocumentWorkflowPayload = {
      matterId,
      documentId,
      s3Key,
      taskType,
      ...(organizationId && { organizationId }),
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const authHeaderName = process.env.N8N_WEBHOOK_AUTH_HEADER?.trim();
    const authHeaderValue = process.env.N8N_WEBHOOK_AUTH_VALUE?.trim();
    if (authHeaderName && authHeaderValue) {
      headers[authHeaderName] = authHeaderValue;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        this.logger.error(
          `n8n webhook falló (${response.status}): ${text || 'sin respuesta'}`,
        );
        return false;
      }

      this.logger.log(
        `Workflow n8n disparado para documentId=${documentId}, taskType=${taskType}`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Error al llamar a n8n webhook para ${documentId}`,
        error instanceof Error ? error : String(error),
      );
      return false;
    }
  }
}
