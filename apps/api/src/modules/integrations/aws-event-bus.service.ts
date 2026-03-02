import { Injectable, Logger } from '@nestjs/common';

type PublishInput = {
  topicArn: string;
  message: Record<string, unknown>;
  messageAttributes?: Record<string, string>;
};

@Injectable()
export class AwsEventBusService {
  private readonly logger = new Logger(AwsEventBusService.name);
  private snsClient: unknown | null = null;
  private sqsClient: unknown | null = null;

  async publishToSns(input: PublishInput): Promise<boolean> {
    const sns = await this.getSnsClient();
    if (!sns) return false;
    try {
      const { PublishCommand } = (await dynamicImport('@aws-sdk/client-sns')) as {
        PublishCommand: new (args: unknown) => unknown;
      };
      const MessageAttributes = Object.fromEntries(
        Object.entries(input.messageAttributes ?? {}).map(([key, value]) => [
          key,
          { DataType: 'String', StringValue: value },
        ]),
      );
      const command = new PublishCommand({
        TopicArn: input.topicArn,
        Message: JSON.stringify(input.message),
        MessageAttributes,
      });
      await (sns as { send(command: unknown): Promise<unknown> }).send(command);
      return true;
    } catch (error) {
      this.logger.error('Failed to publish message to SNS', error as Error);
      return false;
    }
  }

  async sendToSqs(queueUrl: string, message: Record<string, unknown>): Promise<boolean> {
    const sqs = await this.getSqsClient();
    if (!sqs) return false;
    try {
      const { SendMessageCommand } = (await dynamicImport('@aws-sdk/client-sqs')) as {
        SendMessageCommand: new (args: unknown) => unknown;
      };
      const command = new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(message),
      });
      await (sqs as { send(command: unknown): Promise<unknown> }).send(command);
      return true;
    } catch (error) {
      this.logger.error('Failed to send message to SQS', error as Error);
      return false;
    }
  }

  private async getSnsClient(): Promise<unknown | null> {
    if (this.snsClient) return this.snsClient;
    try {
      const { SNSClient } = (await dynamicImport('@aws-sdk/client-sns')) as {
        SNSClient: new (args: unknown) => unknown;
      };
      this.snsClient = new SNSClient(this.getAwsClientConfig(process.env.AWS_ENDPOINT_URL_SNS));
      return this.snsClient;
    } catch {
      this.logger.warn(
        'SNS SDK no disponible. Instala @aws-sdk/client-sns para habilitar EVENT_BUS_MODE=sns.',
      );
      return null;
    }
  }

  private async getSqsClient(): Promise<unknown | null> {
    if (this.sqsClient) return this.sqsClient;
    try {
      const { SQSClient } = (await dynamicImport('@aws-sdk/client-sqs')) as {
        SQSClient: new (args: unknown) => unknown;
      };
      this.sqsClient = new SQSClient(this.getAwsClientConfig(process.env.AWS_ENDPOINT_URL_SQS));
      return this.sqsClient;
    } catch {
      this.logger.warn(
        'SQS SDK no disponible. Instala @aws-sdk/client-sqs para habilitar DLQ/SQS real.',
      );
      return null;
    }
  }

  private getAwsClientConfig(endpoint?: string): Record<string, unknown> {
    const config: Record<string, unknown> = {
      region: process.env.AWS_REGION ?? 'us-east-1',
    };
    if (endpoint?.trim()) {
      config.endpoint = endpoint.trim();
    }
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      };
    }
    return config;
  }
}

const dynamicImport = new Function(
  'modulePath',
  'return import(modulePath)',
) as (modulePath: string) => Promise<unknown>;
