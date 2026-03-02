import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { InternalDocumentsController } from './internal-documents.controller';
import { DocumentsService } from './documents.service';
import { S3Service } from './s3.service';
import { LegalAIService } from './legal-ai.service';
import { UsageLimitService } from './usage-limit.service';
import { MatterActivityModule } from '../matter-activity/matter-activity.module';
import { AuditModule } from '../audit/audit.module';
import { DocumentEventsService } from './document-events.service';
import { N8nOrchestratorService } from './n8n-orchestrator.service';
import { InternalWebhookGuard } from '../../common/guards/internal-webhook.guard';

@Module({
  imports: [MatterActivityModule, AuditModule],
  controllers: [DocumentsController, InternalDocumentsController],
  providers: [
    S3Service,
    LegalAIService,
    UsageLimitService,
    DocumentEventsService,
    N8nOrchestratorService,
    InternalWebhookGuard,
    DocumentsService,
  ],
  exports: [DocumentsService, UsageLimitService, S3Service],
})
export class DocumentsModule {}
