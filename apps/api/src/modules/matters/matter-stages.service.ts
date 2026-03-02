import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export const DEFAULT_STAGES = [
  { key: 'BORRADOR', label: 'Borrador', sortOrder: 0 },
  { key: 'PRESENTADO', label: 'Presentado', sortOrder: 1 },
  { key: 'PRUEBAS', label: 'Pruebas', sortOrder: 2 },
  { key: 'SENTENCIA', label: 'Sentencia', sortOrder: 3 },
  { key: 'EJECUCION', label: 'Ejecución', sortOrder: 4 },
];

export interface MatterStageOption {
  key: string;
  label: string;
  sortOrder: number;
}

@Injectable()
export class MatterStagesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista etapas para la organización. Si matterType se indica, usa las definidas
   * para ese tipo; si no hay definiciones, devuelve las por defecto (litigio).
   */
  async list(
    organizationId: string,
    matterType?: string | null,
  ): Promise<MatterStageOption[]> {
    const type = matterType?.trim() || null;
    const definitions = await this.prisma.raw.matterStageDefinition.findMany({
      where: {
        organizationId,
        matterType: type,
      },
      orderBy: { sortOrder: 'asc' },
      select: { key: true, label: true, sortOrder: true },
    });
    if (definitions.length > 0) {
      return definitions;
    }
    return DEFAULT_STAGES;
  }

  /**
   * Crea o reemplaza las etapas para un matterType (null = por defecto).
   */
  async setStages(
    organizationId: string,
    matterType: string | null,
    stages: { key: string; label: string; sortOrder?: number }[],
  ) {
    const type = matterType?.trim() || null;
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.matterStageDefinition.deleteMany({
        where: { organizationId, matterType: type },
      });
      if (stages.length > 0) {
        await tx.matterStageDefinition.createMany({
          data: stages.map((s, i) => ({
            organizationId,
            matterType: type,
            key: s.key,
            label: s.label,
            sortOrder: s.sortOrder ?? i,
          })),
        });
      }
    });
    return this.list(organizationId, matterType ?? undefined);
  }
}
