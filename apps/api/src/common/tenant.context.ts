import { AsyncLocalStorage } from 'node:async_hooks';
import type { UserRole } from '../generated/prisma';

export interface TenantContext {
  organizationId: string;
  userId?: string; // Prisma User.id
  userRole?: UserRole; // Para restricción por rol (MEMBER/VIEWER solo ven sus datos)
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

export function getOrganizationId(): string | undefined {
  return tenantStorage.getStore()?.organizationId;
}
