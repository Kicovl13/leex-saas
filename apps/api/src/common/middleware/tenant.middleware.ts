import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ClerkAuthService } from '../../modules/auth/clerk-auth.service';
import { tenantStorage } from '../tenant.context';
import { ORGANIZATION_ID_KEY } from '../decorators/organization-id.decorator';

export type TenantRequest = Request & { [ORGANIZATION_ID_KEY]?: string };

/**
 * Obtiene el token de sesión de Clerk (Authorization: Bearer) y sincroniza
 * Organization + User en la DB. Establece organizationId en el request y en
 * AsyncLocalStorage para el soft-filter de Prisma.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly clerkAuth: ClerkAuthService) {}

  async use(req: TenantRequest, _res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers.authorization;

    try {
      const session = await this.clerkAuth.verifyAndSync(authHeader);
      req[ORGANIZATION_ID_KEY] = session.organizationId;

      tenantStorage.run(
        {
          organizationId: session.organizationId,
          userId: session.userId,
          userRole: session.userRole,
        },
        () => next(),
      );
    } catch (err) {
      next(err);
    }
  }
}
