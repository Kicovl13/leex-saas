import { Prisma } from '../generated/prisma';
import { getOrganizationId } from '../common/tenant.context';

const SCOPED_MODELS = [
  'client',
  'matter',
  'document',
  'deadline',
  'timeEntry',
  'task',
  'organizationHoliday',
  'matterActivity',
  'auditLog',
  'template',
] as const;

const SOFT_DELETE_MODELS = new Set([
  'client',
  'matter',
  'document',
  'deadline',
  'timeEntry',
  'task',
  'template',
]);

function addOrgScope<T extends Record<string, unknown>>(args: T): T {
  const orgId = getOrganizationId();
  if (!orgId) return args;
  const where = (args as { where?: Record<string, unknown> }).where as Record<string, unknown> | undefined;
  const merged = where ? { ...where, organizationId: orgId } : { organizationId: orgId };
  return { ...args, where: merged } as T;
}

function addNotDeletedScope<T extends Record<string, unknown>>(args: T, model: string): T {
  if (!SOFT_DELETE_MODELS.has(model)) return args;
  const where = (args as { where?: Record<string, unknown> }).where as Record<string, unknown> | undefined;
  if (!where) {
    return { ...args, where: { deletedAt: null } } as T;
  }
  if ('deletedAt' in where) return args;
  return { ...args, where: { ...where, deletedAt: null } } as T;
}

function addOrgToData<T extends Record<string, unknown>>(args: T): T {
  const orgId = getOrganizationId();
  if (!orgId) return args;
  const data = (args as { data?: Record<string, unknown> }).data;
  if (!data || typeof data !== 'object') return args;
  if ('organizationId' in data) return args;
  return { ...args, data: { ...data, organizationId: orgId } } as T;
}

function createScopedQueries(model: string) {
  const scope = (args: unknown) =>
    addNotDeletedScope(addOrgScope(args as Record<string, unknown>), model);
  const orgOnly = (args: unknown) => addOrgScope(args as Record<string, unknown>);

  return {
    findMany: ({ args, query }: { args: unknown; query: (args: unknown) => Promise<unknown> }) =>
      query(scope(args)),
    findFirst: ({ args, query }: { args: unknown; query: (args: unknown) => Promise<unknown> }) =>
      query(scope(args)),
    findFirstOrThrow: ({ args, query }: { args: unknown; query: (args: unknown) => Promise<unknown> }) =>
      query(scope(args)),
    findUnique: ({ args, query }: { args: unknown; query: (args: unknown) => Promise<unknown> }) =>
      query(orgOnly(args)),
    findUniqueOrThrow: ({ args, query }: { args: unknown; query: (args: unknown) => Promise<unknown> }) =>
      query(orgOnly(args)),
    count: ({ args, query }: { args: unknown; query: (args: unknown) => Promise<unknown> }) =>
      query(scope(args)),
    create: ({ args, query }: { args: unknown; query: (args: unknown) => Promise<unknown> }) =>
      query(addOrgToData(args as Record<string, unknown>)),
    createMany: ({ args, query }: { args: unknown; query: (args: unknown) => Promise<unknown> }) =>
      query(addOrgToData(args as Record<string, unknown>)),
    update: ({ args, query }: { args: unknown; query: (args: unknown) => Promise<unknown> }) =>
      query(scope(args)),
    updateMany: ({ args, query }: { args: unknown; query: (args: unknown) => Promise<unknown> }) =>
      query(scope(args)),
    delete: ({ args, query }: { args: unknown; query: (args: unknown) => Promise<unknown> }) =>
      query(scope(args)),
    deleteMany: ({ args, query }: { args: unknown; query: (args: unknown) => Promise<unknown> }) =>
      query(scope(args)),
  };
}

export function orgScopeExtension() {
  return Prisma.defineExtension((prisma) => {
    const query: Record<string, unknown> = {};
    for (const model of SCOPED_MODELS) {
      (query as Record<string, unknown>)[model] = createScopedQueries(model);
    }
    // Prisma 7 $extends exige tipos muy específicos para query; en runtime el contenido es correcto
    return prisma.$extends({ name: 'orgScope', query: query as never });
  });
}
