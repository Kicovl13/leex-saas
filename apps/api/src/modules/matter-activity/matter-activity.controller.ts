import { Controller, Get, Post, Body, Param, Query, UseGuards, Patch, Delete } from '@nestjs/common';
import { MatterActivityService } from './matter-activity.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { UserId } from '../../common/decorators/user-id.decorator';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { MatterActivityType } from '../../generated/prisma';

@Controller('matters/:matterId/activities')
@UseGuards(TenantGuard)
export class MatterActivityController {
  constructor(private readonly activity: MatterActivityService) {}

  @Get()
  findAll(
    @OrganizationId() organizationId: string,
    @Param('matterId') matterId: string,
    @Query('publicOnly') publicOnly?: string,
  ) {
    return this.activity.findByMatter(organizationId, matterId, {
      publicOnly: publicOnly === 'true',
    });
  }

  @Post()
  createNote(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @Param('matterId') matterId: string,
    @Body() body: CreateActivityDto,
  ) {
    return this.activity.create(organizationId, matterId, {
      type: MatterActivityType.NOTE,
      content: body.content,
      metadata: body.metadata,
      userId,
      isPublic: body.isPublic,
    });
  }

  @Patch(':id')
  update(
    @OrganizationId() organizationId: string,
    @Param('matterId') matterId: string,
    @Param('id') id: string,
    @Body() body: UpdateActivityDto,
  ) {
    return this.activity.update(organizationId, matterId, id, {
      content: body.content,
      isPublic: body.isPublic,
    });
  }

  @Delete(':id')
  remove(
    @OrganizationId() organizationId: string,
    @Param('matterId') matterId: string,
    @Param('id') id: string,
  ) {
    return this.activity.remove(organizationId, matterId, id);
  }
}
