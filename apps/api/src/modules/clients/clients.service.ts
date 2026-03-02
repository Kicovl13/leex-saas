import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, data: Omit<Prisma.ClientUncheckedCreateInput, 'organizationId'>) {
    return this.prisma.client.create({
      data: { ...data, organizationId },
    });
  }

  async findAll(
    organizationId: string,
    options?: { take?: number; skip?: number; q?: string },
  ) {
    const take = Math.min(Math.max(0, options?.take ?? 50), 100);
    const skip = Math.max(0, options?.skip ?? 0);
    const where: Prisma.ClientWhereInput = { organizationId };
    if (options?.q?.trim() && options.q.trim().length >= 2) {
      where.OR = [
        { name: { contains: options.q.trim(), mode: 'insensitive' } },
        { email: { contains: options.q.trim(), mode: 'insensitive' } },
      ];
    }
    return this.prisma.client.findMany({
      where,
      orderBy: { name: 'asc' },
      take,
      skip,
    });
  }

  async findOne(organizationId: string, id: string) {
    return this.prisma.client.findFirstOrThrow({
      where: { id, organizationId },
      include: { matters: true, contacts: true },
    });
  }

  async findContacts(organizationId: string, clientId: string) {
    await this.prisma.client.findFirstOrThrow({
      where: { id: clientId, organizationId },
    });
    return this.prisma.raw.clientContact.findMany({
      where: { organizationId, clientId },
      orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    });
  }

  async addContact(
    organizationId: string,
    clientId: string,
    data: { name: string; role?: string; email?: string; phone?: string; isPrimary?: boolean; notes?: string },
  ) {
    await this.prisma.client.findFirstOrThrow({
      where: { id: clientId, organizationId },
    });
    return this.prisma.raw.clientContact.create({
      data: {
        organizationId,
        clientId,
        name: data.name,
        role: data.role ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        isPrimary: data.isPrimary ?? false,
        notes: data.notes ?? null,
      },
    });
  }

  async updateContact(
    organizationId: string,
    clientId: string,
    contactId: string,
    data: { name?: string; role?: string; email?: string; phone?: string; isPrimary?: boolean; notes?: string },
  ) {
    await this.prisma.raw.clientContact.findFirstOrThrow({
      where: { id: contactId, organizationId, clientId },
    });
    return this.prisma.raw.clientContact.update({
      where: { id: contactId },
      data,
    });
  }

  async removeContact(organizationId: string, clientId: string, contactId: string) {
    await this.prisma.raw.clientContact.findFirstOrThrow({
      where: { id: contactId, organizationId, clientId },
    });
    return this.prisma.raw.clientContact.delete({ where: { id: contactId } });
  }

  async update(
    organizationId: string,
    id: string,
    data: Prisma.ClientUncheckedUpdateInput,
  ) {
    await this.prisma.client.findFirstOrThrow({
      where: { id, organizationId },
    });
    return this.prisma.client.update({
      where: { id },
      data,
    });
  }

  async remove(organizationId: string, id: string) {
    await this.prisma.client.findFirstOrThrow({
      where: { id, organizationId },
    });
    return this.prisma.client.delete({ where: { id } });
  }
}
