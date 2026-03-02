import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { getTenantContext } from '../tenant.context';

/**
 * Extrae userId del contexto del tenant (inyectado por TenantMiddleware).
 * Uso: @UserId() userId: string | undefined
 */
export const UserId = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): string | undefined => {
    return getTenantContext()?.userId;
  },
);
