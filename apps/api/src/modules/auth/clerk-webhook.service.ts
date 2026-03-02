import { Injectable, Logger } from '@nestjs/common';
import { Webhook } from 'svix';
import { PrismaService } from '../../prisma/prisma.service';

export interface ClerkWebhookPayload {
  type: string;
  data: Record<string, unknown>;
}

@Injectable()
export class ClerkWebhookService {
  private readonly logger = new Logger(ClerkWebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verifica la firma Svix y devuelve el payload parseado.
   * Debe recibir el cuerpo crudo (string o Buffer) y los headers svix-id, svix-timestamp, svix-signature.
   */
  verifyPayload(
    rawBody: string | Buffer,
    headers: { 'svix-id'?: string; 'svix-timestamp'?: string; 'svix-signature'?: string },
  ): ClerkWebhookPayload {
    const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    if (!secret) {
      throw new Error('CLERK_WEBHOOK_SIGNING_SECRET is not set');
    }
    const wh = new Webhook(secret);
    const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const verified = wh.verify(payload, headers as Record<string, string>) as ClerkWebhookPayload;
    return verified;
  }

  /**
   * Procesa el evento y ejecuta la lógica de negocio. Idempotente.
   */
  async handleEvent(payload: ClerkWebhookPayload): Promise<void> {
    const { type, data } = payload;
    this.logger.log(`Processing webhook event: ${type}`);

    switch (type) {
      case 'organizationMembership.deleted':
        await this.handleOrganizationMembershipDeleted(data);
        break;
      case 'organization.deleted':
        await this.handleOrganizationDeleted(data);
        break;
      case 'user.updated':
        await this.handleUserUpdated(data);
        break;
      default:
        this.logger.log(`Unhandled webhook event type: ${type}`);
    }
  }

  /**
   * Usuario eliminado de una organización en Clerk → borrar User en nuestra DB.
   * Idempotente: si el usuario ya no existe, no falla.
   * Clerk envía data con organization (id) y public_user_data.user_id o user_id.
   */
  private async handleOrganizationMembershipDeleted(data: Record<string, unknown>): Promise<void> {
    const org = data.organization as { id?: string } | undefined;
    const clerkOrgId = org?.id ?? (data.organization_id as string | undefined);
    const publicUserData = data.public_user_data as { user_id?: string } | undefined;
    const clerkUserId =
      (data.user_id as string | undefined) ??
      publicUserData?.user_id;

    if (!clerkUserId || !clerkOrgId) {
      this.logger.warn('organizationMembership.deleted: missing user_id or organization id', {
        dataKeys: Object.keys(data),
      });
      return;
    }

    const organization = await this.prisma.raw.organization.findUnique({
      where: { clerkOrgId },
      select: { id: true },
    });

    if (!organization) {
      this.logger.log(
        `organizationMembership.deleted: organization not found for clerkOrgId=${clerkOrgId}, skipping`,
      );
      return;
    }

    const deleted = await this.prisma.raw.user.deleteMany({
      where: {
        clerkUserId,
        organizationId: organization.id,
      },
    });

    if (deleted.count > 0) {
      this.logger.log(
        `organizationMembership.deleted: deleted ${deleted.count} user(s) for clerkUserId=${clerkUserId}, orgId=${organization.id}`,
      );
    } else {
      this.logger.log(
        `organizationMembership.deleted: no user found for clerkUserId=${clerkUserId}, orgId=${organization.id} (idempotent skip)`,
      );
    }
  }

  /**
   * Organización eliminada en Clerk → eliminar Organization en nuestra DB (cascada elimina todo).
   * Idempotente: si la org ya no existe, no falla.
   */
  private async handleOrganizationDeleted(data: Record<string, unknown>): Promise<void> {
    const clerkOrgId = (data.id ?? data.organization_id) as string | undefined;
    if (!clerkOrgId) {
      this.logger.warn('organization.deleted: missing organization id', { dataKeys: Object.keys(data) });
      return;
    }

    const org = await this.prisma.raw.organization.findUnique({
      where: { clerkOrgId },
      select: { id: true, name: true },
    });

    if (!org) {
      this.logger.log(`organization.deleted: organization not found for clerkOrgId=${clerkOrgId}, skipping`);
      return;
    }

    await this.prisma.raw.organization.delete({
      where: { id: org.id },
    });
    this.logger.log(`organization.deleted: deleted organization id=${org.id} (${org.name}), clerkOrgId=${clerkOrgId}`);
  }

  /**
   * Usuario actualizado en Clerk → actualizar nombre y email en todos los User de nuestra DB con ese clerkUserId.
   * Idempotente: si no hay usuarios, no falla.
   */
  private async handleUserUpdated(data: Record<string, unknown>): Promise<void> {
    const clerkUserId = data.id as string | undefined;
    if (!clerkUserId) {
      this.logger.warn('user.updated: missing user id', { dataKeys: Object.keys(data) });
      return;
    }

    const firstName = (data.first_name as string) ?? '';
    const lastName = (data.last_name as string) ?? '';
    const name = [firstName, lastName].filter(Boolean).join(' ') || null;
    const emailAddresses = (data.email_addresses as Array<{ email_address?: string }>) ?? [];
    const email = emailAddresses[0]?.email_address ?? '';

    const updated = await this.prisma.raw.user.updateMany({
      where: { clerkUserId },
      data: { name, email },
    });

    if (updated.count > 0) {
      this.logger.log(`user.updated: updated ${updated.count} user(s) for clerkUserId=${clerkUserId}`);
    } else {
      this.logger.log(`user.updated: no user found for clerkUserId=${clerkUserId} (idempotent skip)`);
    }
  }
}
