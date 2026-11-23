import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import type { MembershipRole, TenantStatus } from "@/generated/prisma/client";
import { audit, type Actor } from "@/lib/audit";
import { isUniqueViolation } from "@/lib/db/errors";
import { withPlatformAdmin } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";
import { isValidTimeZone } from "@/modules/booking/time";
import type { AuthUser } from "@/modules/access/authorize";

/**
 * Operaciones del SUPERADMINISTRADOR. Cada función:
 *  1. verifica en el servidor que el actor tenga platformRole = SUPERADMIN;
 *  2. corre con contexto de plataforma (RLS lo permite explícitamente);
 *  3. deja registro en audit_logs con actorType = PLATFORM_ADMIN.
 */

export const RESERVED_SLUGS = new Set([
  "admin", "panel", "login", "logout", "api", "auth", "app", "www", "static", "assets",
  "public", "registro", "signup", "ayuda", "soporte", "precios", "terminos", "privacidad",
  "favicon.ico", "robots.txt", "sitemap.xml", "_next",
]);

function assertSuperadmin(user: AuthUser): Actor {
  if (user.platformRole !== "SUPERADMIN") throw new AppError("FORBIDDEN");
  return { type: "PLATFORM_ADMIN", userId: user.id };
}

export const createTenantSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$/, "Slug: 3-50 caracteres, minúsculas, números y guiones"),
  name: z.string().trim().min(2).max(100),
  timezone: z.string().refine(isValidTimeZone, "Zona horaria inválida").default("America/Argentina/Buenos_Aires"),
  currency: z.string().regex(/^[A-Z]{3}$/).default("ARS"),
});

export async function createTenant(user: AuthUser, input: z.input<typeof createTenantSchema>) {
  const actor = assertSuperadmin(user);
  const data = parseOrThrow(createTenantSchema, input);
  if (RESERVED_SLUGS.has(data.slug)) throw new AppError("VALIDATION_ERROR", { field: "slug", reason: "reserved" });
  try {
    return await withPlatformAdmin(user.id, async (tx) => {
      const tenant = await tx.tenant.create({ data, select: { id: true, slug: true, name: true } });
      await audit(tx, {
        tenantId: tenant.id,
        actor,
        action: "platform.tenant.created",
        entityType: "tenant",
        entityId: tenant.id,
        metadata: { slug: tenant.slug },
      });
      return tenant;
    });
  } catch (e) {
    if (isUniqueViolation(e, "tenants_slug_key")) {
      throw new AppError("VALIDATION_ERROR", { field: "slug", reason: "taken" });
    }
    throw e;
  }
}

export const assignAdminSchema = z.object({
  tenantId: z.uuid(),
  email: z.email().max(254).transform((e) => e.trim().toLowerCase()),
  name: z.string().trim().min(2).max(100),
  role: z.enum(["OWNER", "ADMIN", "STAFF"]),
  /** Solo si el usuario no existe. Mínimo 12 caracteres. */
  initialPassword: z.string().min(12).max(128).optional(),
});

/** Crea (si hace falta) el usuario y le da acceso al complejo. */
export async function assignTenantAdmin(user: AuthUser, input: z.input<typeof assignAdminSchema>) {
  const actor = assertSuperadmin(user);
  const data = parseOrThrow(assignAdminSchema, input);
  const passwordHash = data.initialPassword ? await hashPassword(data.initialPassword) : null;

  return withPlatformAdmin(user.id, async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: data.tenantId }, select: { id: true } });
    if (!tenant) throw new AppError("TENANT_NOT_FOUND");

    let target = await tx.user.findUnique({ where: { email: data.email }, select: { id: true } });
    let created = false;
    if (!target) {
      if (!passwordHash) throw new AppError("VALIDATION_ERROR", { field: "initialPassword", reason: "required" });
      target = await tx.user.create({ data: { email: data.email, name: data.name }, select: { id: true } });
      await tx.account.create({
        data: { userId: target.id, accountId: target.id, providerId: "credential", password: passwordHash },
      });
      created = true;
    }

    const membership = await tx.membership.upsert({
      where: { tenantId_userId: { tenantId: tenant.id, userId: target.id } },
      create: { tenantId: tenant.id, userId: target.id, role: data.role as MembershipRole },
      update: { role: data.role as MembershipRole },
      select: { id: true, role: true },
    });

    await audit(tx, {
      tenantId: tenant.id,
      actor,
      action: "platform.membership.assigned",
      entityType: "membership",
      entityId: membership.id,
      metadata: { targetUserId: target.id, role: membership.role, userCreated: created },
    });
    return { userId: target.id, membershipId: membership.id, created };
  });
}

export async function setTenantStatus(user: AuthUser, tenantId: string, status: TenantStatus, reason: string) {
  const actor = assertSuperadmin(user);
  parseOrThrow(z.uuid(), tenantId);
  return withPlatformAdmin(user.id, async (tx) => {
    const res = await tx.tenant.updateMany({ where: { id: tenantId }, data: { status } });
    if (res.count !== 1) throw new AppError("TENANT_NOT_FOUND");
    await audit(tx, {
      tenantId,
      actor,
      action: `platform.tenant.${status === "ACTIVE" ? "activated" : "suspended"}`,
      entityType: "tenant",
      entityId: tenantId,
      metadata: { reason: reason.slice(0, 300) },
    });
  });
}

export async function listTenantsForPlatform(user: AuthUser) {
  assertSuperadmin(user);
  return withPlatformAdmin(user.id, (tx) =>
    tx.tenant.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        createdAt: true,
        _count: { select: { courts: true, bookings: true, memberships: true } },
        subscriptions: {
          orderBy: { currentPeriodEnd: "desc" },
          take: 1,
          select: { status: true, currentPeriodEnd: true, plan: { select: { name: true } } },
        },
      },
    }),
  );
}

export async function platformMetrics(user: AuthUser, now: Date = new Date()) {
  assertSuperadmin(user);
  const since = new Date(now.getTime() - 30 * 86_400_000);
  return withPlatformAdmin(user.id, async (tx) => {
    const [tenants, activeTenants, bookings30d, courts] = await Promise.all([
      tx.tenant.count(),
      tx.tenant.count({ where: { status: "ACTIVE" } }),
      tx.booking.count({ where: { createdAt: { gte: since } } }),
      tx.court.count({ where: { isActive: true } }),
    ]);
    return { tenants, activeTenants, bookings30d, courts };
  });
}
