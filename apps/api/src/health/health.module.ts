import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ObservabilityController } from './observability.controller';
import { MetricsController } from './metrics.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentsModule } from '../modules/documents/documents.module';

@Module({
  imports: [PrismaModule, DocumentsModule],
  controllers: [HealthController, ObservabilityController, MetricsController],
})
export class HealthModule {}
