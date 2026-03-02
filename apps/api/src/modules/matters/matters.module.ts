import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MattersService } from './matters.service';
import { MatterStagesService } from './matter-stages.service';
import { MattersController } from './matters.controller';
import { MatterActivityModule } from '../matter-activity/matter-activity.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, MatterActivityModule, AuditModule],
  controllers: [MattersController],
  providers: [MattersService, MatterStagesService],
  exports: [MattersService, MatterStagesService],
})
export class MattersModule {}
