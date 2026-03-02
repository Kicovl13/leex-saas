import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { getTenantContext } from '../tenant.context';

/**
 * Extrae el rol del usuario del contexto del tenant (inyectado por TenantMiddleware).
 * Uso: @UserRole() userRole: UserRole | undefined
 */
export const UserRole = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext) => {
    return getTenantContext()?.userRole;
  },
);
