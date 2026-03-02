import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ORGANIZATION_ID_KEY } from '../decorators/organization-id.decorator';

export const SKIP_TENANT_KEY = 'skipTenant';

/**
 * Guard que exige que el request tenga organizationId (multi-tenancy).
 * El valor debe ser inyectado por un middleware previo (ej. desde Clerk org).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest<{ [ORGANIZATION_ID_KEY]: string }>();
    const orgId = request[ORGANIZATION_ID_KEY];

    if (!orgId || typeof orgId !== 'string') {
      throw new ForbiddenException('Organization context required. Unauthorized tenant access.');
    }
    return true;
  }
}
