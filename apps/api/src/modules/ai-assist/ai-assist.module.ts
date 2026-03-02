import { Module } from '@nestjs/common';
import { LegalAIAssistService } from './legal-ai-assist.service';
import { AiAssistController } from './ai-assist.controller';
import { DeadlinesModule } from '../deadlines/deadlines.module';
import { TasksModule } from '../tasks/tasks.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [DeadlinesModule, TasksModule, DocumentsModule],
  controllers: [AiAssistController],
  providers: [LegalAIAssistService],
})
export class AiAssistModule {}
