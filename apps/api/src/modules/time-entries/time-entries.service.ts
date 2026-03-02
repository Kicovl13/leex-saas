import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma';

@Injectable()
export class TimeEntriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, data: Omit<Prisma.TimeEntryUncheckedCreateInput, 'organizationId'>) {
    const date =
      data.date instanceof Date ? data.date : new Date(data.date as string);
    return this.prisma.timeEntry.create({
      data: { ...data, date, organizationId },
    });
  }

  async findAll(
    organizationId: string,
    filters?: { matterId?: string; userId?: string; from?: Date; to?: Date; restrictToUserId?: string },
  ) {
    const where: Prisma.TimeEntryWhereInput = { organizationId };
    if (filters?.matterId) where.matterId = filters.matterId;
    const userIdFilter = filters?.restrictToUserId ?? filters?.userId;
    if (userIdFilter) where.userId = userIdFilter;
    if (filters?.from ?? filters?.to) {
      where.date = {};
      if (filters.from) (where.date as Prisma.DateTimeFilter).gte = filters.from;
      if (filters.to) (where.date as Prisma.DateTimeFilter).lte = filters.to;
    }
    return this.prisma.timeEntry.findMany({
      where,
      include: {
        matter: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(organizationId: string, id: string, requireOwnershipUserId?: string) {
    const entry = await this.prisma.timeEntry.findFirstOrThrow({
      where: { id, organizationId },
      include: { matter: true, user: true },
    });
    if (requireOwnershipUserId != null && entry.userId !== requireOwnershipUserId) {
      throw new ForbiddenException('No tiene permiso para ver este registro de tiempo.');
    }
    return entry;
  }

  async update(
    organizationId: string,
    id: string,
    data: Prisma.TimeEntryUncheckedUpdateInput,
    requireOwnershipUserId?: string,
  ) {
    const entry = await this.prisma.timeEntry.findFirstOrThrow({
      where: { id, organizationId },
    });
    if (requireOwnershipUserId != null && entry.userId !== requireOwnershipUserId) {
      throw new ForbiddenException('No tiene permiso para modificar este registro de tiempo.');
    }
    const updateData = { ...data };
    if (updateData.date !== undefined) {
      updateData.date =
        updateData.date instanceof Date
          ? updateData.date
          : new Date(updateData.date as string);
    }
    return this.prisma.timeEntry.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(organizationId: string, id: string, requireOwnershipUserId?: string) {
    const entry = await this.prisma.timeEntry.findFirstOrThrow({
      where: { id, organizationId },
    });
    if (requireOwnershipUserId != null && entry.userId !== requireOwnershipUserId) {
      throw new ForbiddenException('No tiene permiso para eliminar este registro de tiempo.');
    }
    return this.prisma.timeEntry.delete({ where: { id } });
  }

  /**
   * Minutos facturables del mes actual (o rango) para la organización.
   */
  async billableMinutesInPeriod(
    organizationId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    const result = await this.prisma.timeEntry.aggregate({
      where: {
        organizationId,
        billable: true,
        date: { gte: from, lte: to },
      },
      _sum: { minutes: true },
    });
    return result._sum.minutes ?? 0;
  }
}
