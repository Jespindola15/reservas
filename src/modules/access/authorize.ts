import type { MembershipRole, PlatformRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { withTenant, withUser, type TenantContext } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  /** Segundo factor activo (obligatorio para SUPERADMIN). Opcional para no romper usos existentes. */
  twoFactorEnabled?: boolean;
  platformRole: PlatformRole;
};

/** Matriz de permisos por rol dentro de un complejo. */
export const PERMISSIONS = {
  "booking.read": ["OWNER", "ADMIN", "STAFF"],
  "booking.manage": ["OWNER", "ADMIN", "STAFF"],
  "customer.read": ["OWNER", "ADMIN", "STAFF"],
  "block.manage": ["OWNER", "ADMIN"],
  "court.manage": ["OWNER", "ADMIN"],
  "tenant.settings": ["OWNER", "ADMIN"],
  "team.manage": ["OWNER", "ADMIN"],
  "data.export": ["OWNER", "ADMIN"],
} as const satisfies Record<string, readonly MembershipRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export type TenantAccess = {
  ctx: TenantContext;
  role: MembershipRole;
  tenant: { id: string; slug: string; name: string; timezone: string; currency: string };
};

/** Resolución slug -> tenant vía función SECURITY DEFINER (solo id y estado). */
export async function resolveTenantSlug(slug: string): Promise<{ id: string; status: "ACTIVE" | "SUSPENDED" } | null> {
  if (!/^[a-z0-9-]{3,50}$/.test(slug)) return null;
  const rows = await prisma.$queryRaw<{ id: string; status: "ACTIVE" | "SUSPENDED" }[]>`
    SELECT id, status FROM app_resolve_tenant_slug(${slug})
  `;
  return rows[0] ?? null;
}

/**
 * Autoriza a un usuario autenticado sobre un complejo, SIEMPRE en el servidor:
 *  - el tenant se resuelve desde el slug de la URL, nunca desde un tenantId
 *    enviado por el navegador;
 *  - se exige una membresía activa con un rol que tenga el permiso pedido.
 * El superadministrador NO entra implícitamente a los paneles de los
 * complejos: opera desde /admin con contexto de plataforma auditado.
 */
export async function authorizeTenantAccess(
  user: AuthUser,
  slug: string,
  permission: Permission,
): Promise<TenantAccess> {
  const resolved = await resolveTenantSlug(slug);
  if (!resolved) throw new AppError("TENANT_NOT_FOUND");
  if (resolved.status !== "ACTIVE") throw new AppError("TENANT_SUSPENDED");

  const membership = await withUser(user.id, (tx) =>
    tx.membership.findUnique({
      where: { tenantId_userId: { tenantId: resolved.id, userId: user.id } },
      select: { role: true, isActive: true },
    }),
  );
  // Acceso desactivado por el complejo => sin permisos (la membresía se conserva por historial).
  if (!membership || !membership.isActive) throw new AppError("FORBIDDEN");
  const allowed: readonly MembershipRole[] = PERMISSIONS[permission];
  if (!allowed.includes(membership.role)) throw new AppError("FORBIDDEN");

  const ctx: TenantContext = { tenantId: resolved.id, userId: user.id };
  const tenant = await withTenant(ctx, (tx) =>
    tx.tenant.findUniqueOrThrow({
      where: { id: resolved.id },
      select: { id: true, slug: true, name: true, timezone: true, currency: true },
    }),
  );
  return { ctx, role: membership.role, tenant };
}

export function hasPermission(role: MembershipRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly MembershipRole[]).includes(role);
}

/** Complejos a los que el usuario tiene acceso (para el selector del panel). */
export async function listMyTenants(userId: string) {
  const rows = await withUser(userId, (tx) =>
    tx.membership.findMany({
      where: { userId, isActive: true },
      select: { role: true, tenant: { select: { slug: true, name: true, status: true } } },
      orderBy: { createdAt: "asc" },
    }),
  );
  return rows.map((m) => ({ ...m.tenant, role: m.role }));
}
