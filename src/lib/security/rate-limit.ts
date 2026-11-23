import { prisma } from "@/lib/db/prisma";

export type RateLimitRule = { window: number; max: number };
export type RateLimitResult = { allowed: boolean; retryAfter: number | null };

/**
 * Rate limiting de ventana fija respaldado por PostgreSQL: funciona igual con
 * varias instancias de la app (no depende de memoria local).
 *
 * El chequeo y el incremento son UNA sola sentencia atómica (INSERT ... ON
 * CONFLICT DO UPDATE), así N solicitudes simultáneas no pueden "colarse" todas
 * leyendo un contador viejo.
 *
 * `window` en segundos. La clave nunca debe contener datos personales en claro
 * más allá de la IP / identificador necesario.
 */
export async function consumeRateLimit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const rows = await prisma.$queryRaw<{ count: number; retry_after: number }[]>`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start + make_interval(secs => ${rule.window}) <= now()
                   THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start + make_interval(secs => ${rule.window}) <= now()
                   THEN now() ELSE rate_limits.window_start END
    RETURNING count,
      GREATEST(0, CEIL(EXTRACT(EPOCH FROM (window_start + make_interval(secs => ${rule.window}) - now()))))::int AS retry_after
  `;
  const row = rows[0];
  if (!row) return { allowed: true, retryAfter: null };
  const allowed = row.count <= rule.max;
  return { allowed, retryAfter: allowed ? null : Math.max(1, row.retry_after) };
}

/** Limpieza periódica de contadores vencidos (para un cron futuro). */
export async function purgeExpiredRateLimits(olderThanSeconds = 86_400) {
  return prisma.$executeRaw`DELETE FROM rate_limits WHERE window_start < now() - make_interval(secs => ${olderThanSeconds})`;
}
