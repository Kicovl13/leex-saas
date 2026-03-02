import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma';
import { orgScopeExtension } from './prisma-org-scope.extension';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Configure it in apps/api/.env');
}
const adapter = new PrismaPg({ connectionString });
const prismaOptions = { adapter };

const createExtendedClient = () =>
  new PrismaClient(prismaOptions).$extends(orgScopeExtension());

export type ExtendedPrismaClient = ReturnType<typeof createExtendedClient>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly _client: ExtendedPrismaClient = createExtendedClient();
  private readonly _raw = new PrismaClient(prismaOptions);

  async onModuleInit(): Promise<void> {
    await this._client.$connect();
    await this._raw.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this._client.$disconnect();
    await this._raw.$disconnect();
  }

  /** Cliente sin filtro por organización; usar solo para comprobar existencia en otra org (ej. 403). */
  get raw(): PrismaClient {
    return this._raw;
  }

  get organization() {
    return this._client.organization;
  }
  get user() {
    return this._client.user;
  }
  get client() {
    return this._client.client;
  }
  get matter() {
    return this._client.matter;
  }
  get document() {
    return this._client.document;
  }
  get deadline() {
    return this._client.deadline;
  }
  get timeEntry() {
    return this._client.timeEntry;
  }
  get task() {
    return this._client.task;
  }
  get organizationHoliday() {
    return this._client.organizationHoliday;
  }
  get matterActivity() {
    return this._client.matterActivity;
  }
  get auditLog() {
    return this._client.auditLog;
  }
  get template() {
    return this._client.template;
  }
}
