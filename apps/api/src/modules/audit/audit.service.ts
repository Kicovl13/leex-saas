import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    organizationId: string;
    userId?: string | null;
    entityType: 'Document' | 'Matter';
    entityId: string;
    action: 'UPDATE' | 'DELETE' | 'EXPORT';
    oldData?: Record<string, unknown> | null;
    newData?: Record<string, unknown> | null;
  }) {
    await this.prisma.auditLog.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId ?? undefined,
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        oldData: params.oldData ?? undefined,
        newData: params.newData ?? undefined,
      },
    });
  }
}
