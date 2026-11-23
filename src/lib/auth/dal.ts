import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import {
  authorizeTenantAccess,
  type AuthUser,
  type Permission,
  type TenantAccess,
} from "@/modules/access/authorize";

/**
 * Data Access Layer: ÚNICO punto donde se lee la sesión. Toda página, Server
 * Action o Route Handler protegido pasa por aquí. El rol de plataforma y el
 * estado del usuario se leen de la BD en cada solicitud (no se confía en
 * datos cacheados en la cookie).
 */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, platformRole: true, isDisabled: true },
  });
  if (!user || user.isDisabled) return null;
  return { id: user.id, name: user.name, email: user.email, platformRole: user.platformRole };
});

/** Para páginas: redirige al login si no hay sesión. */
export async function requireUserPage(next?: string): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}

/** Para Server Actions / Route Handlers: lanza error tipado. */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("UNAUTHENTICATED");
  return user;
}

export async function requireTenant(slug: string, permission: Permission): Promise<TenantAccess & { user: AuthUser }> {
  const user = await requireUser();
  const access = await authorizeTenantAccess(user, slug, permission);
  return { ...access, user };
}

export async function requireSuperadmin(): Promise<AuthUser> {
  const user = await requireUser();
  if (user.platformRole !== "SUPERADMIN") throw new AppError("FORBIDDEN");
  return user;
}
