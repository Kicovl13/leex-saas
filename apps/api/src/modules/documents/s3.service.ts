import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const region = process.env.AWS_REGION ?? 'eu-west-1';
    this.bucket = process.env.AWS_S3_BUCKET ?? '';
    this.client = new S3Client({
      region,
      ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    });
  }

  /**
   * Genera una URL firmada para que el cliente suba un archivo con PUT.
   */
  async getUploadSignedUrl(
    key: string,
    contentType: string,
    kmsKeyId?: string,
    expiresInSeconds = 3600,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ...(kmsKeyId
        ? {
            ServerSideEncryption: 'aws:kms',
            SSEKMSKeyId: kmsKeyId,
          }
        : {}),
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Sube un objeto a S3 desde el servidor (ej. plantilla Word).
   */
  async putObject(
    key: string,
    body: Buffer | Uint8Array,
    contentType: string,
    kmsKeyId?: string,
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...(kmsKeyId
        ? {
            ServerSideEncryption: 'aws:kms',
            SSEKMSKeyId: kmsKeyId,
          }
        : {}),
    });
    await this.client.send(command);
  }

  /**
   * Descarga el objeto de S3 y devuelve el body como Buffer.
   */
  async getObject(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const response = await this.client.send(command);
    const stream = response.Body;
    if (!stream) throw new Error('Empty S3 body');
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * URL firmada para leer un objeto (ej. logo del despacho).
   */
  async getReadSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Elimina un objeto de S3. No lanza error si el objeto no existe.
   */
  async deleteObject(key: string): Promise<void> {
    if (!this.bucket) return;
    try {
      const command = new DeleteObjectCommand({ Bucket: this.bucket, Key: key });
      await this.client.send(command);
    } catch (e) {
      this.logger.warn(`No se pudo eliminar S3 ${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  isConfigured(): boolean {
    return Boolean(this.bucket && process.env.AWS_ACCESS_KEY_ID);
  }
}
