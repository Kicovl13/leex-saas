import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, TaskStatus, MatterActivityType } from '../../generated/prisma';
import { MatterActivityService } from '../matter-activity/matter-activity.service';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matterActivity: MatterActivityService,
  ) {}

  async create(
    organizationId: string,
    data: Omit<Prisma.TaskUncheckedCreateInput, 'organizationId'>,
  ) {
    if (data.matterId != null) {
      await this.ensureMatterInOrg(organizationId, data.matterId);
    }
    if (data.assignedToId) {
      await this.ensureUserInOrg(organizationId, data.assignedToId);
    }
    return this.prisma.task.create({
      data: { ...data, organizationId },
      include: { matter: { select: { id: true, name: true } }, assignedTo: { select: { id: true, name: true, email: true } } },
    });
  }

  async findAllByMatter(organizationId: string, matterId: string) {
    await this.ensureMatterInOrg(organizationId, matterId);
    return this.prisma.task.findMany({
      where: { organizationId, matterId },
      include: { assignedTo: { select: { id: true, name: true, email: true } } },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Tareas sin expediente (recordatorios globales) */
  async findAllGlobal(organizationId: string) {
    return this.prisma.task.findMany({
      where: { organizationId, matterId: null, deletedAt: null },
      include: { assignedTo: { select: { id: true, name: true, email: true } } },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(organizationId: string, id: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, organizationId },
      include: { matter: true, assignedTo: { select: { id: true, name: true, email: true } } },
    });
    if (task) return task;
    const exists = await this.prisma.task.findUnique({
      where: { id },
      select: { id: true },
    });
    if (exists) throw new ForbiddenException('No tiene acceso a esta tarea.');
    throw new NotFoundException('Tarea no encontrada.');
  }

  async update(
    organizationId: string,
    id: string,
    data: Prisma.TaskUncheckedUpdateInput,
  ) {
    await this.prisma.task.findFirstOrThrow({
      where: { id, organizationId },
    });
    if (data.assignedToId !== undefined && data.assignedToId != null) {
      await this.ensureUserInOrg(organizationId, data.assignedToId as string);
    }
    const updateData = { ...data };
    const statusVal = data.status as TaskStatus | undefined;
    if (statusVal === TaskStatus.DONE) {
      (updateData as Prisma.TaskUncheckedUpdateInput).completedAt = new Date();
    } else if (statusVal != null) {
      (updateData as Prisma.TaskUncheckedUpdateInput).completedAt = null;
    }
    const updated = await this.prisma.task.update({
      where: { id },
      data: updateData,
      include: { matter: { select: { id: true, name: true } }, assignedTo: { select: { id: true, name: true, email: true } } },
    });
    if (statusVal === TaskStatus.DONE && updated.matterId != null) {
      await this.matterActivity.create(organizationId, updated.matterId, {
        type: MatterActivityType.TASK_COMPLETED,
        content: `Tarea completada: ${updated.title}`,
        metadata: { taskId: updated.id, title: updated.title },
      });
    }
    return updated;
  }

  async remove(organizationId: string, id: string) {
    await this.prisma.task.findFirstOrThrow({
      where: { id, organizationId },
    });
    return this.prisma.task.delete({ where: { id } });
  }

  private async ensureMatterInOrg(organizationId: string, matterId: string) {
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId },
      select: { id: true },
    });
    if (!matter) throw new ForbiddenException('Expediente no encontrado o sin acceso.');
  }

  private async ensureUserInOrg(organizationId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { id: true },
    });
    if (!user) throw new ForbiddenException('Usuario no encontrado o no pertenece a la organización.');
  }
}
