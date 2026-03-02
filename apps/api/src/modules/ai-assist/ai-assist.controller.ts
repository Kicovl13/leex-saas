import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LegalAIAssistService } from './legal-ai-assist.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';

@ApiTags('AI Assist')
@ApiBearerAuth()
@Controller('ai-assist')
@UseGuards(TenantGuard)
export class AiAssistController {
  constructor(private readonly ai: LegalAIAssistService) {}

  @Get('deadlines/suggest-by-matter')
  suggestDeadlinesByMatter(
    @OrganizationId() organizationId: string,
    @Query('classification') classification: string,
  ) {
    return this.ai.suggestDeadlinesByMatter(organizationId, classification || 'OTRO');
  }

  @Post('deadlines/from-document')
  createDeadlinesFromDocument(
    @OrganizationId() organizationId: string,
    @Body() body: { documentId: string; matterId: string },
  ) {
    return this.ai.createDeadlinesFromDocument(
      organizationId,
      body.documentId,
      body.matterId,
    );
  }

  @Get('deadlines/smart-alerts')
  getSmartDeadlineAlerts(
    @OrganizationId() organizationId: string,
    @Query('limit') limit?: string,
  ) {
    return this.ai.getSmartDeadlineAlerts(
      organizationId,
      limit ? parseInt(limit, 10) : 15,
    );
  }

  @Get('tasks/suggest-from-document')
  suggestTasksFromDocument(
    @OrganizationId() organizationId: string,
    @Query('documentId') documentId: string,
    @Query('matterId') matterId: string,
  ) {
    return this.ai.suggestTasksFromDocument(
      organizationId,
      documentId,
      matterId,
    );
  }

  @Post('tasks/create-suggested')
  createSuggestedTasks(
    @OrganizationId() organizationId: string,
    @Body() body: { matterId: string; documentId: string; assignToId?: string },
  ) {
    return this.ai.createSuggestedTasks(
      organizationId,
      body.matterId,
      body.documentId,
      body.assignToId,
    );
  }

  @Get('tasks/suggest-assignment')
  suggestTaskAssignment(
    @OrganizationId() organizationId: string,
    @Query('matterId') matterId: string,
  ) {
    return this.ai.suggestTaskAssignment(organizationId, matterId);
  }

  @Get('matter/summary')
  getMatterSummary(
    @OrganizationId() organizationId: string,
    @Query('matterId') matterId: string,
  ) {
    return this.ai.getMatterSummary(organizationId, matterId);
  }

  @Get('matter/next-steps')
  getNextSteps(
    @OrganizationId() organizationId: string,
    @Query('matterId') matterId: string,
  ) {
    return this.ai.getNextSteps(organizationId, matterId);
  }

  @Get('templates/extended-data')
  getExtendedTemplateData(
    @OrganizationId() organizationId: string,
    @Query('templateId') templateId: string,
    @Query('matterId') matterId: string,
  ) {
    return this.ai.getExtendedTemplateData(
      organizationId,
      templateId,
      matterId,
    );
  }

  @Post('templates/draft-with-context')
  generateDraftWithContext(
    @OrganizationId() organizationId: string,
    @Body() body: { templateId: string; matterId: string; context?: string },
  ) {
    return this.ai.generateDraftWithContext(
      organizationId,
      body.templateId,
      body.matterId,
      body.context,
    );
  }

  @Post('notes/summarize')
  summarizeNote(@Body() body: { content: string }) {
    return this.ai.summarizeNote(body.content ?? '');
  }

  @Post('notes/extract-actions')
  extractActionsFromNote(@Body() body: { content: string }) {
    return this.ai.extractActionsFromNote(body.content ?? '');
  }

  @Post('documents/generate-contestacion')
  generateContestacionDemanda(
    @OrganizationId() organizationId: string,
    @Body() body: { documentId: string; matterId: string },
  ) {
    return this.ai.generateContestacionDemanda(
      organizationId,
      body.documentId,
      body.matterId,
    );
  }

  @Post('documents/contestacion-to-docx')
  async contestacionToDocx(
    @Body() body: { draft: string; documentName?: string },
    @Res() res: any,
  ) {
    const draft = typeof body?.draft === 'string' ? body.draft : '';
    const baseName = (typeof body?.documentName === 'string' ? body.documentName : 'contestacion')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9áéíóúñÑ_-]/g, '_')
      .slice(0, 80);
    const buffer = await this.ai.draftContestacionToDocx(draft);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(baseName)}-contestacion-${Date.now()}.docx"`,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.send(buffer);
  }

  @Get('documents/search')
  aiAssistedSearch(
    @OrganizationId() organizationId: string,
    @Query('q') query: string,
    @Query('matterId') matterId?: string,
  ) {
    return this.ai.aiAssistedSearch(organizationId, query, matterId);
  }

  @Get('documents/:documentId/versions/compare')
  getVersionComparisonSummary(
    @OrganizationId() organizationId: string,
    @Param('documentId') documentId: string,
    @Query('version1') version1: string,
    @Query('version2') version2: string,
  ) {
    return this.ai.getVersionComparisonSummary(
      organizationId,
      documentId,
      version1,
      version2,
    );
  }
}
