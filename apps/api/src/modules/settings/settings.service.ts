import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import { PrismaService } from '../../prisma/prisma.service';
import { UsageLimitService } from '../documents/usage-limit.service';
import { S3Service } from '../documents/s3.service';

const PLAN_LIMITS: Record<string, number> = {
  FREE: 5,
  PRO: 100,
  ENTERPRISE: 999_999,
};

const LOGO_PREFIX = 'logos';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usageLimit: UsageLimitService,
    private readonly s3: S3Service,
  ) {}

  async getAppearance(organizationId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { logoUrl: true, primaryColor: true, darkMode: true, fontFamily: true, settings: true },
    });
    if (!org) throw new ForbiddenException('Organización no encontrada.');
    const settings = (org.settings as Record<string, unknown>) ?? {};
    const themePreference = (settings.themePreference as string) ?? (org.darkMode ? 'dark' : 'system');
    return {
      logoUrl: org.logoUrl,
      primaryColor: org.primaryColor,
      darkMode: org.darkMode,
      fontFamily: org.fontFamily,
      themePreference: ['light', 'dark', 'system'].includes(themePreference) ? themePreference : 'system',
    };
  }

  async getProfile(organizationId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { name: true, address: true, phone: true, website: true, currency: true },
    });
    if (!org) throw new ForbiddenException('Organización no encontrada.');
    return org;
  }

  async updateProfile(
    organizationId: string,
    data: { address?: string | null; phone?: string | null; website?: string | null; currency?: string },
  ) {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!org) throw new ForbiddenException('Organización no encontrada.');
    return this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(data.address !== undefined && { address: data.address }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.website !== undefined && { website: data.website }),
        ...(data.currency !== undefined && { currency: data.currency }),
      },
    });
  }

  async getPlanAndUsage(organizationId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { plan: true },
    });
    if (!org) throw new ForbiddenException('Organización no encontrada.');
    const aiDocumentsThisMonth = await this.usageLimit.getMonthlyProcessedCount(organizationId);
    const aiLimit = PLAN_LIMITS[org.plan] ?? PLAN_LIMITS.FREE;
    return {
      plan: org.plan,
      aiDocumentsThisMonth,
      aiLimit,
    };
  }

  async getHolidays(organizationId: string) {
    return this.prisma.organizationHoliday.findMany({
      where: { organizationId },
      orderBy: { date: 'asc' },
    });
  }

  async createHoliday(
    organizationId: string,
    data: { date: string; name?: string },
  ) {
    const date = new Date(data.date);
    date.setUTCHours(0, 0, 0, 0);
    return this.prisma.organizationHoliday.create({
      data: {
        organizationId,
        date,
        name: data.name ?? null,
      },
    });
  }

  async removeHoliday(organizationId: string, id: string) {
    const holiday = await this.prisma.organizationHoliday.findFirst({
      where: { id, organizationId },
    });
    if (!holiday) throw new NotFoundException('Festivo no encontrado.');
    return this.prisma.organizationHoliday.delete({ where: { id } });
  }

  async updateAppearance(
    organizationId: string,
    data: {
      logoUrl?: string | null;
      primaryColor?: string;
      darkMode?: boolean;
      fontFamily?: string;
      themePreference?: 'light' | 'dark' | 'system';
    },
  ) {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { id: true, settings: true },
    });
    if (!org) throw new ForbiddenException('Organización no encontrada.');
    const settings = (org.settings as Record<string, unknown>) ?? {};
    if (data.themePreference !== undefined) {
      (settings as Record<string, string>).themePreference = data.themePreference;
    }
    const darkMode =
      data.darkMode !== undefined
        ? data.darkMode
        : data.themePreference !== undefined
          ? data.themePreference === 'dark'
          : undefined;
    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
        ...(data.primaryColor !== undefined && { primaryColor: data.primaryColor }),
        ...(darkMode !== undefined && { darkMode }),
        ...(data.fontFamily !== undefined && { fontFamily: data.fontFamily }),
        ...(data.themePreference !== undefined && { settings }),
      },
    });
    return this.getAppearance(organizationId);
  }

  async getLogoUploadUrl(organizationId: string, contentType: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!org) throw new ForbiddenException('Organización no encontrada.');
    if (!this.s3.isConfigured()) throw new ForbiddenException('S3 no configurado.');
    const ext = contentType.includes('png') ? 'png' : contentType.includes('svg') ? 'svg' : 'jpg';
    const key = `${organizationId}/${LOGO_PREFIX}/${Date.now()}.${ext}`;
    const uploadUrl = await this.s3.getUploadSignedUrl(key, contentType);
    return { uploadUrl, logoKey: key };
  }

  async getLogoUrl(organizationId: string): Promise<{ url: string } | null> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { logoUrl: true },
    });
    if (!org?.logoUrl || !this.s3.isConfigured()) return null;
    const url = await this.s3.getReadSignedUrl(org.logoUrl, 3600);
    return { url };
  }

  async createInvitation(organizationId: string, userId: string, email: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { clerkOrgId: true },
    });
    if (!org?.clerkOrgId) {
      throw new BadRequestException('Esta organización no está vinculada a Clerk. No se pueden enviar invitaciones.');
    }
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { clerkUserId: true },
    });
    if (!user?.clerkUserId) {
      throw new ForbiddenException('Usuario no encontrado.');
    }
    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    const invitation = await clerk.organizations.createOrganizationInvitation({
      organizationId: org.clerkOrgId,
      inviterUserId: user.clerkUserId,
      emailAddress: email,
      role: 'org:member',
    });
    return { id: invitation.id, email: invitation.emailAddress, status: invitation.status };
  }
}
