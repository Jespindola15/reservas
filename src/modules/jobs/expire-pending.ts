import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

/**
 * Vence las solicitudes PENDING cuyo plazo terminó y libera sus turnos.
 *
 * Toda la lógica crítica vive en PostgreSQL (app_expire_pending_bookings):
 *  - FOR UPDATE SKIP LOCKED => varias ejecuciones simultáneas (varias
 *    instancias, cron + programador interno) nunca procesan la misma fila;
 *  - el UPDATE exige status = 'PENDING' => idempotente;
 *  - el trigger de ocupación libera el turno en la misma transacción;
 *  - cada vencimiento queda auditado (actor SYSTEM).
 * Esta función solo itera en lotes y registra el resultado.
 */
export async function expirePendingBookings(opts: { batchSize?: number; maxBatches?: number; tenantId?: string } = {}) {
  const batchSize = Math.min(Math.max(opts.batchSize ?? 200, 1), 1000);
  const maxBatches = Math.min(Math.max(opts.maxBatches ?? 50, 1), 500);
  let expired = 0;
  const startedAt = Date.now();
  for (let i = 0; i < maxBatches; i++) {
    const rows = opts.tenantId
      ? await prisma.$queryRaw<{ booking_id: string }[]>`SELECT booking_id FROM app_expire_pending_bookings(${batchSize}, ${opts.tenantId}::uuid)`
      : await prisma.$queryRaw<{ booking_id: string }[]>`SELECT booking_id FROM app_expire_pending_bookings(${batchSize})`;
    expired += rows.length;
    if (rows.length < batchSize) break;
  }
  if (expired > 0) logger.info("job.expire_pending.done", { expired, ms: Date.now() - startedAt });
  return { expired };
}
