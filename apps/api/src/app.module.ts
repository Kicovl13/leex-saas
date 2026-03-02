import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from './prisma/prisma.service';
import { ORGANIZATION_ID_KEY } from './common/decorators/organization-id.decorator';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { ClientsModule } from './modules/clients/clients.module';
import { MattersModule } from './modules/matters/matters.module';
import { MatterActivityModule } from './modules/matter-activity/matter-activity.module';
import { DeadlinesModule } from './modules/deadlines/deadlines.module';
import { TimeEntriesModule } from './modules/time-entries/time-entries.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { UsersModule } from './modules/users/users.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AuthModule } from './modules/auth/auth.module';
import { PublicModule } from './modules/public/public.module';
import { AuditModule } from './modules/audit/audit.module';
import { HealthModule } from './health/health.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { AiAssistModule } from './modules/ai-assist/ai-assist.module';
import { SearchModule } from './modules/search/search.module';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [PrismaModule],
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => {
        const limits: Record<string, number> = { FREE: 30, PRO: 100, ENTERPRISE: 500 };
        const cache = new Map<string, { plan: string; expires: number }>();
        return {
          throttlers: [
            {
              ttl: 60_000,
              limit: async (context: ExecutionContext) => {
                const req = context.switchToHttp().getRequest<{ [k: string]: string }>();
                const orgId = req[ORGANIZATION_ID_KEY];
                if (!orgId) return 30;
                const c = cache.get(orgId);
                if (c && c.expires > Date.now()) return limits[c.plan] ?? 30;
                try {
                  const org = await prisma.organization.findUnique({
                    where: { id: orgId },
                    select: { plan: true },
                  });
                  const plan = org?.plan ?? 'FREE';
                  cache.set(orgId, { plan, expires: Date.now() + 60_000 });
                  return limits[plan] ?? 30;
                } catch {
                  return 30;
                }
              },
            },
          ],
        };
      },
    }),
    PrismaModule,
    IntegrationsModule,
    JobsModule,
    HealthModule,
    AuthModule,
    PublicModule,
    AuditModule,
    ClientsModule,
    MattersModule,
    MatterActivityModule,
    DeadlinesModule,
    TimeEntriesModule,
    DashboardModule,
    DocumentsModule,
    TasksModule,
    UsersModule,
    SettingsModule,
    TemplatesModule,
    AiAssistModule,
    SearchModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('clients', 'matters', 'deadlines', 'time-entries', 'dashboard', 'documents', 'tasks', 'users', 'settings', 'templates', 'ai-assist', 'search');
  }
}
