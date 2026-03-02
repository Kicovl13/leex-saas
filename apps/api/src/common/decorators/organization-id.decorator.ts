import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const ORGANIZATION_ID_KEY = 'organizationId';

/**
 * Extrae organizationId del request (inyectado por TenantGuard/Middleware).
 * Uso: @OrganizationId() orgId: string
 */
export const OrganizationId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{ [ORGANIZATION_ID_KEY]: string }>();
    const orgId = request[ORGANIZATION_ID_KEY];
    if (!orgId) {
      throw new Error('Organization context not set. Ensure tenant middleware/guard runs first.');
    }
    return orgId;
  },
);
