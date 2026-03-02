import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MattersService } from '../matters/matters.service';
import { DeadlinesService } from '../deadlines/deadlines.service';
import { TimeEntriesService } from '../time-entries/time-entries.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matters: MattersService,
    private readonly deadlines: DeadlinesService,
    private readonly timeEntries: TimeEntriesService,
  ) {}

  /**
   * Resumen para el dashboard: expedientes activos, próximos vencimientos, horas facturables del mes.
   */
  async getSummary(organizationId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const [activeMattersCount, upcomingDeadlines, billableMinutes] =
      await Promise.all([
        this.matters.countActive(organizationId),
        this.deadlines.upcoming(organizationId, 5),
        this.timeEntries.billableMinutesInPeriod(
          organizationId,
          startOfMonth,
          endOfMonth,
        ),
      ]);

    const latestMetricsSnapshot = await this.getLatestMetricsSnapshot(organizationId);

    return {
      activeMatters: activeMattersCount,
      upcomingDeadlines,
      billableMinutesThisMonth: billableMinutes,
      billableHoursThisMonth: Math.round((billableMinutes / 60) * 100) / 100,
      latestMetricsSnapshot,
    };
  }

  async recomputeMetricsSnapshot(organizationId: string) {
    const today = new Date();
    const snapshotDate = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );

    const matters = await this.prisma.matter.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        amount: true,
        clientId: true,
        client: { select: { id: true, name: true } },
        timeEntries: {
          where: { billable: true },
          select: {
            minutes: true,
            rateCents: true,
            userId: true,
            user: { select: { id: true, name: true } },
          },
        },
      },
    });

    const byLawyer = new Map<string, { userId: string; userName: string; costCents: number }>();
    const byClient = new Map<
      string,
      { clientId: string; clientName: string; revenueCents: number; costCents: number }
    >();
    const matterRows: Array<{
      matterId: string;
      matterName: string;
      revenueCents: number;
      costCents: number;
      rentabilityCents: number;
      profitMargin: number | null;
      clientName: string;
    }> = [];

    let totalRevenueCents = 0;
    let totalCostCents = 0;

    for (const matter of matters) {
      const revenueCents = toCents(matter.amount);
      const costCents = matter.timeEntries.reduce((acc, entry) => {
        const rate = entry.rateCents ?? 0;
        const entryCost = Math.round((entry.minutes * rate) / 60);

        const lawyerName = entry.user?.name ?? 'Sin nombre';
        const currentLawyer = byLawyer.get(entry.userId) ?? {
          userId: entry.userId,
          userName: lawyerName,
          costCents: 0,
        };
        currentLawyer.costCents += entryCost;
        byLawyer.set(entry.userId, currentLawyer);
        return acc + entryCost;
      }, 0);

      totalRevenueCents += revenueCents;
      totalCostCents += costCents;

      const rentabilityCents = revenueCents - costCents;
      matterRows.push({
        matterId: matter.id,
        matterName: matter.name,
        revenueCents,
        costCents,
        rentabilityCents,
        profitMargin: revenueCents > 0 ? round2(rentabilityCents / revenueCents) : null,
        clientName: matter.client?.name ?? 'Sin cliente',
      });

      const currentClient = byClient.get(matter.clientId) ?? {
        clientId: matter.clientId,
        clientName: matter.client?.name ?? 'Sin cliente',
        revenueCents: 0,
        costCents: 0,
      };
      currentClient.revenueCents += revenueCents;
      currentClient.costCents += costCents;
      byClient.set(matter.clientId, currentClient);
    }

    const topMatters = [...matterRows]
      .sort((a, b) => b.rentabilityCents - a.rentabilityCents)
      .slice(0, 10);

    const nonProfitableClients = [...byClient.values()]
      .map((row) => ({
        ...row,
        rentabilityCents: row.revenueCents - row.costCents,
      }))
      .filter((row) => row.rentabilityCents < 0)
      .sort((a, b) => a.rentabilityCents - b.rentabilityCents)
      .slice(0, 10);

    const roiByLawyer = [...byLawyer.values()]
      .map((row) => ({
        ...row,
        roi: totalRevenueCents > 0 ? round2((totalRevenueCents - row.costCents) / totalRevenueCents) : null,
      }))
      .sort((a, b) => b.costCents - a.costCents);

    const projection = this.buildMonthlyProjection(totalRevenueCents, totalCostCents);
    const metrics = {
      generatedAt: new Date().toISOString(),
      assumptions: {
        expensesIncluded: false,
        formula: 'rentability = amount - sum(timeEntry * hourlyRate)',
      },
      totals: {
        matterCount: matters.length,
        totalRevenueCents,
        totalCostCents,
        rentabilityCents: totalRevenueCents - totalCostCents,
        profitMargin:
          totalRevenueCents > 0
            ? round2((totalRevenueCents - totalCostCents) / totalRevenueCents)
            : null,
      },
      topMatters,
      roiByLawyer,
      nonProfitableClients,
      monthlyProjection: projection,
    };

    await this.prisma.raw.$executeRawUnsafe(
      `
      INSERT INTO "organization_metrics_snapshots"
        ("id", "organization_id", "snapshot_date", "metrics", "created_at")
      VALUES
        ($1, $2, $3::date, $4::jsonb, NOW())
      ON CONFLICT ("organization_id", "snapshot_date")
      DO UPDATE SET "metrics" = EXCLUDED."metrics", "created_at" = NOW()
      `,
      `ms_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      organizationId,
      snapshotDate.toISOString().slice(0, 10),
      JSON.stringify(metrics),
    );

    return {
      snapshotDate: snapshotDate.toISOString().slice(0, 10),
      metrics,
    };
  }

  async getNotifications(organizationId: string, userId?: string) {
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [urgentDeadlines, myTasksDue] = await Promise.all([
      this.prisma.deadline.findMany({
        where: {
          organizationId,
          deletedAt: null,
          completedAt: null,
          dueDate: { gte: now, lte: in48h },
        },
        include: { matter: { select: { id: true, name: true } } },
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),
      userId
        ? this.prisma.task.findMany({
            where: {
              organizationId,
              deletedAt: null,
              assignedToId: userId,
              status: { not: 'DONE' },
              dueDate: { not: null, lte: in7Days },
            },
            include: { matter: { select: { id: true, name: true } } },
            orderBy: { dueDate: 'asc' },
            take: 10,
          })
        : [],
    ]);

    return { urgentDeadlines, myTasksDue };
  }

  async getLawyerKpis(organizationId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const [users, mattersByUser, tasksByUser, timeByUser] = await Promise.all([
      this.prisma.user.findMany({
        where: { organizationId },
        select: { id: true, name: true, email: true },
      }),
      this.prisma.matter.groupBy({
        by: ['responsibleUserId'],
        where: {
          organizationId,
          deletedAt: null,
          status: 'ACTIVE',
        },
        _count: { id: true },
      }),
      this.prisma.task.groupBy({
        by: ['assignedToId'],
        where: {
          organizationId,
          deletedAt: null,
          status: { not: 'DONE' },
        },
        _count: { id: true },
      }),
      this.prisma.timeEntry.groupBy({
        by: ['userId'],
        where: {
          organizationId,
          createdAt: { gte: startOfMonth, lte: endOfMonth },
        },
        _sum: { minutes: true },
      }),
    ]);

    const matterMap = new Map(mattersByUser.map((r) => [r.responsibleUserId ?? '_none', r._count.id]));
    const taskMap = new Map(tasksByUser.map((r) => [r.assignedToId ?? '_none', r._count.id]));
    const timeMap = new Map(timeByUser.map((r) => [r.userId, r._sum.minutes ?? 0]));

    const maxMinutes = Math.max(...Array.from(timeMap.values()), 1);

    return users.map((u) => ({
      id: u.id,
      name: u.name ?? u.email,
      mattersCount: matterMap.get(u.id) ?? 0,
      tasksCount: taskMap.get(u.id) ?? 0,
      minutesThisMonth: timeMap.get(u.id) ?? 0,
      hoursThisMonth: Math.round(((timeMap.get(u.id) ?? 0) / 60) * 100) / 100,
      barPercent: Math.min(100, ((timeMap.get(u.id) ?? 0) / maxMinutes) * 100),
    }));
  }

  async getLatestMetricsSnapshot(organizationId: string) {
    const rows = await this.prisma.raw.$queryRawUnsafe<
      Array<{ snapshot_date: Date; metrics: Record<string, unknown>; created_at: Date }>
    >(
      `
      SELECT "snapshot_date", "metrics", "created_at"
      FROM "organization_metrics_snapshots"
      WHERE "organization_id" = $1
      ORDER BY "snapshot_date" DESC
      LIMIT 1
      `,
      organizationId,
    );

    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      snapshotDate: row.snapshot_date,
      createdAt: row.created_at,
      metrics: row.metrics,
    };
  }

  private buildMonthlyProjection(totalRevenueCents: number, totalCostCents: number) {
    const now = new Date();
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getDate();
    const dayOfMonth = now.getDate();
    const elapsedFactor = dayOfMonth > 0 ? daysInMonth / dayOfMonth : 1;

    const projectedRevenue = Math.round(totalRevenueCents * elapsedFactor);
    const projectedCost = Math.round(totalCostCents * elapsedFactor);
    const projectedRentability = projectedRevenue - projectedCost;
    return {
      basedOnDayOfMonth: dayOfMonth,
      daysInMonth,
      projectedRevenueCents: projectedRevenue,
      projectedCostCents: projectedCost,
      projectedRentabilityCents: projectedRentability,
      projectedProfitMargin:
        projectedRevenue > 0 ? round2(projectedRentability / projectedRevenue) : null,
    };
  }
}

function toCents(amount: unknown): number {
  if (amount == null) return 0;
  if (typeof amount === 'number') return Math.round(amount * 100);
  if (typeof amount === 'string') return Math.round(Number(amount) * 100);
  if (typeof amount === 'object' && amount != null && 'toString' in amount) {
    return Math.round(Number((amount as { toString(): string }).toString()) * 100);
  }
  return 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
