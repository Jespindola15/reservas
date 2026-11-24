import { withPlayer } from "@/lib/db/tenant-context";
import { publicTenantContext } from "@/modules/tenant/public";

/** Favoritos del jugador (RLS: solo los propios). Solo complejos activos. */
export async function listFavoriteTenantIds(userId: string): Promise<string[]> {
  const rows = await withPlayer(userId, (tx) => tx.playerFavorite.findMany({ where: { userId }, select: { tenantId: true }, orderBy: { createdAt: "desc" } }));
  return rows.map((r) => r.tenantId);
}

export async function toggleFavorite(userId: string, slug: string): Promise<boolean> {
  const { tenantId } = await publicTenantContext(slug);
  return withPlayer(userId, async (tx) => {
    const del = await tx.playerFavorite.deleteMany({ where: { userId, tenantId } });
    if (del.count > 0) return false;
    if ((await tx.playerFavorite.count({ where: { userId } })) >= 100) return false;
    await tx.playerFavorite.create({ data: { userId, tenantId } });
    return true;
  });
}
