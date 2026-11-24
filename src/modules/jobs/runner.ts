import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { withSystem } from "@/lib/db/tenant-context";
import { getEnv } from "@/lib/env";
import { logger, redact } from "@/lib/logger";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { processNotifications, scheduleTimedNotifications } from "@/modules/notifications/processor";
import { expirePendingBookings } from "./expire-pending";

/**
 * Política de retención (lo único que se borra automáticamente). Reservas y
 * auditoría NUNCA se borran: requieren una política de retención definida.
 */
export const RETENTION = {
  rateLimitsHours: 24,
  expiredSessionsHours: 24,
  expiredVerificationsHours: 1,
  closedInvitationsDays: 30,
  sentNotificationsDays: 90,
  failedNotificationsDays: 180,
} as const;

/** Alerta crítica: log estructurado + webhook opcional, como máximo 1 cada 30 min por clave. */
export async function sendAlert(key: string, message: string, details: Record<string, unknown> = {}) {
  logger.error("alert", undefined, { alertKey: key, message, ...details });
  const url = getEnv().ALERT_WEBHOOK_URL;
  if (!url) return;
  const gate = await consumeRateLimit(`alert:${key}`, { window: 1800, max: 1 }).catch(() => ({ allowed: false }));
  if (!gate.allowed) return;
  const text = `⚠️ TURNUP: ${message}`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // "text" (Slack) y "content" (Discord). Sin datos personales.
    body: JSON.stringify({ text, content: text }),
    signal: AbortSignal.timeout(5_000),
  }).catch((e) => logger.warn("alert.webhook_failed", { error: e instanceof Error ? e.message : String(e) }));
}

/** Ejecuta un paso registrando inicio, fin, resultado y fallas consecutivas en job_runs. */
export async function runJob<T>(name: string, fn: () => Promise<T>): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  await withSystem((tx) =>
    tx.jobRun.upsert({ where: { name }, create: { name, lastStartedAt: new Date() }, update: { lastStartedAt: new Date() } }),
  );
  try {
    const result = await fn();
    await withSystem((tx) =>
      tx.jobRun.update({
        where: { name },
        data: {
          lastFinishedAt: new Date(),
          lastSuccessAt: new Date(),
          lastStatus: "ok",
          lastError: null,
          consecutiveFailures: 0,
          lastResult: (result ?? null) as Prisma.InputJsonValue,
        },
      }),
    );
    return { ok: true, result };
  } catch (e) {
    const error = redact(e instanceof Error ? e.message : String(e)).slice(0, 300);
    const run = await withSystem((tx) =>
      tx.jobRun.update({
        where: { name },
        data: { lastFinishedAt: new Date(), lastStatus: "error", lastError: error, consecutiveFailures: { increment: 1 } },
        select: { consecutiveFailures: true },
      }),
    ).catch(() => ({ consecutiveFailures: 0 }));
    logger.error("job.failed", e, { job: name, consecutiveFailures: run.consecutiveFailures });
    if (run.consecutiveFailures >= 3) await sendAlert(`job:${name}`, `El job "${name}" falló ${run.consecutiveFailures} veces seguidas.`);
    return { ok: false, error };
  }
}

/** Limpieza de registros temporales (con lock: una sola ejecución a la vez). */
export async function cleanup(now: Date = new Date()) {
  return withSystem(async (tx) => {
    const lock = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('turnup:cleanup')) AS ok`;
    if (!lock[0]?.ok) return { skipped: true };
    const h = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
    const rateLimits = await tx.rateLimit.deleteMany({ where: { windowStart: { lt: h(RETENTION.rateLimitsHours) } } });
    const sessions = await tx.session.deleteMany({ where: { expiresAt: { lt: h(RETENTION.expiredSessionsHours) } } });
    const verifications = await tx.verification.deleteMany({ where: { expiresAt: { lt: h(RETENTION.expiredVerificationsHours) } } });
    const invitations = await tx.invitation.deleteMany({
      where: {
        acceptedAt: null,
        OR: [{ revokedAt: { lt: h(RETENTION.closedInvitationsDays * 24) } }, { expiresAt: { lt: h(RETENTION.closedInvitationsDays * 24) } }],
      },
    });
    const sent = await tx.notification.deleteMany({ where: { status: { in: ["SENT", "SKIPPED"] }, createdAt: { lt: h(RETENTION.sentNotificationsDays * 24) } } });
    const failed = await tx.notification.deleteMany({ where: { status: "FAILED", createdAt: { lt: h(RETENTION.failedNotificationsDays * 24) } } });
    return { rateLimits: rateLimits.count, sessions: sessions.count, verifications: verifications.count, invitations: invitations.count, notifications: sent.count + failed.count };
  });
}

/**
 * Tarea programada ÚNICA (cada minuto). Cada paso es idempotente y seguro ante
 * ejecuciones simultáneas; un paso que falla no impide los siguientes.
 */
export async function tick(now: Date = new Date()) {
  const expire = await runJob("expire_pending", () => expirePendingBookings());
  const schedule = await runJob("schedule_notifications", () => scheduleTimedNotifications(now));
  const send = await runJob("send_notifications", () => processNotifications({ batchSize: 50 }));
  let clean: Awaited<ReturnType<typeof runJob>> | { ok: true; result: "not_due" } = { ok: true, result: "not_due" };
  const last = await withSystem((tx) => tx.jobRun.findUnique({ where: { name: "cleanup" }, select: { lastSuccessAt: true } }));
  if (!last?.lastSuccessAt || now.getTime() - last.lastSuccessAt.getTime() > 3_600_000) {
    clean = await runJob("cleanup", () => cleanup(now));
  }
  await runJob("tick", async () => ({ at: now.toISOString() }));
  return { expire, schedule, send, cleanup: clean };
}

/** Datos para /api/health (sin datos personales). */
export async function healthSnapshot() {
  const t0 = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const dbMs = Date.now() - t0;
  const { jobs, backlog, failed24h } = await withSystem(async (tx) => ({
    jobs: await tx.jobRun.findMany({ select: { name: true, lastSuccessAt: true, lastStatus: true, consecutiveFailures: true } }),
    backlog: await tx.notification.count({ where: { status: { in: ["PENDING", "SENDING"] }, createdAt: { lt: new Date(Date.now() - 15 * 60_000) } } }),
    failed24h: await tx.notification.count({ where: { status: "FAILED", updatedAt: { gt: new Date(Date.now() - 86_400_000) } } }),
  }));
  return { dbMs, jobs, backlog, failed24h };
}
