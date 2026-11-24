import { z } from "zod";
import { audit } from "@/lib/audit";
import { withPlatformAdmin } from "@/lib/db/tenant-context";
import { emailProviderName } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";
import type { AuthUser } from "@/modules/access/authorize";
import { LIVE_SUBSCRIPTION, assertSuperadmin } from "./plans";

/**
 * Métricas comerciales de la plataforma y cobro MANUAL de suscripciones.
 * TURNUP todavía no cobra online: los pagos se registran a mano. Los campos
 * external_provider/external_id quedan listos para conciliar Mercado Pago más
 * adelante (sin integrarlo ahora).
 */

const DAY = 86_400_000;
export const FREE_DB_LIMIT_BYTES = 512 * 1024 * 1024;

/** MRR registrado: precio mensual de los planes con suscripción ACTIVE o PAST_DUE vigente (no incluye pruebas). */
export function computeMrr(subs: { status: string; currentPeriodEnd: Date; plan: { priceAmount: number } }[], now: Date) {
  return subs.filter((s) => (s.status === "ACTIVE" || s.status === "PAST_DUE") && s.currentPeriodEnd > now).reduce((a, s) => a + s.plan.priceAmount, 0);
}

export async function platformOverview(user: AuthUser, now: Date = new Date()) {
  assertSuperadmin(user);
  const d30 = new Date(now.getTime() - 30 * DAY);
  return withPlatformAdmin(user.id, async (tx) => {
    const byStatus = await tx.tenant.groupBy({ by: ["status"], _count: { _all: true } });
    const subs = await tx.subscription.findMany({
      where: { status: { in: LIVE_SUBSCRIPTION } },
      select: { tenantId: true, status: true, currentPeriodEnd: true, plan: { select: { priceAmount: true } } },
    });
    const courts = await tx.court.count({ where: { isActive: true } });
    const bookings30d = await tx.booking.count({ where: { createdAt: { gte: d30 } } });
    const activeUsers = await tx.session.findMany({ where: { updatedAt: { gte: d30 } }, distinct: ["userId"], select: { userId: true } });
    const collected30d = await tx.subscriptionPayment.aggregate({ where: { paidAt: { gte: d30 } }, _sum: { amount: true } });
    const [size] = await tx.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database())::bigint AS bytes`;
    const jobs = await tx.jobRun.findMany({ select: { name: true, lastSuccessAt: true, lastStatus: true, consecutiveFailures: true } });
    const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    const live = subs.filter((s) => s.currentPeriodEnd > now);
    return {
      tenants: byStatus.reduce((a, b) => a + b._count._all, 0),
      active: count("ACTIVE"),
      suspended: count("SUSPENDED"),
      trial: live.filter((s) => s.status === "TRIAL").length,
      pastDue: live.filter((s) => s.status === "PAST_DUE").length,
      expiringSoon: live.filter((s) => s.currentPeriodEnd.getTime() - now.getTime() < 7 * DAY).length,
      expired: subs.filter((s) => s.currentPeriodEnd <= now).length,
      courts,
      bookings30d,
      activeUsers30d: activeUsers.length,
      mrr: computeMrr(subs, now),
      collected30d: collected30d._sum.amount ?? 0,
      system: {
        dbBytes: Number(size?.bytes ?? 0),
        /** Plan gratuito de Neon: 0,5 GB por proyecto. Avisar desde el 70 %. */
        dbLimitBytes: FREE_DB_LIMIT_BYTES,
        emailProvider: emailProviderName(),
        jobs: jobs.map((j) => ({ ...j, stale: !j.lastSuccessAt || now.getTime() - j.lastSuccessAt.getTime() > 2 * 60 * 60 * 1000 })),
      },
    };
  });
}

/** Actividad por complejo (últimos 30 días) para la tabla del superadmin. */
export async function tenantActivity(user: AuthUser, now: Date = new Date()) {
  assertSuperadmin(user);
  const d30 = new Date(now.getTime() - 30 * DAY);
  return withPlatformAdmin(user.id, async (tx) => {
    const recent = await tx.booking.groupBy({ by: ["tenantId"], where: { createdAt: { gte: d30 } }, _count: { _all: true }, _max: { createdAt: true } });
    const paid = await tx.subscriptionPayment.groupBy({ by: ["tenantId"], _max: { paidAt: true } });
    return {
      bookings30d: new Map(recent.map((r) => [r.tenantId, r._count._all])),
      lastBookingAt: new Map(recent.map((r) => [r.tenantId, r._max.createdAt])),
      lastPaymentAt: new Map(paid.map((p) => [p.tenantId, p._max.paidAt])),
    };
  });
}

export const subscriptionPaymentSchema = z
  .object({
    tenantId: z.uuid(),
    amount: z
      .string()
      .trim()
      .regex(/^\d{1,9}([.,]\d{1,2})?$/, "Importe inválido")
      .transform((v) => Math.round(Number(v.replace(",", ".")) * 100))
      .refine((v) => v > 0 && v <= 100_000_000, "Importe inválido"),
    method: z.enum(["CASH", "TRANSFER", "CARD", "MERCADOPAGO_MANUAL", "OTHER"]),
    paidAt: z.coerce.date(),
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
    note: z.string().trim().max(300).optional().transform((v) => v || null),
    /** Si se marca, la suscripción viva pasa a ACTIVE y su vencimiento se extiende hasta el fin del período pagado. */
    extend: z.boolean().default(true),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { message: "El período pagado debe terminar después de empezar", path: ["periodEnd"] });

/** Registra un pago de suscripción hecho por fuera de TURNUP (efectivo, transferencia, link de MP, etc.). */
export async function recordSubscriptionPayment(user: AuthUser, input: z.input<typeof subscriptionPaymentSchema>) {
  const actor = assertSuperadmin(user);
  const data = parseOrThrow(subscriptionPaymentSchema, input);
  return withPlatformAdmin(user.id, async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: data.tenantId }, select: { id: true } });
    if (!tenant) throw new AppError("NOT_FOUND");
    const sub = await tx.subscription.findFirst({
      where: { tenantId: data.tenantId, status: { in: LIVE_SUBSCRIPTION } },
      orderBy: { currentPeriodEnd: "desc" },
      select: { id: true, currentPeriodEnd: true, plan: { select: { currency: true } } },
    });
    const pay = await tx.subscriptionPayment.create({
      data: {
        tenantId: data.tenantId,
        subscriptionId: sub?.id ?? null,
        amount: data.amount,
        currency: sub?.plan.currency ?? "ARS",
        method: data.method,
        paidAt: data.paidAt,
        periodStart: new Date(`${data.periodStart}T00:00:00Z`),
        periodEnd: new Date(`${data.periodEnd}T00:00:00Z`),
        note: data.note,
        recordedByUserId: user.id,
      },
      select: { id: true },
    });
    let extendedTo: Date | null = null;
    if (sub && data.extend) {
      // Fin del día pagado (23:59:59 UTC−3 ≈ 03:00 UTC del día siguiente): nunca acorta un vencimiento posterior.
      const end = new Date(`${data.periodEnd}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      end.setUTCHours(3);
      extendedTo = end > sub.currentPeriodEnd ? end : sub.currentPeriodEnd;
      await tx.subscription.update({ where: { id: sub.id }, data: { status: "ACTIVE", currentPeriodEnd: extendedTo } });
    }
    await audit(tx, {
      tenantId: data.tenantId,
      actor,
      action: "platform.subscription.payment_recorded",
      entityType: "subscription_payment",
      entityId: pay.id,
      metadata: { amount: data.amount, method: data.method, periodStart: data.periodStart, periodEnd: data.periodEnd, extendedTo: extendedTo?.toISOString() ?? null },
    });
    return { id: pay.id, subscriptionId: sub?.id ?? null, extendedTo };
  });
}

export async function listSubscriptionPayments(user: AuthUser, limit = 30) {
  assertSuperadmin(user);
  return withPlatformAdmin(user.id, (tx) =>
    tx.subscriptionPayment.findMany({
      orderBy: { paidAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
      select: { id: true, amount: true, currency: true, method: true, paidAt: true, periodStart: true, periodEnd: true, note: true, tenant: { select: { name: true, slug: true } } },
    }),
  );
}
