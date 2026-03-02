import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { InternalDashboardController } from './internal-dashboard.controller';
import { MattersModule } from '../matters/matters.module';
import { DeadlinesModule } from '../deadlines/deadlines.module';
import { TimeEntriesModule } from '../time-entries/time-entries.module';
import { InternalWebhookGuard } from '../../common/guards/internal-webhook.guard';

@Module({
  imports: [MattersModule, DeadlinesModule, TimeEntriesModule],
  controllers: [DashboardController, InternalDashboardController],
  providers: [DashboardService, InternalWebhookGuard],
})
export class DashboardModule {}
