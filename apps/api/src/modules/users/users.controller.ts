import { Controller, Get, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { UserId } from '../../common/decorators/user-id.decorator';

@Controller('users')
@UseGuards(TenantGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  findAll(@OrganizationId() organizationId: string) {
    return this.users.findByOrganization(organizationId);
  }

  @Get('me')
  findMe(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
  ) {
    return this.users.findMe(organizationId, userId);
  }
}
