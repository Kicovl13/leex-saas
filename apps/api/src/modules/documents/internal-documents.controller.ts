import {
  Body,
  Controller,
  Headers,
  Param,
  Patch,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { AiCallbackDto } from './dto/ai-callback.dto';
import { AiResultsDto } from './dto/ai-results.dto';

@Controller('internal/documents')
export class InternalDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('ai-result')
  async saveAiResult(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Body() body: AiCallbackDto,
  ) {
    const expectedToken = process.env.INTERNAL_WEBHOOK_TOKEN?.trim();
    if (!expectedToken) {
      throw new ServiceUnavailableException(
        'INTERNAL_WEBHOOK_TOKEN no está configurado en el servidor.',
      );
    }
    if (!internalToken || internalToken.trim() !== expectedToken) {
      throw new UnauthorizedException('Invalid internal token.');
    }
    return this.documents.updateAiProcessingResult(body);
  }

  /**
   * Callback para que n8n devuelva los resultados de IA.
   * Protegido por x-internal-token (INTERNAL_WEBHOOK_TOKEN o INTERNAL_API_KEY).
   */
  @Patch(':id/ai-results')
  async updateAiResults(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Param('id') id: string,
    @Body() body: AiResultsDto,
  ) {
    const token = internalToken?.trim();
    const expected =
      process.env.INTERNAL_WEBHOOK_TOKEN?.trim() || process.env.INTERNAL_API_KEY?.trim();
    if (!expected) {
      throw new ServiceUnavailableException(
        'INTERNAL_WEBHOOK_TOKEN o INTERNAL_API_KEY no están configurados.',
      );
    }
    if (!token || token !== expected) {
      throw new UnauthorizedException('Invalid internal token.');
    }
    return this.documents.updateDocumentAiResults(id, body.organizationId, {
      summary: body.summary,
      classification: body.classification,
      riskLevel: body.riskLevel,
      aiMetadata: body.aiMetadata,
    });
  }
}
