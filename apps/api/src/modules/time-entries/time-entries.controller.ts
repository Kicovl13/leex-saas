import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TimeEntriesService } from './time-entries.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { UserId } from '../../common/decorators/user-id.decorator';
import { UserRole as UserRoleDecorator } from '../../common/decorators/user-role.decorator';
import { UserRole } from '../../generated/prisma';
import { CreateTimeEntryDto, UpdateTimeEntryDto } from './dto';

const RESTRICTED_ROLES: UserRole[] = [UserRole.MEMBER, UserRole.VIEWER];

@ApiTags('Registro de tiempo')
@ApiBearerAuth()
@Controller('time-entries')
@UseGuards(TenantGuard)
export class TimeEntriesController {
  constructor(private readonly timeEntries: TimeEntriesService) {}

  @Post()
  create(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRoleDecorator() userRole: UserRole | undefined,
    @Body() body: CreateTimeEntryDto,
  ) {
    let resolvedUserId = body.userId ?? userId;
    if (!resolvedUserId) throw new BadRequestException('Usuario no identificado.');
    if (userRole != null && RESTRICTED_ROLES.includes(userRole) && resolvedUserId !== userId) {
      resolvedUserId = userId!;
    }
    return this.timeEntries.create(organizationId, {
      ...body,
      userId: resolvedUserId,
    });
  }

  @Get()
  findAll(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRoleDecorator() userRole: UserRole | undefined,
    @Query('matterId') matterId?: string,
    @Query('userId') userIdQuery?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const restrictToUserId =
      userRole != null && RESTRICTED_ROLES.includes(userRole) ? userId : undefined;
    return this.timeEntries.findAll(organizationId, {
      matterId,
      userId: restrictToUserId == null ? userIdQuery : undefined,
      restrictToUserId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  @Get(':id')
  findOne(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRoleDecorator() userRole: UserRole | undefined,
    @Param('id') id: string,
  ) {
    const requireOwnership =
      userRole != null && RESTRICTED_ROLES.includes(userRole) ? userId : undefined;
    return this.timeEntries.findOne(organizationId, id, requireOwnership);
  }

  @Patch(':id')
  update(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRoleDecorator() userRole: UserRole | undefined,
    @Param('id') id: string,
    @Body() body: UpdateTimeEntryDto,
  ) {
    const requireOwnership =
      userRole != null && RESTRICTED_ROLES.includes(userRole) ? userId : undefined;
    return this.timeEntries.update(organizationId, id, body, requireOwnership);
  }

  @Delete(':id')
  remove(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRoleDecorator() userRole: UserRole | undefined,
    @Param('id') id: string,
  ) {
    const requireOwnership =
      userRole != null && RESTRICTED_ROLES.includes(userRole) ? userId : undefined;
    return this.timeEntries.remove(organizationId, id, requireOwnership);
  }
}
