import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";

/**
 * Cupo diario de emails compartido por toda la plataforma (Brevo gratuito: 300 por día).
 *
 * - Persistente y atómico en PostgreSQL (tabla rate_limits, una fila por día UTC): varias
 *   funciones de Netlify enviando a la vez nunca superan el límite (una sola sentencia
 *   INSERT … ON CONFLICT … WHERE count < tope).
 * - Reserva por prioridad: cada nivel solo puede usar el cupo hasta su tope, así siempre
 *   queda lugar para recuperar contraseñas, verificar cuentas y confirmar o cancelar reservas.
 * - Se cuenta ANTES de enviar y se devuelve si el proveedor no aceptó el email.
 * - El día se corta en UTC. Brevo no documenta la hora exacta del reinicio: por eso el tope
 *   de lo no crítico deja margen.
 */

/** Fracción del límite diario que puede usar cada prioridad (1 = crítico). */
export const PRIORITY_SHARE: Record<number, number> = { 1: 1, 2: 0.97, 3: 0.92, 4: 0.83, 5: 0.73 };

export function dailyLimit(): number {
  return getEnv().EMAIL_DAILY_LIMIT;
}

/** Tope de envíos del día para una prioridad (el nivel 1 puede usar todo el cupo). */
export function capFor(priority: number, limit = dailyLimit()): number {
  const share = PRIORITY_SHARE[priority] ?? PRIORITY_SHARE[3]!;
  return Math.max(1, Math.floor(limit * share));
}

export function quotaDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

const keyFor = (day: string) => `email-quota:${day}`;

/** Próximo reinicio del cupo (00:00 UTC del día siguiente). */
export function nextQuotaReset(now: Date = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5));
  return d;
}

/** Toma un lugar del cupo si la prioridad todavía tiene margen. Devuelve el uso resultante o null. */
export async function reserveQuota(priority: number, now: Date = new Date()): Promise<number | null> {
  const cap = capFor(priority);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${keyFor(quotaDay(now))}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET count = rate_limits.count + 1
      WHERE rate_limits.count < ${cap}
    RETURNING count`;
  return rows[0]?.count ?? null;
}

/** Devuelve un lugar (el proveedor no aceptó el email o era un duplicado ya contado). */
export async function releaseQuota(now: Date = new Date()): Promise<void> {
  await prisma.$executeRaw`UPDATE rate_limits SET count = GREATEST(count - 1, 0) WHERE key = ${keyFor(quotaDay(now))}`;
}

export async function quotaUsage(now: Date = new Date()): Promise<{ day: string; used: number; limit: number; pct: number; criticalReserve: number }> {
  const day = quotaDay(now);
  const rows = await prisma.$queryRaw<{ count: number }[]>`SELECT count FROM rate_limits WHERE key = ${keyFor(day)}`;
  const used = rows[0]?.count ?? 0;
  const limit = dailyLimit();
  return { day, used, limit, pct: Math.min(100, Math.round((used / limit) * 100)), criticalReserve: limit - capFor(5, limit) };
}
