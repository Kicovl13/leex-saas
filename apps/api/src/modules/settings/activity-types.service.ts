import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export const DEFAULT_ACTIVITY_TYPES = [
  { key: 'litigio', label: 'Litigio', sortOrder: 0 },
  { key: 'asesoria', label: 'Asesoría', sortOrder: 1 },
  { key: 'reunion', label: 'Reunión', sortOrder: 2 },
  { key: 'documentacion', label: 'Documentación', sortOrder: 3 },
  { key: 'otro', label: 'Otro', sortOrder: 4 },
];

export interface ActivityTypeOption {
  key: string;
  label: string;
  sortOrder: number;
}

@Injectable()
export class ActivityTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string): Promise<ActivityTypeOption[]> {
    const types = await this.prisma.raw.organizationActivityType.findMany({
      where: { organizationId },
      orderBy: { sortOrder: 'asc' },
      select: { key: true, label: true, sortOrder: true },
    });
    if (types.length > 0) return types;
    return DEFAULT_ACTIVITY_TYPES;
  }

  async setTypes(
    organizationId: string,
    types: { key: string; label: string; sortOrder?: number }[],
  ): Promise<ActivityTypeOption[]> {
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.organizationActivityType.deleteMany({ where: { organizationId } });
      if (types.length > 0) {
        await tx.organizationActivityType.createMany({
          data: types.map((t, i) => ({
            organizationId,
            key: t.key,
            label: t.label,
            sortOrder: t.sortOrder ?? i,
          })),
        });
      }
    });
    return this.list(organizationId);
  }
}
