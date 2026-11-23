import "server-only";
import { redirect } from "next/navigation";
import { requireUserPage } from "@/lib/auth/dal";
import { isAppError } from "@/lib/errors";
import { authorizeTenantAccess, type Permission } from "@/modules/access/authorize";

/**
 * Autorización para PÁGINAS del panel. Devuelve null si el usuario no tiene el
 * permiso (la página responde 404 para no revelar qué existe).
 */
export async function requireTenantPage(slug: string, permission: Permission) {
  const user = await requireUserPage(`/panel/${slug}`);
  try {
    const access = await authorizeTenantAccess(user, slug, permission);
    return { ...access, user };
  } catch (e) {
    if (isAppError(e) && e.code === "TENANT_SUSPENDED") redirect("/panel?suspended=1");
    if (isAppError(e) && (e.code === "FORBIDDEN" || e.code === "TENANT_NOT_FOUND")) return null;
    throw e;
  }
}
