import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { AwsEventBusService } from '../integrations/aws-event-bus.service';

export type DocumentUploadedEvent = {
  type: 'DOCUMENT_UPLOADED';
  documentId: string;
  organizationId: string;
  s3Key: string;
  workflowExecutionId?: string;
  plan?: string;
  featureFlags?: string[];
  featuresRequested?: string[];
};

@Injectable()
export class DocumentEventsService {
  private readonly logger = new Logger(DocumentEventsService.name);
  constructor(private readonly awsEventBus: AwsEventBusService) {}

  isConfigured(): boolean {
    const mode = process.env.EVENT_BUS_MODE?.trim();
    if (mode === 'sns') return Boolean(process.env.AWS_SNS_TOPIC_DOCUMENT_UPLOADED_ARN?.trim());
    return Boolean(process.env.EVENT_BUS_DOCUMENT_UPLOADED_URL?.trim());
  }

  async publishDocumentUploaded(event: DocumentUploadedEvent): Promise<boolean> {
    if (process.env.USE_LOCAL_AI_ONLY === 'true' || process.env.USE_LOCAL_AI_ONLY === '1') {
      return false;
    }
    const mode = process.env.EVENT_BUS_MODE?.trim() ?? 'webhook';
    if (mode === 'sns') {
      const topicArn = process.env.AWS_SNS_TOPIC_DOCUMENT_UPLOADED_ARN?.trim();
      if (!topicArn) return false;
      const published = await this.awsEventBus.publishToSns({
        topicArn,
        message: event,
        messageAttributes: {
          eventType: event.type,
          organizationId: event.organizationId,
        },
      });
      if (published) {
        this.logger.log(`DOCUMENT_UPLOADED published to SNS for document ${event.documentId}`);
      }
      return published;
    }

    const url = process.env.EVENT_BUS_DOCUMENT_UPLOADED_URL?.trim();
    if (!url) return false;

    const body = JSON.stringify(event);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };

    const token = process.env.EVENT_BUS_INTERNAL_TOKEN?.trim();
    if (token) headers['x-internal-token'] = token;

    const hmacSecret = process.env.EVENT_BUS_HMAC_SECRET?.trim();
    if (hmacSecret) {
      headers['x-signature'] = createHmac('sha256', hmacSecret).update(body).digest('hex');
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        this.logger.error(
          `Failed to publish DOCUMENT_UPLOADED (${response.status}): ${errorText || 'no response body'}`,
        );
        return false;
      }
      this.logger.log(`DOCUMENT_UPLOADED published for document ${event.documentId}`);
      return true;
    } catch (error) {
      this.logger.error(`Error publishing DOCUMENT_UPLOADED for ${event.documentId}`, error as Error);
      return false;
    }
  }

  async sendToDlq(message: Record<string, unknown>): Promise<boolean> {
    const dlqUrl = process.env.AWS_SQS_DLQ_URL?.trim();
    if (!dlqUrl) return false;
    return this.awsEventBus.sendToSqs(dlqUrl, message);
  }
}
