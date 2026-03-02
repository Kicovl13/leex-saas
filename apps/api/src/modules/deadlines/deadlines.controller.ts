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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DeadlinesService } from './deadlines.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import {
  CreateDeadlineDto,
  CreateDeadlineRuleDto,
  UpdateDeadlineDto,
  UpdateDeadlineRuleDto,
} from './dto';

@ApiTags('Plazos')
@ApiBearerAuth()
@Controller('deadlines')
@UseGuards(TenantGuard)
export class DeadlinesController {
  constructor(private readonly deadlines: DeadlinesService) {}

  @Post()
  create(
    @OrganizationId() organizationId: string,
    @Body() body: CreateDeadlineDto,
  ) {
    return this.deadlines.create(organizationId, body);
  }

  @Get()
  findAll(
    @OrganizationId() organizationId: string,
    @Query('matterId') matterId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.deadlines.findAll(organizationId, {
      matterId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      take: take != null ? parseInt(take, 10) : undefined,
      skip: skip != null ? parseInt(skip, 10) : undefined,
    });
  }

  @Get('upcoming')
  upcoming(
    @OrganizationId() organizationId: string,
    @Query('limit') limit?: string,
  ) {
    return this.deadlines.upcoming(organizationId, limit ? parseInt(limit, 10) : 10);
  }

  @Get('compute-due-date')
  async computeDueDate(
    @OrganizationId() organizationId: string,
    @Query('from') from: string,
    @Query('businessDays') businessDays: string,
  ) {
    const date = await this.deadlines.computeDueDate(
      organizationId,
      new Date(from),
      parseInt(businessDays, 10),
    );
    return { dueDate: date.toISOString() };
  }

  @Get('compute-due-date/by-rule')
  async computeDueDateByRule(
    @OrganizationId() organizationId: string,
    @Query('from') from: string,
    @Query('courtType') courtType: string,
    @Query('legalBasis') legalBasis: string,
    @Query('jurisdiction') jurisdiction?: string,
    @Query('overrideDays') overrideDays?: string,
  ) {
    const result = await this.deadlines.computeDueDateByRule({
      organizationId,
      fromDate: new Date(from),
      courtType,
      legalBasis,
      jurisdiction,
      overrideDays: overrideDays != null ? parseInt(overrideDays, 10) : undefined,
    });
    return {
      dueDate: result.dueDate.toISOString(),
      daysUsed: result.daysUsed,
      isBusinessDays: result.isBusinessDays,
      ruleId: result.ruleId,
    };
  }

  @Post('rules')
  createRule(
    @OrganizationId() organizationId: string,
    @Body() body: CreateDeadlineRuleDto,
  ) {
    return this.deadlines.createRule(organizationId, body);
  }

  @Get('rules')
  listRules(
    @OrganizationId() organizationId: string,
    @Query('courtType') courtType?: string,
    @Query('legalBasis') legalBasis?: string,
    @Query('jurisdiction') jurisdiction?: string,
  ) {
    return this.deadlines.listRules(organizationId, {
      courtType,
      legalBasis,
      jurisdiction,
    });
  }

  @Get('rules/:id')
  findRule(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.deadlines.findRule(organizationId, id);
  }

  @Patch('rules/:id')
  updateRule(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body() body: UpdateDeadlineRuleDto,
  ) {
    return this.deadlines.updateRule(organizationId, id, body);
  }

  @Delete('rules/:id')
  removeRule(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.deadlines.removeRule(organizationId, id);
  }

  @Get(':id')
  findOne(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.deadlines.findOne(organizationId, id);
  }

  @Patch(':id')
  update(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body() body: UpdateDeadlineDto,
  ) {
    return this.deadlines.update(organizationId, id, body);
  }

  @Delete(':id')
  remove(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.deadlines.remove(organizationId, id);
  }
}
