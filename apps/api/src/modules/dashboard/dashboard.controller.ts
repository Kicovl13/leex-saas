import { Controller, Get, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { UserId } from '../../common/decorators/user-id.decorator';

@Controller('dashboard')
@UseGuards(TenantGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  getSummary(@OrganizationId() organizationId: string) {
    return this.dashboard.getSummary(organizationId);
  }

  @Get('notifications')
  getNotifications(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
  ) {
    return this.dashboard.getNotifications(organizationId, userId);
  }

  @Get('lawyer-kpis')
  getLawyerKpis(@OrganizationId() organizationId: string) {
    return this.dashboard.getLawyerKpis(organizationId);
  }

  @Get('metrics-snapshot/latest')
  getLatestMetricsSnapshot(@OrganizationId() organizationId: string) {
    return this.dashboard.getLatestMetricsSnapshot(organizationId);
  }
}
