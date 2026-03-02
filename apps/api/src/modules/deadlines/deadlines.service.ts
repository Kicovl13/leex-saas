import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma';
import {
  addBusinessDays,
  type HolidayLike,
} from '../../utils/deadline.util';

type DeadlineRuleRow = {
  id: string;
  organization_id: string;
  jurisdiction: string | null;
  court_type: string;
  legal_basis: string;
  default_days: number;
  is_business_days: boolean;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class DeadlinesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, data: Omit<Prisma.DeadlineUncheckedCreateInput, 'organizationId'>) {
    const dueDate =
      data.dueDate instanceof Date
        ? data.dueDate
        : new Date(typeof data.dueDate === 'string' ? data.dueDate : Number(data.dueDate));
    return this.prisma.deadline.create({
      data: { ...data, dueDate, organizationId },
    });
  }

  async findAll(
    organizationId: string,
    filters?: { matterId?: string; from?: Date; to?: Date; take?: number; skip?: number },
  ) {
    const where: Prisma.DeadlineWhereInput = { organizationId };
    if (filters?.matterId) where.matterId = filters.matterId;
    if (filters?.from ?? filters?.to) {
      where.dueDate = {};
      if (filters.from) (where.dueDate as Prisma.DateTimeFilter).gte = filters.from;
      if (filters.to) (where.dueDate as Prisma.DateTimeFilter).lte = filters.to;
    }
    const take = Math.min(Math.max(0, filters?.take ?? 50), 100);
    const skip = Math.max(0, filters?.skip ?? 0);
    return this.prisma.deadline.findMany({
      where,
      include: { matter: { select: { id: true, name: true, client: { select: { name: true } } } } },
      orderBy: { dueDate: 'asc' },
      take,
      skip,
    });
  }

  async findOne(organizationId: string, id: string) {
    return this.prisma.deadline.findFirstOrThrow({
      where: { id, organizationId },
      include: { matter: true },
    });
  }

  async update(
    organizationId: string,
    id: string,
    data: Prisma.DeadlineUncheckedUpdateInput,
  ) {
    await this.prisma.deadline.findFirstOrThrow({
      where: { id, organizationId },
    });
    const payload = { ...data };
    if (payload.dueDate !== undefined) {
      payload.dueDate =
        payload.dueDate instanceof Date
          ? payload.dueDate
          : new Date(
              typeof payload.dueDate === 'string' ? payload.dueDate : Number(payload.dueDate),
            );
    }
    return this.prisma.deadline.update({
      where: { id },
      data: payload,
    });
  }

  async remove(organizationId: string, id: string) {
    await this.prisma.deadline.findFirstOrThrow({
      where: { id, organizationId },
    });
    return this.prisma.deadline.delete({ where: { id } });
  }

  /**
   * Próximos vencimientos (no completados) para la organización.
   */
  async upcoming(organizationId: string, limit = 10) {
    return this.prisma.deadline.findMany({
      where: {
        organizationId,
        completedAt: null,
        dueDate: { gte: new Date() },
      },
      include: { matter: { select: { id: true, name: true } } },
      orderBy: { dueDate: 'asc' },
      take: limit,
    });
  }

  /**
   * Calcula la fecha de vencimiento sumando N días hábiles (excl. fines de semana y festivos de la org).
   */
  async computeDueDate(
    organizationId: string,
    fromDate: Date,
    businessDays: number,
  ): Promise<Date> {
    const holidays = await this.prisma.organizationHoliday.findMany({
      where: { organizationId },
    });
    const holidayList: HolidayLike[] = holidays.map((h) => ({ date: h.date }));
    return addBusinessDays(fromDate, businessDays, holidayList);
  }

  async computeDueDateByRule(input: {
    organizationId: string;
    fromDate: Date;
    courtType: string;
    legalBasis: string;
    jurisdiction?: string;
    overrideDays?: number;
  }): Promise<{
    dueDate: Date;
    daysUsed: number;
    isBusinessDays: boolean;
    ruleId: string;
  }> {
    const rule = await this.findRuleBySelector({
      organizationId: input.organizationId,
      courtType: input.courtType,
      legalBasis: input.legalBasis,
      jurisdiction: input.jurisdiction,
    });
    if (!rule) {
      throw new NotFoundException('No existe DeadlineRule para los parámetros enviados.');
    }

    const days = input.overrideDays ?? rule.defaultDays;
    if (rule.isBusinessDays) {
      const dueDate = await this.computeDueDate(input.organizationId, input.fromDate, days);
      return {
        dueDate,
        daysUsed: days,
        isBusinessDays: true,
        ruleId: rule.id,
      };
    }

    const dueDate = new Date(input.fromDate);
    dueDate.setDate(dueDate.getDate() + days);
    return {
      dueDate,
      daysUsed: days,
      isBusinessDays: false,
      ruleId: rule.id,
    };
  }

  async createRule(
    organizationId: string,
    data: {
      courtType: string;
      legalBasis: string;
      defaultDays: number;
      isBusinessDays?: boolean;
      jurisdiction?: string;
    },
  ) {
    const id = `dr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    await this.prisma.raw.$executeRawUnsafe(
      `
      INSERT INTO "deadline_rules"
        ("id", "organization_id", "jurisdiction", "court_type", "legal_basis", "default_days", "is_business_days", "created_at", "updated_at")
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      `,
      id,
      organizationId,
      data.jurisdiction ?? null,
      data.courtType,
      data.legalBasis,
      data.defaultDays,
      data.isBusinessDays ?? true,
    );
    return this.findRule(organizationId, id);
  }

  async listRules(
    organizationId: string,
    filters?: { courtType?: string; legalBasis?: string; jurisdiction?: string },
  ) {
    const clauses: string[] = ['"organization_id" = $1'];
    const params: Array<string> = [organizationId];

    if (filters?.courtType) {
      params.push(filters.courtType);
      clauses.push(`"court_type" = $${params.length}`);
    }
    if (filters?.legalBasis) {
      params.push(filters.legalBasis);
      clauses.push(`"legal_basis" = $${params.length}`);
    }
    if (filters?.jurisdiction) {
      params.push(filters.jurisdiction);
      clauses.push(`"jurisdiction" = $${params.length}`);
    }

    const query = `
      SELECT *
      FROM "deadline_rules"
      WHERE ${clauses.join(' AND ')}
      ORDER BY "court_type" ASC, "legal_basis" ASC, "created_at" DESC
    `;
    const rows = await this.prisma.raw.$queryRawUnsafe<DeadlineRuleRow[]>(query, ...params);
    return rows.map((row) => this.mapRuleRow(row));
  }

  async findRule(organizationId: string, id: string) {
    const rows = await this.prisma.raw.$queryRawUnsafe<DeadlineRuleRow[]>(
      `
      SELECT *
      FROM "deadline_rules"
      WHERE "organization_id" = $1 AND "id" = $2
      LIMIT 1
      `,
      organizationId,
      id,
    );
    if (rows.length === 0) {
      throw new NotFoundException('DeadlineRule no encontrada.');
    }
    return this.mapRuleRow(rows[0]);
  }

  async updateRule(
    organizationId: string,
    id: string,
    data: {
      courtType?: string;
      legalBasis?: string;
      defaultDays?: number;
      isBusinessDays?: boolean;
      jurisdiction?: string;
    },
  ) {
    await this.findRule(organizationId, id);
    await this.prisma.raw.$executeRawUnsafe(
      `
      UPDATE "deadline_rules"
      SET
        "court_type" = COALESCE($3, "court_type"),
        "legal_basis" = COALESCE($4, "legal_basis"),
        "default_days" = COALESCE($5, "default_days"),
        "is_business_days" = COALESCE($6, "is_business_days"),
        "jurisdiction" = COALESCE($7, "jurisdiction"),
        "updated_at" = NOW()
      WHERE "organization_id" = $1 AND "id" = $2
      `,
      organizationId,
      id,
      data.courtType ?? null,
      data.legalBasis ?? null,
      data.defaultDays ?? null,
      data.isBusinessDays ?? null,
      data.jurisdiction ?? null,
    );
    return this.findRule(organizationId, id);
  }

  async removeRule(organizationId: string, id: string) {
    const existing = await this.findRule(organizationId, id);
    await this.prisma.raw.$executeRawUnsafe(
      `
      DELETE FROM "deadline_rules"
      WHERE "organization_id" = $1 AND "id" = $2
      `,
      organizationId,
      id,
    );
    return existing;
  }

  private async findRuleBySelector(input: {
    organizationId: string;
    courtType: string;
    legalBasis: string;
    jurisdiction?: string;
  }) {
    const rows = await this.prisma.raw.$queryRawUnsafe<DeadlineRuleRow[]>(
      `
      SELECT *
      FROM "deadline_rules"
      WHERE "organization_id" = $1
        AND "court_type" = $2
        AND "legal_basis" = $3
        AND (
          ($4::text IS NOT NULL AND "jurisdiction" = $4)
          OR "jurisdiction" IS NULL
        )
      ORDER BY
        CASE WHEN "jurisdiction" = $4 THEN 0 ELSE 1 END ASC,
        "updated_at" DESC
      LIMIT 1
      `,
      input.organizationId,
      input.courtType,
      input.legalBasis,
      input.jurisdiction ?? null,
    );
    if (rows.length === 0) return null;
    return this.mapRuleRow(rows[0]);
  }

  private mapRuleRow(row: DeadlineRuleRow) {
    return {
      id: row.id,
      organizationId: row.organization_id,
      jurisdiction: row.jurisdiction,
      courtType: row.court_type,
      legalBasis: row.legal_basis,
      defaultDays: row.default_days,
      isBusinessDays: row.is_business_days,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
