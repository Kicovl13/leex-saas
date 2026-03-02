import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { InternalWebhookGuard } from '../../common/guards/internal-webhook.guard';
import { RecomputeMetricsDto } from './dto/recompute-metrics.dto';

@Controller('internal/dashboard')
@UseGuards(InternalWebhookGuard)
export class InternalDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Post('metrics-snapshot/recompute')
  recomputeMetricsSnapshot(@Body() body: RecomputeMetricsDto) {
    return this.dashboard.recomputeMetricsSnapshot(body.organizationId);
  }
}
