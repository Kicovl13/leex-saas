import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class JobsQueueService {
  private readonly logger = new Logger(JobsQueueService.name);
  private queue: unknown | null = null;
  private initialized = false;

  async enqueueHeavyJob(
    jobName: string,
    payload: Record<string, unknown>,
    opts?: { attempts?: number; backoffMs?: number },
  ): Promise<boolean> {
    const queue = await this.getQueue();
    if (!queue) return false;
    try {
      await (queue as { add(name: string, data: unknown, options: unknown): Promise<unknown> }).add(
        jobName,
        payload,
        {
          attempts: opts?.attempts ?? 3,
          backoff: { type: 'exponential', delay: opts?.backoffMs ?? 2000 },
          removeOnComplete: 500,
          removeOnFail: 1000,
        },
      );
      return true;
    } catch (error) {
      this.logger.error(`Failed to enqueue job ${jobName}`, error as Error);
      return false;
    }
  }

  private async getQueue(): Promise<unknown | null> {
    if (this.initialized) return this.queue;
    this.initialized = true;
    if (process.env.BULLMQ_ENABLED !== 'true') {
      this.logger.debug('BullMQ deshabilitado (BULLMQ_ENABLED!=true).');
      return null;
    }
    try {
      const [{ Queue }, { default: IORedis }] = await Promise.all([
        dynamicImport('bullmq') as Promise<{ Queue: new (name: string, options: unknown) => unknown }>,
        dynamicImport('ioredis') as Promise<{ default: new (url: string) => unknown }>,
      ]);
      const redisUrl = process.env.BULLMQ_REDIS_URL ?? 'redis://localhost:6379';
      const connection = new IORedis(redisUrl);
      this.queue = new Queue(process.env.BULLMQ_HEAVY_QUEUE_NAME ?? 'lex:heavy-jobs', {
        connection,
      });
      return this.queue;
    } catch {
      this.logger.warn(
        'BullMQ no disponible. Instala bullmq e ioredis para habilitar cola real.',
      );
      return null;
    }
  }
}

const dynamicImport = new Function(
  'modulePath',
  'return import(modulePath)',
) as (modulePath: string) => Promise<unknown>;
