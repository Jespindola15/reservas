import { resolveTenantSlug } from "@/modules/access/authorize";
import { withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";

/**
 * Contexto PÚBLICO de un complejo (visitante sin sesión). El tenant sale del
 * slug de la URL resuelto en el servidor; userId = null.
 */
export async function publicTenantContext(slug: string): Promise<TenantContext> {
  const resolved = await resolveTenantSlug(slug);
  if (!resolved) throw new AppError("TENANT_NOT_FOUND");
  if (resolved.status !== "ACTIVE") throw new AppError("TENANT_SUSPENDED");
  return { tenantId: resolved.id, userId: null };
}

/** Datos públicos del complejo: solo lo necesario para la página de reservas. */
export async function getPublicTenantProfile(slug: string) {
  const ctx = await publicTenantContext(slug);
  return withTenant(ctx, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
      select: {
        slug: true,
        name: true,
        description: true,
        logoUrl: true,
        address: true,
        contactPhone: true,
        timezone: true,
        currency: true,
        bookingRequiresApproval: true,
        maxAdvanceDays: true,
      },
    });
    const courts = await tx.court.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        sport: true,
        description: true,
        allowedDurations: true,
        capacity: true,
        images: { select: { id: true }, orderBy: { sortOrder: "asc" }, take: 1 },
      },
    });
    return { tenant, courts };
  });
}
