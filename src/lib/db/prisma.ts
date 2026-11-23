import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";

/**
 * Cliente Prisma de RUNTIME. Se conecta con el rol `reservas_app`, que:
 *  - no es dueño de las tablas y no tiene BYPASSRLS => Row Level Security aplica;
 *  - no puede escribir court_allocations ni modificar audit_logs.
 *
 * Importante: las tablas del negocio tienen RLS. Fuera de `withTenant` /
 * `withPlatformAdmin` (ver tenant-context.ts) las consultas devuelven vacío.
 * Eso es intencional: un olvido de filtro falla "cerrado", no filtra datos.
 */
const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

function createClient() {
  const env = getEnv();
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
  });
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.__prisma ?? createClient();

if (getEnv().NODE_ENV !== "production") globalForPrisma.__prisma = prisma;
