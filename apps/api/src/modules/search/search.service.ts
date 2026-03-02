import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async globalSearch(
    organizationId: string,
    q: string,
    take = 5,
  ): Promise<{
    matters: Array<{ id: string; name: string; referenceCode: string | null; client: { name: string } }>;
    clients: Array<{ id: string; name: string; email: string | null }>;
    deadlines: Array<{
      id: string;
      title: string;
      dueDate: Date;
      deadlineType: string;
      matter: { id: string; name: string } | null;
    }>;
    documents: Array<{
      id: string;
      name: string;
      matterId: string | null;
      matter: { id: string; name: string } | null;
    }>;
  }> {
    const term = q.trim();
    if (term.length < 2) {
      return { matters: [], clients: [], deadlines: [], documents: [] };
    }

    const [matters, clients, deadlines, documents] = await Promise.all([
      this.prisma.matter.findMany({
        where: {
          organizationId,
          deletedAt: null,
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { referenceCode: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
            { client: { name: { contains: term, mode: 'insensitive' } } },
          ],
        },
        select: {
          id: true,
          name: true,
          referenceCode: true,
          client: { select: { name: true } },
        },
        take,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.client.findMany({
        where: {
          organizationId,
          deletedAt: null,
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, email: true },
        take,
        orderBy: { name: 'asc' },
      }),
      this.prisma.deadline.findMany({
        where: {
          organizationId,
          deletedAt: null,
          completedAt: null,
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { notes: { contains: term, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          deadlineType: true,
          matter: { select: { id: true, name: true } },
        },
        take,
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.document.findMany({
        where: {
          organizationId,
          deletedAt: null,
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { aiSummary: { contains: term, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          name: true,
          matterId: true,
          matter: { select: { id: true, name: true } },
        },
        take,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      matters,
      clients,
      deadlines,
      documents,
    };
  }
}
