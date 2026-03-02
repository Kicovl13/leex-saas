import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MatterStatus, MatterActivityType, Prisma } from '../../generated/prisma';
import { randomBytes } from 'crypto';
import { MatterActivityService } from '../matter-activity/matter-activity.service';
import { AuditService } from '../audit/audit.service';

export interface CreateMatterResult {
  conflict?: boolean;
  matchingClients?: Array<{ id: string; name: string }>;
  matter?: Prisma.MatterGetPayload<object>;
}

@Injectable()
export class MattersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matterActivity: MatterActivityService,
    private readonly audit: AuditService,
  ) {}

  /** Conflict check: clientes cuyo nombre coincida (insensible) con contraparteNombre */
  async checkConflict(organizationId: string, contraparteNombre: string) {
    const name = contraparteNombre.trim();
    if (!name) return [];
    return this.prisma.client.findMany({
      where: {
        organizationId,
        name: { contains: name, mode: 'insensitive' },
      },
      select: { id: true, name: true },
    });
  }

  async create(
    organizationId: string,
    data: Omit<Prisma.MatterUncheckedCreateInput, 'organizationId' | 'publicToken'> & {
      contraparteNombre?: string;
      forceCreate?: boolean;
    },
  ): Promise<CreateMatterResult> {
    const { contraparteNombre, forceCreate, ...rest } = data;
    const createData = { ...rest } as Omit<Prisma.MatterUncheckedCreateInput, 'organizationId'>;

    if (contraparteNombre?.trim() && !forceCreate) {
      const matchingClients = await this.checkConflict(organizationId, contraparteNombre.trim());
      if (matchingClients.length > 0) {
        return {
          conflict: true,
          matchingClients: matchingClients.map((c) => ({ id: c.id, name: c.name })),
        };
      }
    }

    const publicToken = randomBytes(16).toString('base64url');
    const matter = await this.prisma.matter.create({
      data: {
        ...createData,
        organizationId,
        publicToken,
        stage: (typeof createData.stage === 'string' ? createData.stage : undefined) ?? 'BORRADOR',
      },
    });
    return { conflict: false, matter };
  }

  async findAll(
    organizationId: string,
    filters?: { status?: MatterStatus; clientId?: string; q?: string; take?: number; skip?: number },
  ) {
    const take = Math.min(Math.max(0, filters?.take ?? 50), 100);
    const skip = Math.max(0, filters?.skip ?? 0);
    const search = filters?.q?.trim();
    const where: Prisma.MatterWhereInput = {
      organizationId,
      ...(filters?.status && { status: filters.status }),
      ...(filters?.clientId && { clientId: filters.clientId }),
    };
    if (search && search.length >= 2) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { referenceCode: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { client: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    return this.prisma.matter.findMany({
      where,
      include: {
        client: { select: { id: true, name: true } },
        _count: { select: { deadlines: true, documents: true, tasks: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take,
      skip,
    });
  }

  /** Regenera el token del portal público. Invalida el anterior. */
  async regeneratePublicToken(organizationId: string, matterId: string) {
    await this.findOne(organizationId, matterId);
    const newToken = randomBytes(16).toString('base64url');
    const matter = await this.prisma.matter.update({
      where: { id: matterId },
      data: { publicToken: newToken },
      select: { id: true, publicToken: true },
    });
    return { publicToken: matter.publicToken };
  }

  async exportMatter(organizationId: string, id: string, userId?: string | null) {
    const matter = await this.prisma.matter.findFirst({
      where: { id, organizationId },
      include: {
        client: { select: { id: true, name: true, email: true } },
        responsible: { select: { id: true, name: true, email: true } },
        deadlines: { orderBy: { dueDate: 'asc' } },
        documents: { select: { id: true, name: true, folder: true, mimeType: true, sizeBytes: true, createdAt: true } },
        tasks: { select: { id: true, title: true, status: true, dueDate: true, completedAt: true } },
      },
    });
    if (!matter) {
      const exists = await this.prisma.raw.matter.findUnique({ where: { id } });
      if (exists) throw new ForbiddenException('No tiene acceso a este expediente.');
      throw new NotFoundException('Expediente no encontrado.');
    }
    const amount = matter.amount != null ? Number(matter.amount) : null;
    const exported = { ...matter, amount, exportedAt: new Date().toISOString() };
    await this.audit.log({
      organizationId,
      userId,
      entityType: 'Matter',
      entityId: id,
      action: 'EXPORT',
      newData: { matterName: matter.name, exportedAt: exported.exportedAt },
    });
    return exported;
  }

  async findOne(organizationId: string, id: string) {
    const matter = await this.prisma.matter.findFirst({
      where: { id, organizationId },
      include: {
        client: true,
        responsible: { select: { id: true, name: true, email: true } },
        deadlines: { orderBy: { dueDate: 'asc' } },
        documents: true,
        tasks: true,
      },
    });
    if (matter) {
      // Decimal no se serializa bien a JSON; convertir a número
      const amount = matter.amount != null ? Number(matter.amount) : null;
      const budgetHours = (matter as { budgetHours?: unknown }).budgetHours != null ? Number((matter as { budgetHours?: unknown }).budgetHours) : null;
      return { ...matter, amount, budgetHours };
    }
    const existsElsewhere = await this.prisma.raw.matter.findUnique({
      where: { id },
      select: { id: true },
    });
    if (existsElsewhere) {
      throw new ForbiddenException('No tiene acceso a este expediente.');
    }
    throw new NotFoundException('Expediente no encontrado.');
  }

  async update(
    organizationId: string,
    id: string,
    data: Prisma.MatterUncheckedUpdateInput,
    userId?: string,
  ) {
    const old = await this.prisma.matter.findFirstOrThrow({
      where: { id, organizationId },
    });
    const updated = await this.prisma.matter.update({
      where: { id },
      data,
    });
    const statusVal = data.status as MatterStatus | undefined;
    const stageVal = data.stage as string | undefined;
    if (statusVal != null && old.status !== updated.status) {
      await this.matterActivity.create(organizationId, id, {
        type: MatterActivityType.STATUS_CHANGE,
        content: `Estado cambiado de ${old.status} a ${updated.status}`,
        metadata: { oldStatus: old.status, newStatus: updated.status },
        userId,
      });
    }
    if (stageVal != null && old.stage !== updated.stage) {
      await this.matterActivity.create(organizationId, id, {
        type: MatterActivityType.STAGE_CHANGE,
        content: `Fase cambiada de ${old.stage} a ${updated.stage}`,
        metadata: { oldStage: old.stage, newStage: updated.stage },
        userId,
      });
    }
    await this.audit.log({
      organizationId,
      userId,
      entityType: 'Matter',
      entityId: id,
      action: 'UPDATE',
      oldData: old as unknown as Record<string, unknown>,
      newData: updated as unknown as Record<string, unknown>,
    });
    return updated;
  }

  async remove(organizationId: string, id: string, userId?: string) {
    const matter = await this.prisma.matter.findFirstOrThrow({
      where: { id, organizationId },
    });
    await this.prisma.matter.delete({ where: { id } });
    await this.audit.log({
      organizationId,
      userId,
      entityType: 'Matter',
      entityId: id,
      action: 'DELETE',
      oldData: matter as unknown as Record<string, unknown>,
    });
    return matter;
  }

  async countActive(organizationId: string): Promise<number> {
    return this.prisma.matter.count({
      where: { organizationId, status: MatterStatus.ACTIVE },
    });
  }

  async findCommunications(organizationId: string, matterId: string) {
    await this.prisma.matter.findFirstOrThrow({
      where: { id: matterId, organizationId },
    });
    return this.prisma.raw.matterCommunication.findMany({
      where: { organizationId, matterId },
      orderBy: { occurredAt: 'desc' },
    });
  }

  async addCommunication(
    organizationId: string,
    matterId: string,
    data: { type: string; subject?: string; occurredAt: Date; notes?: string; userId?: string },
  ) {
    await this.prisma.matter.findFirstOrThrow({
      where: { id: matterId, organizationId },
    });
    return this.prisma.raw.matterCommunication.create({
      data: {
        organizationId,
        matterId,
        type: data.type,
        subject: data.subject ?? null,
        occurredAt: data.occurredAt,
        notes: data.notes ?? null,
        userId: data.userId ?? null,
      },
    });
  }
}
