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
import { TasksService } from './tasks.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { CreateTaskDto, UpdateTaskDto } from './dto';

@Controller('tasks')
@UseGuards(TenantGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  create(
    @OrganizationId() organizationId: string,
    @Body() body: CreateTaskDto,
  ) {
    return this.tasks.create(organizationId, {
      title: body.title,
      description: body.description,
      matterId: body.matterId ?? undefined,
      assignedToId: body.assignedToId,
      status: body.status,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
    });
  }

  @Get()
  findAll(
    @OrganizationId() organizationId: string,
    @Query('matterId') matterId?: string,
  ) {
    if (matterId) {
      return this.tasks.findAllByMatter(organizationId, matterId);
    }
    return this.tasks.findAllGlobal(organizationId);
  }

  @Get(':id')
  findOne(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.tasks.findOne(organizationId, id);
  }

  @Patch(':id')
  update(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body() body: UpdateTaskDto,
  ) {
    return this.tasks.update(organizationId, id, {
      title: body.title,
      description: body.description,
      assignedToId: body.assignedToId,
      status: body.status,
      dueDate: body.dueDate != null ? new Date(body.dueDate) : undefined,
    });
  }

  @Delete(':id')
  remove(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.tasks.remove(organizationId, id);
  }
}
