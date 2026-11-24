import { z } from "zod";
import type { SubscriptionStatus } from "@/generated/prisma/client";
import { audit, type Actor } from "@/lib/audit";
import { isUniqueViolation } from "@/lib/db/errors";
import { withPlatformAdmin, type Tx } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";
import type { AuthUser } from "@/modules/access/authorize";

/**
 * Planes comerciales y límites. Sin cobros: la suscripción es un registro administrativo
 * que carga el superadmin (Mercado Pago queda para la Fase 4).
 */

export const LIVE_SUBSCRIPTION: SubscriptionStatus[] = ["TRIAL", "ACTIVE", "PAST_DUE"];
/** Tope técnico cuando el complejo no tiene plan con límite. */
export const HARD_MAX_COURTS = 50;

export type PlanLimits = { planName: string | null; maxCourts: number | null; maxMembers: number | null };

/** Límites vigentes del complejo (la suscripción viva más reciente). Sin suscripción: sin límite comercial. */
export async function activePlanLimits(tx: Tx, tenantId: string): Promise<PlanLimits> {
  const sub = await tx.subscription.findFirst({
    where: { tenantId, status: { in: LIVE_SUBSCRIPTION } },
    orderBy: { currentPeriodEnd: "desc" },
    select: { plan: { select: { name: true, maxCourts: true, maxMembers: true } } },
  });
  return { planName: sub?.plan.name ?? null, maxCourts: sub?.plan.maxCourts ?? null, maxMembers: sub?.plan.maxMembers ?? null };
}

function assertSuperadmin(user: AuthUser): Actor {
  if (user.platformRole !== "SUPERADMIN") throw new AppError("FORBIDDEN");
  return { type: "PLATFORM_ADMIN", userId: user.id };
}

const optionalLimit = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().int().min(1).max(10_000).nullable());

export const planSchema = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,30}$/, "Código: minúsculas, números y guiones"),
  name: z.string().trim().min(2).max(60),
  priceAmount: z.coerce.number().int().min(0).max(100_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/).default("ARS"),
  maxCourts: optionalLimit,
  maxMembers: optionalLimit,
  description: z.string().trim().max(300).optional().transform((v) => v || null),
  isActive: z.boolean().default(true),
});

export async function listPlans(user: AuthUser) {
  assertSuperadmin(user);
  return withPlatformAdmin(user.id, (tx) =>
    tx.plan.findMany({ orderBy: [{ isActive: "desc" }, { priceAmount: "asc" }], include: { _count: { select: { subscriptions: true } } } }),
  );
}

export async function savePlan(user: AuthUser, planId: string | null, input: z.input<typeof planSchema>) {
  const actor = assertSuperadmin(user);
  const data = parseOrThrow(planSchema, input);
  if (planId) parseOrThrow(z.uuid(), planId);
  try {
    return await withPlatformAdmin(user.id, async (tx) => {
      const plan = planId
        ? await tx.plan.update({ where: { id: planId }, data, select: { id: true, code: true } })
        : await tx.plan.create({ data, select: { id: true, code: true } });
      await audit(tx, { tenantId: null, actor, action: planId ? "platform.plan.updated" : "platform.plan.created", entityType: "plan", entityId: plan.id, metadata: { ...data } });
      return plan;
    });
  } catch (e) {
    if (isUniqueViolation(e, "plans_code_key")) throw new AppError("VALIDATION_ERROR", { field: "code", reason: "taken" });
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2025") throw new AppError("NOT_FOUND");
    throw e;
  }
}

export const subscriptionSchema = z
  .object({
    tenantId: z.uuid(),
    planId: z.uuid(),
    status: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"]),
    currentPeriodStart: z.coerce.date(),
    currentPeriodEnd: z.coerce.date(),
    notes: z.string().trim().max(300).optional().transform((v) => v || null),
  })
  .refine((v) => v.currentPeriodEnd > v.currentPeriodStart, { message: "El período debe terminar después de empezar", path: ["currentPeriodEnd"] });

/**
 * Asigna un plan a un complejo. Las suscripciones vivas anteriores pasan a CANCELLED (se conservan
 * como historial). No reduce recursos existentes: si el complejo ya supera el nuevo límite, solo
 * impide crear más (y se devuelve una advertencia).
 */
export async function assignSubscription(user: AuthUser, input: z.input<typeof subscriptionSchema>) {
  const actor = assertSuperadmin(user);
  const data = parseOrThrow(subscriptionSchema, input);
  return withPlatformAdmin(user.id, async (tx) => {
    const plan = await tx.plan.findUnique({ where: { id: data.planId }, select: { id: true, name: true, maxCourts: true, maxMembers: true } });
    const tenant = await tx.tenant.findUnique({ where: { id: data.tenantId }, select: { id: true } });
    if (!plan || !tenant) throw new AppError("NOT_FOUND");
    await tx.subscription.updateMany({ where: { tenantId: data.tenantId, status: { in: LIVE_SUBSCRIPTION } }, data: { status: "CANCELLED" } });
    const sub = await tx.subscription.create({ data, select: { id: true } });
    const courts = await tx.court.count({ where: { tenantId: data.tenantId } });
    const members = await tx.membership.count({ where: { tenantId: data.tenantId, isActive: true, role: { not: "OWNER" } } });
    const warnings: string[] = [];
    if (plan.maxCourts !== null && courts > plan.maxCourts) warnings.push(`tiene ${courts} canchas y el plan permite ${plan.maxCourts}`);
    if (plan.maxMembers !== null && members > plan.maxMembers) warnings.push(`tiene ${members} miembros y el plan permite ${plan.maxMembers}`);
    await audit(tx, {
      tenantId: data.tenantId,
      actor,
      action: "platform.subscription.assigned",
      entityType: "subscription",
      entityId: sub.id,
      metadata: { planId: plan.id, plan: plan.name, status: data.status, periodEnd: data.currentPeriodEnd.toISOString(), warnings },
    });
    return { id: sub.id, warnings };
  });
}

// ------------------------------------------------------------------ Auditoría

export const auditFilterSchema = z.object({
  tenantId: z.union([z.literal(""), z.uuid()]).optional().transform((v) => v || undefined),
  action: z.string().trim().max(80).regex(/^[a-z0-9._-]*$/i).optional().transform((v) => v || undefined),
  actorType: z.enum(["", "USER", "PLATFORM_ADMIN", "PUBLIC", "SYSTEM"]).optional().transform((v) => v || undefined),
  from: z.union([z.literal(""), z.iso.date()]).optional().transform((v) => v || undefined),
  to: z.union([z.literal(""), z.iso.date()]).optional().transform((v) => v || undefined),
  before: z.union([z.literal(""), z.iso.datetime()]).optional().transform((v) => v || undefined),
});

export const AUDIT_PAGE_SIZE = 50;

/** Visor de auditoría (solo lectura, paginado por fecha). Filtros validados; nunca SQL armado a mano. */
export async function listAuditLogs(user: AuthUser, input: Record<string, string | undefined>) {
  assertSuperadmin(user);
  const f = parseOrThrow(auditFilterSchema, input);
  return withPlatformAdmin(user.id, async (tx) => {
    const createdAt: { gte?: Date; lt?: Date } = {};
    if (f.from) createdAt.gte = new Date(`${f.from}T00:00:00Z`);
    if (f.to) createdAt.lt = new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000);
    if (f.before) createdAt.lt = createdAt.lt && createdAt.lt < new Date(f.before) ? createdAt.lt : new Date(f.before);
    const rows = await tx.auditLog.findMany({
      where: {
        tenantId: f.tenantId,
        action: f.action ? { startsWith: f.action } : undefined,
        actorType: f.actorType,
        createdAt: Object.keys(createdAt).length ? createdAt : undefined,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: AUDIT_PAGE_SIZE + 1,
      select: { id: true, createdAt: true, action: true, actorType: true, actorUserId: true, entityType: true, entityId: true, metadata: true, tenant: { select: { slug: true } } },
    });
    const hasMore = rows.length > AUDIT_PAGE_SIZE;
    const page = rows.slice(0, AUDIT_PAGE_SIZE);
    const actorIds = [...new Set(page.map((r) => r.actorUserId).filter((x): x is string => Boolean(x)))];
    const actors = actorIds.length ? await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } }) : [];
    const emailOf = new Map(actors.map((a) => [a.id, a.email]));
    return {
      rows: page.map((r) => ({ ...r, actorEmail: r.actorUserId ? (emailOf.get(r.actorUserId) ?? null) : null })),
      nextBefore: hasMore ? page[page.length - 1]!.createdAt.toISOString() : null,
    };
  });
}
