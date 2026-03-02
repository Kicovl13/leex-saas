import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

async function checkRedis(): Promise<'connected' | 'disconnected'> {
  try {
    const url = process.env.BULLMQ_REDIS_URL ?? 'redis://localhost:6379';
    const { default: Redis } = await import('ioredis');
    const RedisClass = Redis as unknown as new (url: string, opts?: object) => { ping: () => Promise<string>; quit: () => Promise<string> };
    const redis = new RedisClass(url, { maxRetriesPerRequest: 1, connectTimeout: 3000 });
    await redis.ping();
    await redis.quit();
    return 'connected';
  } catch {
    return 'disconnected';
  }
}

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    const result: Record<string, string> = {};

    try {
      await this.prisma.raw.$queryRaw`SELECT 1`;
      result.db = 'connected';
    } catch (err) {
      result.db = 'disconnected';
      throw new ServiceUnavailableException({
        status: 'error',
        checks: { ...result, db: 'disconnected' },
        message: err instanceof Error ? err.message : 'DB connection failed',
      });
    }

    if (process.env.AWS_S3_BUCKET?.trim()) {
      try {
        const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
        const { S3Client } = await import('@aws-sdk/client-s3');
        const region = process.env.AWS_REGION ?? 'eu-west-1';
        const client = new S3Client({
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
        await client.send(
          new HeadBucketCommand({ Bucket: process.env.AWS_S3_BUCKET }),
        );
        result.s3 = 'connected';
      } catch {
        result.s3 = 'disconnected';
      }
    } else {
      result.s3 = 'skipped';
    }

    const redisUrl = process.env.BULLMQ_REDIS_URL?.trim();
    if (redisUrl || process.env.BULLMQ_REDIS_URL === undefined) {
      result.redis = await checkRedis();
    } else {
      result.redis = 'skipped';
    }

    return {
      status: result.db === 'connected' ? 'ok' : 'error',
      checks: result,
    };
  }
}
