import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { withPlatformAdmin } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";
import type { AuthUser } from "@/modules/access/authorize";
import { assertSuperadmin } from "./plans";

/**
 * Administración de COMPLEJOS por el superadministrador (listado con filtros, ficha, archivo,
 * cambio de dueño y extensión de prueba). Suspender/reactivar está en service.ts (setTenantStatus).
 * Nada se borra en cascada: "eliminar" un complejo es ARCHIVARLO (oculto, sin reservas nuevas,
 * datos y fotos conservados).
 */

export const TENANT_STATES = ["todos", "activo", "suspendido", "archivado", "prueba", "vencido"] as const;
const PAGE = 20;

export async function listTenantsAdmin(user: AuthUser, f: { q?: string; estado?: string; page?: string; orden?: string }, now: Date = new Date()) {
  assertSuperadmin(user);
  const estado = (TENANT_STATES as readonly string[]).includes(f.estado ?? "") ? f.estado! : "todos";
  const page = Math.max(1, Math.min(1000, Number(f.page) || 1));
  const q = f.q?.trim().slice(0, 80);
  const live = { status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] as ("TRIAL" | "ACTIVE" | "PAST_DUE")[] } };
  const stateWhere: Prisma.TenantWhereInput =
    estado === "activo" ? { status: "ACTIVE", archivedAt: null }
    : estado === "suspendido" ? { status: "SUSPENDED", archivedAt: null }
    : estado === "archivado" ? { archivedAt: { not: null } }
    : estado === "prueba" ? { archivedAt: null, subscriptions: { some: { status: "TRIAL", currentPeriodEnd: { gt: now } } } }
    : estado === "vencido" ? { archivedAt: null, subscriptions: { none: { ...live, currentPeriodEnd: { gt: now } } } }
    : {};
  const where: Prisma.TenantWhereInput = {
    AND: [stateWhere, q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q.toLowerCase() } }, { city: { contains: q, mode: "insensitive" } }] } : {}],
  };
  const orderBy: Prisma.TenantOrderByWithRelationInput = f.orden === "nombre" ? { name: "asc" } : f.orden === "antiguos" ? { createdAt: "asc" } : { createdAt: "desc" };
  return withPlatformAdmin(user.id, async (tx) => {
    const [total, rows] = await Promise.all([
      tx.tenant.count({ where }),
      tx.tenant.findMany({
        where, orderBy, skip: (page - 1) * PAGE, take: PAGE,
        select: {
          id: true, slug: true, name: true, city: true, status: true, archivedAt: true, suspendedReason: true, createdAt: true,
          _count: { select: { courts: true, bookings: true } },
          subscriptions: { orderBy: { currentPeriodEnd: "desc" }, take: 1, select: { status: true, currentPeriodEnd: true, plan: { select: { name: true } } } },
          memberships: { where: { role: "OWNER", isActive: true }, select: { user: { select: { name: true, email: true } } } },
        },
      }),
    ]);
    return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE)), estado, q: q ?? "" };
  });
}

export async function getTenantAdmin(user: AuthUser, tenantId: string, now: Date = new Date()) {
  assertSuperadmin(user);
  parseOrThrow(z.uuid(), tenantId);
  return withPlatformAdmin(user.id, async (tx) => {
    const t = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true, slug: true, name: true, city: true, province: true, address: true, contactPhone: true, contactEmail: true, status: true, suspendedReason: true,
        archivedAt: true, createdAt: true, depositType: true, publicListed: true,
        courts: { select: { id: true, name: true, sport: true, isActive: true }, orderBy: { sortOrder: "asc" } },
        memberships: { select: { id: true, role: true, isActive: true, user: { select: { id: true, name: true, email: true, isDisabled: true } } }, orderBy: { createdAt: "asc" } },
        subscriptions: { orderBy: { currentPeriodEnd: "desc" }, take: 5, select: { id: true, status: true, currentPeriodStart: true, currentPeriodEnd: true, plan: { select: { id: true, name: true } } } },
        paymentSettings: { select: { updatedAt: true } },
      },
    });
    if (!t) throw new AppError("TENANT_NOT_FOUND");
    const since = new Date(now.getTime() - 30 * 86_400_000);
    const [bookings30, upcoming, pendingTransfers, openIncidents] = await Promise.all([
      tx.booking.count({ where: { tenantId, createdAt: { gte: since } } }),
      tx.booking.count({ where: { tenantId, startsAt: { gt: now }, status: { in: ["PENDING", "CONFIRMED"] } } }),
      tx.booking.count({ where: { tenantId, status: "PENDING", paymentStatus: { in: ["AWAITING_TRANSFER", "TRANSFER_REPORTED"] } } }),
      tx.paymentIncident.count({ where: { tenantId, status: "OPEN" } }),
    ]);
    return { tenant: t, stats: { bookings30, upcoming, pendingTransfers, openIncidents } };
  });
}

const basicsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().max(160).optional().transform((v) => v || null),
  city: z.string().trim().max(80).optional().transform((v) => v || null),
  province: z.string().trim().max(80).optional().transform((v) => v || null),
  contactPhone: z.string().trim().max(30).regex(/^[0-9+()\s.-]*$/, "Teléfono inválido").optional().transform((v) => v || null),
  contactEmail: z.union([z.literal(""), z.email().max(254)]).optional().transform((v) => v || null),
});

/** Edición de los datos básicos del complejo (el slug no cambia: rompería enlaces ya compartidos). */
export async function updateTenantBasics(user: AuthUser, tenantId: string, input: z.input<typeof basicsSchema>) {
  const actor = assertSuperadmin(user);
  parseOrThrow(z.uuid(), tenantId);
  const d = parseOrThrow(basicsSchema, input);
  return withPlatformAdmin(user.id, async (tx) => {
    const res = await tx.tenant.updateMany({ where: { id: tenantId }, data: d });
    if (res.count !== 1) throw new AppError("TENANT_NOT_FOUND");
    await audit(tx, { tenantId, actor, action: "platform.tenant.updated", entityType: "tenant", entityId: tenantId, metadata: { fields: Object.keys(d) } });
  });
}

/**
 * Archivar (baja lógica). Solo un complejo ya SUSPENDIDO, escribiendo su slug para confirmar.
 * Queda oculto y sin reservas nuevas; reservas, pagos, fotos y auditoría se conservan.
 */
export async function archiveTenant(user: AuthUser, tenantId: string, confirmSlug: string, now: Date = new Date()) {
  const actor = assertSuperadmin(user);
  parseOrThrow(z.uuid(), tenantId);
  return withPlatformAdmin(user.id, async (tx) => {
    const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { slug: true, status: true, archivedAt: true } });
    if (!t) throw new AppError("TENANT_NOT_FOUND");
    if (t.archivedAt) throw new AppError("ALREADY_PROCESSED");
    if (t.status !== "SUSPENDED") throw new AppError("INVALID_TRANSITION", { reason: "suspend_first" });
    if (confirmSlug.trim().toLowerCase() !== t.slug) throw new AppError("VALIDATION_ERROR", { fields: ["confirmSlug"] });
    const future = await tx.booking.count({ where: { tenantId, startsAt: { gt: now }, status: { in: ["PENDING", "CONFIRMED"] } } });
    await tx.tenant.update({ where: { id: tenantId }, data: { archivedAt: now, publicListed: false } });
    await audit(tx, { tenantId, actor, action: "platform.tenant.archived", entityType: "tenant", entityId: tenantId, metadata: { futureBookings: future } });
    return { futureBookings: future };
  });
}

export async function unarchiveTenant(user: AuthUser, tenantId: string) {
  const actor = assertSuperadmin(user);
  parseOrThrow(z.uuid(), tenantId);
  return withPlatformAdmin(user.id, async (tx) => {
    const res = await tx.tenant.updateMany({ where: { id: tenantId, archivedAt: { not: null } }, data: { archivedAt: null } });
    if (res.count !== 1) throw new AppError("ALREADY_PROCESSED");
    await audit(tx, { tenantId, actor, action: "platform.tenant.unarchived", entityType: "tenant", entityId: tenantId });
  });
}

/** Extiende la prueba vigente N días (1–90). No crea pruebas nuevas ni toca planes pagos. */
export async function extendTrial(user: AuthUser, tenantId: string, days: number, now: Date = new Date()) {
  const actor = assertSuperadmin(user);
  parseOrThrow(z.uuid(), tenantId);
  const d = parseOrThrow(z.coerce.number().int().min(1).max(90), days);
  return withPlatformAdmin(user.id, async (tx) => {
    const sub = await tx.subscription.findFirst({ where: { tenantId, status: "TRIAL" }, orderBy: { currentPeriodEnd: "desc" }, select: { id: true, currentPeriodEnd: true } });
    if (!sub) throw new AppError("NOT_FOUND", { reason: "no_trial" });
    const base = sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
    const end = new Date(base.getTime() + d * 86_400_000);
    await tx.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: end } });
    await audit(tx, { tenantId, actor, action: "platform.subscription.trial_extended", entityType: "subscription", entityId: sub.id, metadata: { days: d, newEnd: end.toISOString() } });
    return end;
  });
}

/**
 * Cambio de dueño: el nuevo dueño debe tener ya una cuenta (no se crean contraseñas acá). Los dueños
 * anteriores pasan a ADMINISTRADOR (no pierden acceso de golpe; se puede quitar después desde Equipo).
 */
export async function changeTenantOwner(user: AuthUser, tenantId: string, email: string) {
  const actor = assertSuperadmin(user);
  parseOrThrow(z.uuid(), tenantId);
  const mail = parseOrThrow(z.email().max(254), email.trim().toLowerCase());
  return withPlatformAdmin(user.id, async (tx) => {
    const target = await tx.user.findUnique({ where: { email: mail }, select: { id: true, isDisabled: true, anonymizedAt: true } });
    if (!target || target.anonymizedAt) throw new AppError("NOT_FOUND", { reason: "user" });
    if (target.isDisabled) throw new AppError("FORBIDDEN", { reason: "suspended" });
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new AppError("TENANT_NOT_FOUND");
    const previous = await tx.membership.findMany({ where: { tenantId, role: "OWNER", isActive: true, userId: { not: target.id } }, select: { id: true, userId: true } });
    await tx.membership.upsert({
      where: { tenantId_userId: { tenantId, userId: target.id } },
      create: { tenantId, userId: target.id, role: "OWNER", isActive: true },
      update: { role: "OWNER", isActive: true },
    });
    if (previous.length) await tx.membership.updateMany({ where: { id: { in: previous.map((p) => p.id) } }, data: { role: "ADMIN" } });
    await audit(tx, {
      tenantId, actor, action: "platform.tenant.owner_changed", entityType: "tenant", entityId: tenantId,
      metadata: { newOwnerUserId: target.id, previousOwnerUserIds: previous.map((p) => p.userId) },
    });
  });
}
