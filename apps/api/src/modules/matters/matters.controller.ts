import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MattersService } from './matters.service';
import { MatterStagesService } from './matter-stages.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { UserId } from '../../common/decorators/user-id.decorator';
import { CreateMatterDto, UpdateMatterDto, CreateMatterCommunicationDto } from './dto';
import { MatterStatus, Prisma } from '../../generated/prisma';

@ApiTags('Expedientes')
@ApiBearerAuth()
@Controller('matters')
@UseGuards(TenantGuard)
export class MattersController {
  constructor(
    private readonly matters: MattersService,
    private readonly matterStages: MatterStagesService,
  ) {}

  @Get('stages')
  getStages(
    @OrganizationId() organizationId: string,
    @Query('matterType') matterType?: string,
  ) {
    return this.matterStages.list(organizationId, matterType ?? undefined);
  }

  @Put('stages')
  setStages(
    @OrganizationId() organizationId: string,
    @Body() body: { matterType?: string | null; stages: Array<{ key: string; label: string; sortOrder?: number }> },
  ) {
    return this.matterStages.setStages(organizationId, body.matterType ?? null, body.stages);
  }

  @Get(':id/communications')
  getCommunications(
    @OrganizationId() organizationId: string,
    @Param('id') matterId: string,
  ) {
    return this.matters.findCommunications(organizationId, matterId);
  }

  @Post(':id/communications')
  addCommunication(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @Param('id') matterId: string,
    @Body() body: CreateMatterCommunicationDto,
  ) {
    return this.matters.addCommunication(organizationId, matterId, {
      type: body.type,
      subject: body.subject,
      occurredAt: new Date(body.occurredAt),
      notes: body.notes,
      userId,
    });
  }

  @Post()
  create(
    @OrganizationId() organizationId: string,
    @Body() body: CreateMatterDto,
  ) {
    return this.matters.create(organizationId, {
      ...body,
      contraparteNombre: body.contraparteNombre,
      forceCreate: body.forceCreate,
      responsibleUserId: body.responsibleUserId,
    });
  }

  @Get()
  findAll(
    @OrganizationId() organizationId: string,
    @Query('status') status?: MatterStatus,
    @Query('clientId') clientId?: string,
    @Query('q') q?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.matters.findAll(organizationId, {
      status,
      clientId,
      q: q?.trim() || undefined,
      take: take != null ? parseInt(take, 10) : undefined,
      skip: skip != null ? parseInt(skip, 10) : undefined,
    });
  }

  @Post(':id/regenerate-portal-token')
  regeneratePortalToken(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.matters.regeneratePublicToken(organizationId, id);
  }

  @Get(':id/export')
  exportMatter(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.matters.exportMatter(organizationId, id, userId);
  }

  @Get(':id')
  findOne(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.matters.findOne(organizationId, id);
  }

  @Patch(':id')
  update(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @Param('id') id: string,
    @Body() body: UpdateMatterDto,
  ) {
    const data = { ...body } as Record<string, unknown>;
    if ('customFields' in body) {
      (data as { customFields?: unknown }).customFields =
        body.customFields === null ? Prisma.JsonNull : (body.customFields as Prisma.InputJsonValue);
    }
    return this.matters.update(organizationId, id, data as Prisma.MatterUncheckedUpdateInput, userId);
  }

  @Delete(':id')
  remove(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.matters.remove(organizationId, id, userId);
  }
}
