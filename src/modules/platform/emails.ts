import { z } from "zod";
import { audit } from "@/lib/audit";
import type { AuthUser } from "@/modules/access/authorize";
import { withPlatformAdmin } from "@/lib/db/tenant-context";
import { emailConfigIssues, emailProviderName, getEnv, parseSender } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/http";
import { parseOrThrow } from "@/lib/validation";
import { enqueue } from "@/modules/notifications/outbox";
import { NON_RETRYABLE_KINDS } from "@/modules/notifications/labels";
import { capFor, quotaUsage } from "@/modules/notifications/quota";

function assertSuperadmin(user: AuthUser) {
  if (user.platformRole !== "SUPERADMIN") throw new AppError("FORBIDDEN");
  return { type: "PLATFORM_ADMIN" as const, userId: user.id };
}

export const EMAIL_STATUSES = ["PENDING", "SENDING", "SENT", "FAILED", "SKIPPED"] as const;

const filterSchema = z.object({
  estado: z.enum(EMAIL_STATUSES).optional().catch(undefined),
  tipo: z.string().regex(/^[a-z_0-9]{3,40}$/).optional().catch(undefined),
  complejo: z.uuid().optional().catch(undefined),
  q: z.string().trim().toLowerCase().max(254).optional().catch(undefined),
  pagina: z.coerce.number().int().min(1).max(200).catch(1).default(1),
});

const PAGE = 40;

/** Datos del panel de correos (sin contenido de los emails ni enlaces: solo metadatos). */
export async function emailDashboard(user: AuthUser, raw: Record<string, unknown>, now: Date = new Date()) {
  assertSuperadmin(user);
  const f = filterSchema.parse(raw);
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const usage = await quotaUsage(now);
  const where = {
    ...(f.estado ? { status: f.estado } : {}),
    ...(f.tipo ? { kind: f.tipo } : {}),
    ...(f.complejo ? { tenantId: f.complejo } : {}),
    ...(f.q ? { recipient: { contains: f.q } } : {}),
  };
  return withPlatformAdmin(user.id, async (tx) => {
    const [sentToday, pending, deferred, failed7d, deliveredToday, bouncedToday, rows, total, tenants, kinds] = await Promise.all([
      tx.notification.count({ where: { status: "SENT", sentAt: { gte: dayStart } } }),
      tx.notification.count({ where: { status: { in: ["PENDING", "SENDING"] } } }),
      tx.notification.count({ where: { status: "PENDING", lastError: { startsWith: "quota_exhausted" } } }),
      tx.notification.count({ where: { status: "FAILED", updatedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } } }),
      tx.notification.count({ where: { sentAt: { gte: dayStart }, deliveryStatus: { in: ["delivered", "opened", "clicked"] } } }),
      tx.notification.count({ where: { sentAt: { gte: dayStart }, deliveryStatus: { in: ["hard_bounce", "soft_bounce", "blocked", "invalid", "spam", "error"] } } }),
      tx.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (f.pagina - 1) * PAGE,
        take: PAGE,
        select: {
          id: true, kind: true, recipient: true, status: true, attempts: true, lastError: true, priority: true,
          provider: true, providerMessageId: true, deliveryStatus: true, deliveryUpdatedAt: true, sentAt: true, createdAt: true, nextAttemptAt: true,
          tenant: { select: { id: true, name: true } },
        },
      }),
      tx.notification.count({ where }),
      tx.tenant.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 200 }),
      tx.notification.groupBy({ by: ["kind"], _count: { _all: true }, orderBy: { kind: "asc" } }),
    ]);
    const env = getEnv();
    const sender = parseSender(env.EMAIL_FROM, env.EMAIL_FROM_NAME);
    return {
      filters: f,
      pageSize: PAGE,
      usage: { ...usage, nonCriticalCap: capFor(5, usage.limit) },
      stats: { sentToday, pending, deferred, failed7d, deliveredToday, bouncedToday },
      rows,
      total,
      tenants,
      kinds: kinds.map((k) => k.kind),
      config: {
        provider: emailProviderName(),
        issues: emailConfigIssues(),
        senderEmail: sender?.email ?? null,
        senderIsFreeMail: Boolean(sender && /@(gmail|googlemail|yahoo|hotmail|outlook|live)\./i.test(sender.email)),
        webhook: Boolean(env.BREVO_WEBHOOK_SECRET),
      },
    };
  });
}

/** Reintento manual seguro: vuelve a la cola; al enviarse se revalida que el aviso siga correspondiendo. */
export async function retryEmail(user: AuthUser, id: string) {
  const actor = assertSuperadmin(user);
  parseOrThrow(z.uuid(), id);
  return withPlatformAdmin(user.id, async (tx) => {
    const n = await tx.notification.findUnique({ where: { id }, select: { id: true, kind: true, status: true, tenantId: true } });
    if (!n) throw new AppError("NOT_FOUND");
    if (n.status !== "FAILED" && n.status !== "SKIPPED") throw new AppError("VALIDATION_ERROR", { reason: "not_retryable_status" });
    if (NON_RETRYABLE_KINDS.has(n.kind)) throw new AppError("EMAIL_NOT_RETRYABLE");
    await tx.notification.update({ where: { id }, data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lockedAt: null, lastError: "Reintento manual" } });
    await audit(tx, { tenantId: n.tenantId, actor, action: "platform.email.retried", entityType: "notification", entityId: id, metadata: { kind: n.kind, from: n.status } });
  });
}

/** Direcciones autorizadas para el correo de prueba: la propia del superadmin y EMAIL_TEST_RECIPIENTS. */
export function testRecipients(user: AuthUser): string[] {
  const extra = getEnv().EMAIL_TEST_RECIPIENTS.split(",").map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  return [...new Set([user.email.toLowerCase(), ...extra])].slice(0, 10);
}

/** Encola un correo de prueba (prioridad 1) a una dirección autorizada y lo envía en el momento. */
export async function sendTestEmail(user: AuthUser, recipient: string) {
  const actor = assertSuperadmin(user);
  const to = recipient.trim().toLowerCase();
  if (!testRecipients(user).includes(to)) throw new AppError("EMAIL_RECIPIENT_NOT_ALLOWED");
  await enforceRateLimit(`email-test:${user.id}`, { window: 3600, max: 5 });
  const id = await withPlatformAdmin(user.id, async (tx) => {
    const key = `admin:test:${user.id}:${Date.now()}`;
    await enqueue(tx, { tenantId: null, kind: "admin_test", recipient: to, dedupeKey: key });
    await audit(tx, { tenantId: null, actor, action: "platform.email.test", entityType: "notification", entityId: null, metadata: { toDomain: to.split("@")[1] ?? "" } });
    return (await tx.notification.findUnique({ where: { dedupeKey: key }, select: { id: true } }))?.id ?? null;
  });
  const { processNotifications } = await import("@/modules/notifications/processor");
  await processNotifications({ batchSize: 10 });
  if (!id) return { status: "PENDING" as const, error: null, messageId: null };
  const row = await withPlatformAdmin(user.id, (tx) => tx.notification.findUnique({ where: { id }, select: { status: true, lastError: true, providerMessageId: true } }));
  return { status: row?.status ?? "PENDING", error: row?.lastError ?? null, messageId: row?.providerMessageId ?? null };
}
