import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const LIMITS: Record<string, number> = {
  FREE: 5,
  PRO: 100,
  ENTERPRISE: 999_999,
};

@Injectable()
export class UsageLimitService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cuenta documentos procesados por IA en el mes actual (por organización).
   */
  async getMonthlyProcessedCount(organizationId: string): Promise<number> {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return this.prisma.raw.document.count({
      where: {
        organizationId,
        aiSummary: { not: null },
        createdAt: { gte: start },
      },
    });
  }

  /**
   * Lanza si la organización ha superado el límite de documentos con IA según su plan.
   * En modo LEGAL_AI_MOCK=true no se aplica límite (análisis simulado, sin uso de API).
   */
  async assertCanProcessDocument(organizationId: string): Promise<void> {
    const useMock = process.env.LEGAL_AI_MOCK === 'true' || process.env.LEGAL_AI_MOCK === '1';
    if (useMock) return;

    const org = await this.prisma.raw.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true },
    });
    if (!org) throw new ForbiddenException('Organización no encontrada.');
    const limit = LIMITS[org.plan] ?? LIMITS.FREE;
    const count = await this.getMonthlyProcessedCount(organizationId);
    if (count >= limit) {
      throw new ForbiddenException(
        `Límite de análisis con IA alcanzado (${limit} documentos/mes en plan ${org.plan}). Actualiza tu plan para continuar.`,
      );
    }
  }
}
