import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByOrganization(organizationId: string) {
    return this.prisma.user.findMany({
      where: { organizationId },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  }

  async findMe(organizationId: string, userId: string | undefined) {
    if (!userId) return null;
    return this.prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { id: true, name: true, email: true, role: true },
    });
  }
}
