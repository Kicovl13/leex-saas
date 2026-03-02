import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MatterActivityType } from '../../generated/prisma';

@Injectable()
export class MatterActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async findByMatter(
    organizationId: string,
    matterId: string,
    options?: { publicOnly?: boolean },
  ) {
    await this.prisma.matter.findFirstOrThrow({
      where: { id: matterId, organizationId },
      select: { id: true },
    });
    return this.prisma.matterActivity.findMany({
      where: {
        organizationId,
        matterId,
        ...(options?.publicOnly && { isPublic: true }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    organizationId: string,
    matterId: string,
    data: {
      type: MatterActivityType;
      content: string;
      metadata?: Record<string, unknown>;
      userId?: string | null;
      isPublic?: boolean;
    },
  ) {
    await this.prisma.matter.findFirstOrThrow({
      where: { id: matterId, organizationId },
      select: { id: true },
    });
    return this.prisma.matterActivity.create({
      data: {
        organizationId,
        matterId,
        type: data.type,
        content: data.content,
        metadata: data.metadata ?? undefined,
        userId: data.userId ?? undefined,
        isPublic: data.isPublic ?? false,
      },
    });
  }

  async update(
    organizationId: string,
    matterId: string,
    id: string,
    data: { content?: string; isPublic?: boolean },
  ) {
    const activity = await this.prisma.matterActivity.findFirstOrThrow({
      where: { id, organizationId, matterId },
    });
    if (activity.type !== MatterActivityType.NOTE) {
      throw new ForbiddenException('Solo se pueden editar notas.');
    }
    return this.prisma.matterActivity.update({
      where: { id },
      data: {
        ...(data.content !== undefined && { content: data.content }),
        ...(data.isPublic !== undefined && { isPublic: data.isPublic }),
      },
    });
  }

  async remove(organizationId: string, matterId: string, id: string) {
    const activity = await this.prisma.matterActivity.findFirstOrThrow({
      where: { id, organizationId, matterId },
    });
    if (activity.type !== MatterActivityType.NOTE) {
      throw new ForbiddenException('Solo se pueden eliminar notas.');
    }
    return this.prisma.matterActivity.delete({ where: { id } });
  }
}
