import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PublicMattersController } from './public-matters.controller';
import { PublicDocumentsController } from './public-documents.controller';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [PrismaModule, DocumentsModule],
  controllers: [PublicMattersController, PublicDocumentsController],
})
export class PublicModule {}
