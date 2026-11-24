import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

export type Tx = Prisma.TransactionClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 10_000,
  timeout: 15_000,
} as const;

/**
 * Contexto de tenant YA AUTORIZADO. Solo lo construyen:
 *  - la capa de autorización (auth/dal.ts) a partir de la sesión y la membresía;
 *  - la resolución pública por slug (modules/tenant) para la página pública.
 * Nunca se arma a partir de un tenantId recibido del navegador.
 */
export type TenantContext = {
  readonly tenantId: string;
  readonly userId: string | null;
};

function assertUuid(value: string, label: string) {
  if (!UUID_RE.test(value)) throw new Error(`${label} inválido`);
}

/**
 * Ejecuta `fn` en una transacción con las variables de RLS fijadas.
 * `set_config(..., true)` las limita a ESTA transacción: no se filtran a otra
 * petición que reutilice la conexión del pool.
 */
export async function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertUuid(ctx.tenantId, "tenantId");
  if (ctx.userId) assertUuid(ctx.userId, "userId");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true),
                              set_config('app.user_id', ${ctx.userId ?? ""}, true)`;
    return fn(tx);
  }, TX_OPTIONS);
}

/** Contexto de usuario sin tenant (p. ej. listar mis membresías). */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertUuid(userId, "userId");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  }, TX_OPTIONS);
}

/**
 * Contexto de superadministrador: ve todos los tenants. Solo lo invoca la capa
 * de plataforma después de verificar platformRole = SUPERADMIN en el servidor.
 * Las mutaciones hechas aquí deben registrarse en audit_logs (ver platform/service).
 */
export async function withPlatformAdmin<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertUuid(userId, "userId");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.platform_admin', 'on', true),
                              set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  }, TX_OPTIONS);
}

/**
 * Contexto de SISTEMA (tareas programadas, aceptación de invitaciones): ve todos
 * los complejos como la plataforma, sin un usuario detrás. Solo lo invocan jobs
 * del servidor y flujos ya validados con un token de un solo uso.
 */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.platform_admin', 'on', true), set_config('app.user_id', '', true)`;
    return fn(tx);
  }, TX_OPTIONS);
}
