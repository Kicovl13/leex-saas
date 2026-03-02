import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DocumentsModule } from '../documents/documents.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { ActivityTypesService } from './activity-types.service';

@Module({
  imports: [PrismaModule, DocumentsModule],
  controllers: [SettingsController],
  providers: [SettingsService, ActivityTypesService],
})
export class SettingsModule {}
