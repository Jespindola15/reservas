import { DateTime } from "luxon";
import { Prisma } from "@/generated/prisma/client";
import { withSystem, type Tx } from "@/lib/db/tenant-context";
import { emailProviderName } from "@/lib/env";
import { logger } from "@/lib/logger";
import { enqueue, ADMIN_KINDS, OWNER_MUTABLE_KINDS, type NotificationKind } from "./outbox";
import { getEmailProvider, sanitizeError, type EmailProvider } from "./providers";
import { nextQuotaReset, quotaUsage, releaseQuota, reserveQuota } from "./quota";
import { renderNotification } from "./render";

export const MAX_ATTEMPTS = 6;
/** Espera antes del reintento N (minutos): 1, 5, 15, 60, 240. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 240];
const STUCK_MINUTES = 10;
/** Si la cuenta del proveedor no puede enviar (clave, créditos, remitente), se reintenta en este plazo. */
const PROVIDER_DOWN_MINUTES = 15;
/** Recordatorios: si no hay cupo se descartan (al día siguiente ya no sirven). */
const DISCARD_WITHOUT_QUOTA = new Set(["booking_reminder", "booking_reminder_24h", "booking_reminder_2h"]);

type Claimed = { id: string; tenant_id: string | null; kind: string; recipient: string; booking_id: string | null; payload: unknown; attempts: number; priority: number };

export type ProcessStats = { claimed: number; sent: number; retried: number; failed: number; skipped: number; deferred: number; providerDown: boolean };

/**
 * Envía avisos pendientes. Garantías:
 *  - FOR UPDATE SKIP LOCKED: varias ejecuciones simultáneas nunca toman el mismo aviso;
 *  - orden por prioridad (contraseña y verificación primero);
 *  - cupo diario persistente: sin cupo, lo útil se aplaza al día siguiente y los recordatorios se descartan;
 *  - un aviso "SENDING" abandonado (worker caído) se retoma a los 10 min (el proveedor descarta
 *    el duplicado por clave de idempotencia);
 *  - errores temporales se reintentan con espera creciente; permanentes => FAILED;
 *  - si la cuenta del proveedor no puede enviar, se corta el lote sin gastar intentos y se avisa;
 *  - el envío NUNCA bloquea una reserva: ocurre fuera de su transacción;
 *  - al terminar (enviado/fallido/descartado) se borra el payload (enlaces cifrados).
 * SENT significa ACEPTADO por el proveedor; la entrega real la informa el webhook (delivery_status).
 */
export async function processNotifications(opts: { batchSize?: number; provider?: EmailProvider | null; now?: Date } = {}): Promise<ProcessStats> {
  const provider = opts.provider === undefined ? getEmailProvider() : opts.provider;
  // Proveedor elegido pero mal configurado (falta la clave o el remitente): los avisos esperan en cola.
  const misconfigured = opts.provider === undefined && !provider && ["brevo", "resend"].includes(emailProviderName());
  const batch = Math.min(Math.max(opts.batchSize ?? 25, 1), 200);
  const stats: ProcessStats = { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0, deferred: 0, providerDown: false };
  if (misconfigured) return stats;

  const claimed = await withSystem((tx) =>
    tx.$queryRaw<Claimed[]>`
      UPDATE notifications n
         SET status = 'SENDING', locked_at = now(), attempts = n.attempts + 1, updated_at = now()
       WHERE n.id IN (
         SELECT id FROM notifications
          WHERE (status = 'PENDING' AND next_attempt_at <= now())
             OR (status = 'SENDING' AND locked_at < now() - make_interval(mins => ${STUCK_MINUTES}))
          ORDER BY priority, next_attempt_at
          LIMIT ${batch}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING n.id, n.tenant_id, n.kind, n.recipient, n.booking_id, n.payload, n.attempts, n.priority`,
  );
  stats.claimed = claimed.length;

  for (let i = 0; i < claimed.length; i++) {
    const n = claimed[i]!;
    const now = opts.now ?? new Date();
    let reserved = false;
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
      const used = await reserveQuota(n.priority);
      if (used === null) {
        if (DISCARD_WITHOUT_QUOTA.has(n.kind)) {
          await finish(n.id, { status: "SKIPPED", lastError: "quota_exhausted" });
          stats.skipped++;
        } else {
          await requeue(n.id, nextQuotaReset(), "quota_exhausted: se envía cuando se renueve el cupo diario");
          stats.deferred++;
        }
        continue;
      }
      reserved = true;
      const res = await provider.send({ to: n.recipient, ...rendered.content, idempotencyKey: n.id, tag: n.kind });
      if (res.ok) {
        // Duplicado: ya se había aceptado (y contado) en un intento anterior.
        if (res.duplicate) await releaseQuota();
        await finish(n.id, { status: "SENT", providerMessageId: res.providerMessageId, sentAt: new Date(), provider: provider.name });
        stats.sent++;
        if (!(ADMIN_KINDS as readonly string[]).includes(n.kind)) await checkQuotaAlerts(used);
        continue;
      }
      await releaseQuota();
      reserved = false;
      if (res.providerDown) {
        // La cuenta no puede enviar: se devuelven este aviso y el resto del lote sin gastar intentos.
        stats.providerDown = true;
        const rest = claimed.slice(i);
        await withSystem((tx) =>
          tx.$executeRaw`UPDATE notifications SET status = 'PENDING', locked_at = NULL, attempts = GREATEST(attempts - 1, 0),
            last_error = ${res.error}, next_attempt_at = now() + make_interval(mins => ${PROVIDER_DOWN_MINUTES}), updated_at = now()
            WHERE id = ANY(${rest.map((r) => r.id)}::uuid[]) AND status = 'SENDING'`,
        );
        stats.deferred += rest.length;
        await alertProviderDown(res.error);
        break;
      }
      if (res.retryable && n.attempts < MAX_ATTEMPTS) {
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
      if (reserved) await releaseQuota().catch(() => undefined);
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
  if (stats.failed > 0) await checkFailureAlerts().catch((e: unknown) => logger.error("notification.alert_failed", e));
  return stats;
}

async function finish(id: string, data: { status: "SENT" | "FAILED" | "SKIPPED"; lastError?: string; providerMessageId?: string; sentAt?: Date; provider?: string }) {
  await withSystem((tx) =>
    tx.notification.update({
      where: { id },
      data: { ...data, lockedAt: null, payload: Prisma.DbNull },
    }),
  );
}

/** Vuelve a la cola sin contar el intento (aplazado por cupo). */
async function requeue(id: string, at: Date, reason: string) {
  await withSystem((tx) =>
    tx.$executeRaw`UPDATE notifications SET status = 'PENDING', locked_at = NULL, attempts = GREATEST(attempts - 1, 0),
      last_error = ${reason}, next_attempt_at = ${at}, updated_at = now() WHERE id = ${id}::uuid`,
  );
}

// ------------------------------------------------------------------ Alertas al superadministrador
// Sin ciclos: los avisos admin_* nunca disparan otra alerta, cada alerta sale como máximo una vez
// por día (clave de deduplicación) y usa la prioridad 1 (reserva de cupo).

export async function enqueueForSuperadmins(
  tx: Tx,
  kind: NotificationKind,
  dedupeKey: string,
  payload?: Prisma.InputJsonValue,
  exceptUserId?: string | null,
  tenantId: string | null = null,
) {
  const admins = await tx.user.findMany({
    where: { platformRole: "SUPERADMIN", isDisabled: false, anonymizedAt: null, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) },
    select: { id: true, email: true },
    take: 10,
  });
  let created = 0;
  for (const a of admins) created += await enqueue(tx, { tenantId, kind, recipient: a.email, dedupeKey: `${dedupeKey}:${a.id}`, payload });
  return created;
}

async function checkQuotaAlerts(used: number) {
  const { limit, day } = await quotaUsage();
  const level = used >= Math.floor(limit * 0.95) ? 95 : used >= Math.floor(limit * 0.8) ? 80 : 0;
  if (!level) return;
  const created = await withSystem((tx) => enqueueForSuperadmins(tx, "admin_quota_warning", `admin:quota:${day}:${level}`, { used, limit, level }));
  if (created) {
    const { sendAlert } = await import("@/modules/jobs/runner");
    await sendAlert(`email-quota-${level}`, `Emails: se usó el ${level}% del cupo diario (${used}/${limit}).`);
  }
}

async function checkFailureAlerts() {
  const since = new Date(Date.now() - 3_600_000);
  const failed = await withSystem((tx) =>
    tx.notification.count({ where: { status: "FAILED", updatedAt: { gt: since }, kind: { notIn: [...ADMIN_KINDS] } } }),
  );
  if (failed < 5) return;
  const day = new Date().toISOString().slice(0, 10);
  const created = await withSystem((tx) => enqueueForSuperadmins(tx, "admin_email_failures", `admin:failures:${day}`, { failed, reason: "failures" }));
  if (!created) return;
  const { sendAlert } = await import("@/modules/jobs/runner");
  await sendAlert("email-failures", `Emails: ${failed} envíos fallidos en la última hora.`);
}

async function alertProviderDown(error: string) {
  const day = new Date().toISOString().slice(0, 10);
  logger.error("email.provider_down", undefined, { error });
  // Se encola igual: si la cuenta se recupera, el superadmin recibe el aviso de lo que pasó.
  await withSystem((tx) => enqueueForSuperadmins(tx, "admin_email_failures", `admin:provider-down:${day}`, { reason: "provider_down", error: error.slice(0, 200) })).catch(() => 0);
  const { sendAlert } = await import("@/modules/jobs/runner");
  await sendAlert("email-provider-down", "Emails: el proveedor rechaza los envíos de la cuenta (clave, créditos o remitente). Revisá /admin/correos.");
}

/** Recordatorios: 24 h antes (si se reservó con más de un día) y 2 h antes (si se reservó con más de 3 h). */
export const REMINDERS = [
  { kind: "booking_reminder_24h", aheadHours: 24, minLeadHours: 26, notBeforeHours: 3 },
  { kind: "booking_reminder_2h", aheadHours: 2, minLeadHours: 3, notBeforeHours: 0 },
] as const;

/**
 * Programa avisos por tiempo (idempotente por clave de deduplicación; corre en cada tick):
 *  - recordatorios de 24 h y 2 h solo para reservas CONFIRMED, una vez por horario;
 *  - aviso al complejo de transferencia informada por vencer;
 *  - avisos de suscripción (vence en 3 días / venció);
 *  - resumen diario del complejo a su hora local.
 */
export async function scheduleTimedNotifications(now: Date = new Date()) {
  return withSystem(async (tx) => {
    let reminders = 0;
    let digests = 0;
    let transferAlerts = 0;
    let subscriptionNotices = 0;
    const tenants = await tx.tenant.findMany({
      where: { status: "ACTIVE", notificationsEnabled: true },
      select: { id: true, timezone: true, reminderHoursBefore: true, notifyPlayers: true, notifyOwner: true, digestEnabled: true, digestHour: true, ownerNotificationEmail: true, contactEmail: true, ownerEmailMuted: true },
    });
    for (const t of tenants) {
      // reminderHoursBefore = 0 apaga los recordatorios del complejo.
      if (t.notifyPlayers && t.reminderHoursBefore > 0) {
        for (const r of REMINDERS) {
          const due = await tx.booking.findMany({
            where: {
              tenantId: t.id,
              status: "CONFIRMED",
              customerEmail: { not: null },
              startsAt: { gt: new Date(now.getTime() + r.notBeforeHours * 3_600_000), lte: new Date(now.getTime() + r.aheadHours * 3_600_000) },
            },
            select: { id: true, startsAt: true, createdAt: true, customerEmail: true },
            take: 500,
          });
          for (const b of due) {
            // Reservas hechas sobre la hora no necesitan este recordatorio.
            if (b.startsAt.getTime() - b.createdAt.getTime() < r.minLeadHours * 3_600_000) continue;
            reminders += await enqueue(tx, {
              tenantId: t.id,
              kind: r.kind,
              recipient: b.customerEmail!,
              dedupeKey: `booking:${b.id}:${r.kind}:${b.startsAt.toISOString()}`,
              bookingId: b.id,
              payload: { startsAt: b.startsAt.toISOString() },
            });
          }
        }
      }
      const owner = t.ownerNotificationEmail ?? t.contactEmail;
      if (t.notifyOwner && owner) {
        // Transferencias informadas cuyo plazo de revisión está por vencer (la función SQL ya marcó review_alerted_at).
        if (!t.ownerEmailMuted.includes("owner_transfer_expiring")) {
          const expiring = await tx.booking.findMany({
            where: { tenantId: t.id, status: "PENDING", paymentStatus: "TRANSFER_REPORTED", reviewAlertedAt: { not: null }, expiresAt: { gt: now } },
            select: { id: true },
            take: 100,
          });
          for (const b of expiring) {
            transferAlerts += await enqueue(tx, { tenantId: t.id, kind: "owner_transfer_expiring", recipient: owner, dedupeKey: `booking:${b.id}:owner_transfer_expiring`, bookingId: b.id });
          }
        }
        if (!t.ownerEmailMuted.includes("owner_subscription_notice")) {
          const sub = await tx.subscription.findFirst({
            where: { tenantId: t.id, status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
            orderBy: { currentPeriodEnd: "desc" },
            select: { id: true, status: true, currentPeriodEnd: true },
          });
          if (sub) {
            const ms = sub.currentPeriodEnd.getTime() - now.getTime();
            const stage = ms > 0 && ms <= 3 * 86_400_000 ? "soon" : ms <= 0 && ms > -3 * 86_400_000 ? "expired" : null;
            if (stage) {
              subscriptionNotices += await enqueue(tx, {
                tenantId: t.id,
                kind: "owner_subscription_notice",
                recipient: owner,
                dedupeKey: `subscription:${sub.id}:${sub.currentPeriodEnd.toISOString()}:${stage}`,
                payload: { subscriptionId: sub.id, stage, periodEnd: sub.currentPeriodEnd.toISOString() },
              });
            }
          }
        }
        if (t.digestEnabled) {
          const local = DateTime.fromJSDate(now, { zone: t.timezone });
          if (local.hour === t.digestHour) {
            digests += await enqueue(tx, { tenantId: t.id, kind: "owner_digest", recipient: owner, dedupeKey: `tenant:${t.id}:digest:${local.toISODate()}` });
          }
        }
      }
    }
    return { reminders, digests, transferAlerts, subscriptionNotices };
  });
}

/** Los avisos al complejo que el complejo apagó no se encolan ni se envían. */
export function isOwnerKindMuted(muted: readonly string[], kind: string): boolean {
  return (OWNER_MUTABLE_KINDS as readonly string[]).includes(kind) && muted.includes(kind);
}
