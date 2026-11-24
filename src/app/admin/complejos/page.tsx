import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import ui from "@/components/ui.module.css";
import { requireSuperadminPage } from "@/lib/auth/dal";
import { listTenantsAdmin } from "@/modules/platform/tenants";
import { SignOutButton } from "../../panel/SignOutButton";
import { AdminNav } from "../AdminNav";

export const metadata: Metadata = { title: "Complejos · Superadministrador" };
const SUB: Record<string, string> = { TRIAL: "Prueba", ACTIVE: "Activa", PAST_DUE: "Vencida (gracia)", SUSPENDED: "Suspendida", CANCELLED: "Cancelada" };
const day = (d: Date) => d.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });

export default async function TenantsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireSuperadminPage("/admin/complejos");
  const sp = await searchParams;
  const now = new Date();
  const data = await listTenantsAdmin(user, sp, now);
  const href = (p: number) => `?${new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][]).toString()}`;
  return (
    <>
      <TopBar><SignOutButton /></TopBar>
      <main className={`${ui.container} ${ui.page} ${ui.stack}`}>
        <div className={ui.spread}><h1>Complejos</h1><AdminNav current="/admin/complejos" /></div>
        <form method="get" className={ui.grid3} aria-label="Filtros">
          <label className={ui.field}><span className={ui.label}>Buscar</span><input className={ui.input} name="q" defaultValue={data.q} placeholder="Nombre, slug o ciudad" maxLength={80} /></label>
          <label className={ui.field}><span className={ui.label}>Estado</span>
            <select className={ui.select} name="estado" defaultValue={data.estado}>
              <option value="todos">Todos</option><option value="activo">Activos</option><option value="suspendido">Suspendidos</option>
              <option value="archivado">Archivados</option><option value="prueba">En prueba</option><option value="vencido">Sin suscripción vigente</option>
            </select>
          </label>
          <label className={ui.field}><span className={ui.label}>Orden</span>
            <select className={ui.select} name="orden" defaultValue={sp.orden ?? "recientes"}>
              <option value="recientes">Más recientes</option><option value="antiguos">Más antiguos</option><option value="nombre">Nombre</option>
            </select>
          </label>
          <div className={ui.row} style={{ alignSelf: "end" }}><button className={ui.button} type="submit">Filtrar</button><Link className={`${ui.button} ${ui.buttonGhost}`} href="/admin/complejos">Limpiar</Link></div>
        </form>
        <p className={ui.faint} style={{ margin: 0 }}>{data.total} complejo(s)</p>
        {data.rows.length === 0 ? <p className={ui.empty}>No hay complejos con esos filtros.</p> : (
          <div className={ui.tableWrap}>
            <table className={`${ui.table} ${ui.tableResponsive}`}>
              <thead><tr><th>Complejo</th><th>Dueño</th><th>Estado</th><th>Suscripción</th><th>Canchas / reservas</th></tr></thead>
              <tbody>
                {data.rows.map((t) => {
                  const sub = t.subscriptions[0];
                  return (
                    <tr key={t.id}>
                      <td data-label="Complejo"><Link href={`/admin/complejos/${t.id}`}>{t.name}</Link><div className={ui.faint}>/{t.slug}{t.city ? ` · ${t.city}` : ""} · alta {day(t.createdAt)}</div></td>
                      <td data-label="Dueño">{t.memberships.map((m) => m.user.name).join(", ") || <span className={ui.faint}>Sin dueño</span>}</td>
                      <td data-label="Estado">
                        <span className={`${ui.badge} ${t.archivedAt ? "" : t.status === "ACTIVE" ? ui.badgeCONFIRMED : ui.badgePENDING}`}>{t.archivedAt ? "Archivado" : t.status === "ACTIVE" ? "Activo" : "Suspendido"}</span>
                        {t.suspendedReason && t.status !== "ACTIVE" ? <div className={ui.faint}>{t.suspendedReason}</div> : null}
                      </td>
                      <td data-label="Suscripción">{sub ? <>{sub.plan.name} · {SUB[sub.status] ?? sub.status}<div className={sub.currentPeriodEnd < now ? ui.textDanger : ui.faint}>vence {day(sub.currentPeriodEnd)}</div></> : <span className={ui.faint}>Sin registrar</span>}</td>
                      <td data-label="Canchas / reservas">{t._count.courts} / {t._count.bookings}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data.pages > 1 ? (
          <nav className={ui.row} aria-label="Páginas">
            {data.page > 1 ? <Link className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} href={href(data.page - 1)}>Anterior</Link> : null}
            <span className={ui.faint}>Página {data.page} de {data.pages}</span>
            {data.page < data.pages ? <Link className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} href={href(data.page + 1)}>Siguiente</Link> : null}
          </nav>
        ) : null}
      </main>
    </>
  );
}
