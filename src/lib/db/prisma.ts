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

/**
 * Creación PEREZOSA: el cliente (y la validación del entorno) recién se crea en
 * el primer uso. Así, si falta configuración, el error ocurre al renderizar —donde
 * lo atrapa app/error.tsx— y no al importar el módulo (lo que tiraba toda la app).
 */
function getClient(): PrismaClient {
  if (!globalForPrisma.__prisma) globalForPrisma.__prisma = createClient();
  return globalForPrisma.__prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
