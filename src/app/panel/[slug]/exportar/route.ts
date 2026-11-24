import { requireTenant } from "@/lib/auth/dal";
import { enforceRateLimit, jsonError } from "@/lib/http";
import { exportBookingsCsv, exportCustomersCsv } from "@/modules/exports/csv";

/**
 * Exportación CSV (permiso data.export: dueño y administrador). Siempre auditada.
 * GET /panel/<slug>/exportar?tipo=reservas&from=YYYY-MM-DD&to=...&status=...&courtId=...
 * GET /panel/<slug>/exportar?tipo=clientes
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const access = await requireTenant(slug, "data.export");
    await enforceRateLimit(`export:${access.user.id}`, { window: 60, max: 6 });
    const sp = new URL(req.url).searchParams;
    const tipo = sp.get("tipo");
    const actor = { type: "USER" as const, userId: access.user.id };
    const pick = (k: string) => sp.get(k) || undefined;
    let csv: string;
    if (tipo === "clientes") {
      csv = await exportCustomersCsv(access.ctx, actor);
    } else {
      csv = await exportBookingsCsv(access.ctx, access.tenant.timezone, { status: pick("status") as never, courtId: pick("courtId"), from: pick("from"), to: pick("to") }, actor);
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `turnup-${access.tenant.slug}-${tipo === "clientes" ? "clientes" : "reservas"}-${stamp}.csv`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return jsonError(e, { route: "panel.export" });
  }
}
