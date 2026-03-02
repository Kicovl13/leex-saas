import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MatterActivityController } from './matter-activity.controller';
import { MatterActivityService } from './matter-activity.service';

@Module({
  imports: [PrismaModule],
  controllers: [MatterActivityController],
  providers: [MatterActivityService],
  exports: [MatterActivityService],
})
export class MatterActivityModule {}
