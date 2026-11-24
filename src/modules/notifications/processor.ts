import { DateTime } from "luxon";
import { Prisma } from "@/generated/prisma/client";
import { withSystem } from "@/lib/db/tenant-context";
import { logger } from "@/lib/logger";
import { enqueue } from "./outbox";
import { getEmailProvider, sanitizeError, type EmailProvider } from "./providers";
import { renderNotification } from "./render";

export const MAX_ATTEMPTS = 6;
/** Espera antes del reintento N (minutos): 1, 5, 15, 60, 240. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 240];
const STUCK_MINUTES = 10;

type Claimed = { id: string; tenant_id: string | null; kind: string; recipient: string; booking_id: string | null; payload: unknown; attempts: number };

/**
 * Envía avisos pendientes. Garantías:
 *  - FOR UPDATE SKIP LOCKED: varias ejecuciones simultáneas nunca toman el mismo aviso;
 *  - un aviso "SENDING" abandonado (worker caído) se retoma a los 10 min;
 *  - errores temporales se reintentan con espera creciente; permanentes => FAILED;
 *  - el envío NUNCA bloquea una reserva: ocurre fuera de su transacción;
 *  - al terminar (enviado/fallido/descartado) se borra el payload (enlaces cifrados).
 * Entrega "al menos una vez"; Resend descarta duplicados por Idempotency-Key.
 */
export async function processNotifications(opts: { batchSize?: number; provider?: EmailProvider | null; now?: Date } = {}) {
  const provider = opts.provider === undefined ? getEmailProvider() : opts.provider;
  const batch = Math.min(Math.max(opts.batchSize ?? 25, 1), 200);
  const stats = { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0 };

  const claimed = await withSystem((tx) =>
    tx.$queryRaw<Claimed[]>`
      UPDATE notifications n
         SET status = 'SENDING', locked_at = now(), attempts = n.attempts + 1, updated_at = now()
       WHERE n.id IN (
         SELECT id FROM notifications
          WHERE (status = 'PENDING' AND next_attempt_at <= now())
             OR (status = 'SENDING' AND locked_at < now() - make_interval(mins => ${STUCK_MINUTES}))
          ORDER BY next_attempt_at
          LIMIT ${batch}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING n.id, n.tenant_id, n.kind, n.recipient, n.booking_id, n.payload, n.attempts`,
  );
  stats.claimed = claimed.length;

  for (const n of claimed) {
    const now = opts.now ?? new Date();
    try {
      const rendered = await withSystem((tx) =>
        renderNotification(tx, { id: n.id, tenantId: n.tenant_id, kind: n.kind, recipient: n.recipient, bookingId: n.booking_id, payload: n.payload }, now),
      );
      if (!rendered.send) {
        await finish(n.id, { status: "SKIPPED", lastError: rendered.reason });
        stats.skipped++;
        continue;
      }
      if (!provider) {
        await finish(n.id, { status: "SKIPPED", lastError: "email_disabled" });
        stats.skipped++;
        continue;
      }
      const res = await provider.send({ to: n.recipient, ...rendered.content, idempotencyKey: n.id });
      if (res.ok) {
        await finish(n.id, { status: "SENT", providerMessageId: res.providerMessageId, sentAt: new Date() });
        stats.sent++;
      } else if (res.retryable && n.attempts < MAX_ATTEMPTS) {
        const wait = BACKOFF_MINUTES[Math.min(n.attempts - 1, BACKOFF_MINUTES.length - 1)]!;
        await withSystem((tx) =>
          tx.notification.update({
            where: { id: n.id },
            data: { status: "PENDING", lockedAt: null, lastError: res.error, nextAttemptAt: new Date(Date.now() + wait * 60_000) },
          }),
        );
        stats.retried++;
      } else {
        await finish(n.id, { status: "FAILED", lastError: res.error });
        stats.failed++;
        logger.warn("notification.failed", { notificationId: n.id, kind: n.kind, attempts: n.attempts });
      }
    } catch (e) {
      // Error inesperado al armar/enviar: se trata como temporal.
      const err = sanitizeError(e instanceof Error ? e.message : String(e));
      const terminal = n.attempts >= MAX_ATTEMPTS;
      await withSystem((tx) =>
        tx.notification.update({
          where: { id: n.id },
          data: terminal
            ? { status: "FAILED", lockedAt: null, lastError: err, payload: Prisma.DbNull }
            : { status: "PENDING", lockedAt: null, lastError: err, nextAttemptAt: new Date(Date.now() + 5 * 60_000) },
        }),
      );
      if (terminal) stats.failed++;
      else stats.retried++;
      logger.error("notification.error", e, { notificationId: n.id, kind: n.kind });
    }
  }
  return stats;
}

async function finish(id: string, data: { status: "SENT" | "FAILED" | "SKIPPED"; lastError?: string; providerMessageId?: string; sentAt?: Date }) {
  await withSystem((tx) =>
    tx.notification.update({
      where: { id },
      data: { ...data, lockedAt: null, payload: Prisma.DbNull },
    }),
  );
}

/**
 * Programa recordatorios y resúmenes diarios (idempotente por clave de deduplicación).
 * - Recordatorio: reservas CONFIRMED que empiezan dentro de las próximas N horas del complejo.
 * - Resumen: a la hora local configurada, una vez por día.
 */
export async function scheduleTimedNotifications(now: Date = new Date()) {
  return withSystem(async (tx) => {
    let reminders = 0;
    let digests = 0;
    const tenants = await tx.tenant.findMany({
      where: { status: "ACTIVE", notificationsEnabled: true },
      select: { id: true, timezone: true, reminderHoursBefore: true, notifyPlayers: true, notifyOwner: true, digestEnabled: true, digestHour: true, ownerNotificationEmail: true, contactEmail: true },
    });
    for (const t of tenants) {
      if (t.notifyPlayers && t.reminderHoursBefore > 0) {
        const due = await tx.booking.findMany({
          where: {
            tenantId: t.id,
            status: "CONFIRMED",
            customerEmail: { not: null },
            startsAt: { gt: now, lte: new Date(now.getTime() + t.reminderHoursBefore * 3_600_000) },
            // Reservas creadas a último momento no necesitan recordatorio.
            createdAt: { lt: new Date(now.getTime() - 30 * 60_000) },
          },
          select: { id: true, startsAt: true, customerEmail: true },
          take: 500,
        });
        for (const b of due) {
          await enqueue(tx, {
            tenantId: t.id,
            kind: "booking_reminder",
            recipient: b.customerEmail!,
            dedupeKey: `booking:${b.id}:reminder:${b.startsAt.toISOString()}`,
            bookingId: b.id,
            payload: { startsAt: b.startsAt.toISOString() },
          });
          reminders++;
        }
      }
      const owner = t.ownerNotificationEmail ?? t.contactEmail;
      if (t.digestEnabled && t.notifyOwner && owner) {
        const local = DateTime.fromJSDate(now, { zone: t.timezone });
        if (local.hour === t.digestHour) {
          await enqueue(tx, { tenantId: t.id, kind: "owner_digest", recipient: owner, dedupeKey: `tenant:${t.id}:digest:${local.toISODate()}` });
          digests++;
        }
      }
    }
    return { reminders, digests };
  });
}
