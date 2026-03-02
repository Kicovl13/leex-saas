import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole } from '../../generated/prisma';

function buildAuthorizedParties(): string[] {
  const env = process.env.CLERK_AUTHORIZED_PARTIES || process.env.FRONTEND_URL || 'http://localhost:3000';
  return env.split(',').map((s) => s.trim()).filter(Boolean);
}

export interface ClerkSession {
  organizationId: string; // Nuestro Prisma Organization.id
  userId: string; // Nuestro Prisma User.id
  userRole: UserRole;
  clerkUserId: string;
  clerkOrgId: string;
}

/**
 * Verifica el JWT de Clerk y sincroniza Organization + User en nuestra DB.
 * Si la org o el usuario no existen, se crean (upsert).
 */
@Injectable()
export class ClerkAuthService {
  private readonly logger = new Logger(ClerkAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async verifyAndSync(bearerToken: string | undefined): Promise<ClerkSession> {
    this.logger.log('Auth: verificando token (request recibido)');
    if (!bearerToken?.startsWith('Bearer ')) {
      this.logger.warn('Auth 403: falta header Authorization Bearer');
      throw new ForbiddenException('Missing or invalid Authorization header');
    }
    const token = bearerToken.slice(7).trim();
    if (!token) {
      this.logger.warn('Auth 403: token vacío');
      throw new ForbiddenException('Missing session token');
    }

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      this.logger.warn('Auth 403: CLERK_SECRET_KEY no configurada');
      throw new ForbiddenException('API: CLERK_SECRET_KEY not configured');
    }

    let payload: { sub?: string; org_id?: string; org_slug?: string; o?: { id?: string; slg?: string } };
    const jwtKey = process.env.CLERK_JWT_KEY?.trim() || undefined;
    const authorizedParties = buildAuthorizedParties();

    try {
      const result = await verifyToken(token, {
        secretKey,
        ...(jwtKey ? { jwtKey } : {}),
        ...(authorizedParties.length > 0 ? { authorizedParties } : {}),
      });
      if (result == null || typeof result !== 'object') {
        throw new ForbiddenException('Invalid or expired token');
      }
      payload = result as typeof payload;
    } catch (err: unknown) {
      const reason = err && typeof err === 'object' && 'reason' in err ? (err as { reason?: string }).reason : undefined;
      const action = err && typeof err === 'object' && 'action' in err ? (err as { action?: string }).action : undefined;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Clerk token verification failed. reason=${reason ?? 'unknown'} action=${action ?? 'none'} message=${msg}`,
      );
      if (jwtKey) {
        this.logger.warn(
          'CLERK_JWT_KEY está definida. Si el 403 persiste, bórrela de apps/api/.env y reinicie la API para usar solo CLERK_SECRET_KEY (JWKS por red).',
        );
      }
      throw new ForbiddenException('Invalid or expired session');
    }

    const clerkUserId = payload?.sub;
    if (!clerkUserId) {
      this.logger.warn('Auth 403: token sin sub (user)');
      throw new ForbiddenException('Invalid token: missing user');
    }

    const clerkOrgId =
      payload.org_id ??
      payload.o?.id ??
      (payload as { org_id?: string }).org_id;
    const orgSlug =
      payload.org_slug ??
      payload.o?.slg ??
      (payload as { org_slug?: string }).org_slug;

    if (!clerkOrgId) {
      this.logger.warn(
        'Auth 403: token sin organización (org_id/o.id). Seleccione una organización en la app y recargue.',
      );
      throw new ForbiddenException(
        'Organization context required. Switch to an organization in the app.',
      );
    }

    const { organizationId, userId, userRole } = await this.syncOrgAndUser({
      clerkOrgId,
      orgSlug: orgSlug ?? clerkOrgId,
      clerkUserId,
    });

    return {
      organizationId,
      userId,
      userRole,
      clerkUserId,
      clerkOrgId,
    };
  }

  private async syncOrgAndUser(params: {
    clerkOrgId: string;
    orgSlug: string;
    clerkUserId: string;
  }): Promise<{ organizationId: string; userId: string; userRole: UserRole }> {
    const { clerkOrgId, orgSlug, clerkUserId } = params;

    // Usar cliente raw: el contexto de tenant aún no está establecido en este punto.
    const org = await this.prisma.raw.organization.upsert({
      where: { clerkOrgId },
      create: {
        name: `Despacho ${orgSlug}`,
        slug: orgSlug.replace(/^org_/, '').slice(0, 50) || clerkOrgId.slice(0, 50),
        clerkOrgId,
      },
      update: {},
    });

    // Obtener email/nombre del usuario desde Clerk (opcional; si no tenemos API, usar placeholders)
    let email = `${clerkUserId}@placeholder.local`;
    let name: string | null = null;
    if (process.env.CLERK_SECRET_KEY) {
      try {
        const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
        const clerkUser = await clerk.users.getUser(clerkUserId);
        email = clerkUser.emailAddresses[0]?.emailAddress ?? email;
        name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || null;
      } catch {
        // keep placeholder
      }
    }

    // Sincronizar User por (organization_id, clerk_user_id) sin usar upsert/ON CONFLICT,
    // para evitar errores con el driver adapter cuando ya no existe unique en clerk_user_id.
    const where = {
      organizationId_clerkUserId: {
        organizationId: org.id,
        clerkUserId,
      },
    };
    let user = await this.prisma.raw.user.findUnique({ where });
    if (user) {
      user = await this.prisma.raw.user.update({
        where,
        data: { email, name },
      });
    } else {
      user = await this.prisma.raw.user.create({
        data: {
          organizationId: org.id,
          clerkUserId,
          email,
          name,
          role: UserRole.MEMBER,
        },
      });
    }

    if (!user) {
      this.logger.warn('Auth 403: sync user devolvió null');
      throw new ForbiddenException('No se pudo sincronizar el usuario con la organización.');
    }
    return { organizationId: org.id, userId: user.id, userRole: user.role };
  }
}
