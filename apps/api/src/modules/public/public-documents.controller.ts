import { Controller, Get, Headers, Param, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { DocumentsService } from '../documents/documents.service';

@Controller('public/documents')
@UseGuards(ThrottlerGuard)
export class PublicDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('shared/:token')
  async getSharedDocument(
    @Param('token') token: string,
    @Headers('x-forwarded-for') forwardedFor?: string,
  ) {
    const requesterIp = forwardedFor?.split(',')[0]?.trim();
    return this.documents.resolveSharedLink(token, requesterIp);
  }
}
