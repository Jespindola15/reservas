import { getCurrentUser } from "@/lib/auth/dal";
import { AppError } from "@/lib/errors";
import { jsonError, jsonOk } from "@/lib/http";
import { authorizeTenantAccess } from "@/modules/access/authorize";
import { panelBadges } from "@/modules/inbox/service";

/**
 * Contadores del panel (avisos sin leer, transferencias informadas e incidencias abiertas).
 * Lo consulta el panel abierto cada minuto, solo con la pestaña visible: son tres COUNT
 * indexados en una única transacción, sin datos personales en la respuesta.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const user = await getCurrentUser();
    if (!user) throw new AppError("UNAUTHENTICATED");
    const access = await authorizeTenantAccess(user, slug, "booking.read");
    const res = jsonOk(await panelBadges(access.ctx));
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (e) {
    return jsonError(e, { route: "panel.badges" });
  }
}
