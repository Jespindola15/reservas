import type { Metadata } from "next";
import { fmtDate } from "@/lib/format";
import Link from "next/link";
import { FilterBar } from "@/components/FilterBar";
import ui from "@/components/ui.module.css";
import { requireSuperadminPage } from "@/lib/auth/dal";
import { ActionForm } from "@/components/ActionForm";
import { EditPanel } from "@/components/EditPanel";
import { listTenantsAdmin } from "@/modules/platform/tenants";
import { listTenantsForPlatform } from "@/modules/platform/service";
import { assignAdminAction, createTenantAction } from "../actions";

export const metadata: Metadata = { title: "Complejos · Superadministrador" };
const SUB: Record<string, string> = { TRIAL: "Prueba", ACTIVE: "Activa", PAST_DUE: "Vencida (gracia)", SUSPENDED: "Suspendida", CANCELLED: "Cancelada" };
const day = (d: Date) => fmtDate(d);

export default async function TenantsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireSuperadminPage("/admin/complejos");
  const sp = await searchParams;
  const now = new Date();
  const data = await listTenantsAdmin(user, sp, now);
  const tenants = await listTenantsForPlatform(user);
  const href = (p: number) => `?${new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][]).toString()}`;
  return (
    <>
      <div className={ui.stack}>
        <header className={ui.pageHeader}><div><p className={ui.eyebrow}>Plataforma</p><h1>Complejos</h1></div>
          <div className={ui.row}>
            <EditPanel label="Asignar administrador" title="Asignar administrador a un complejo" description="Si el email no tiene cuenta, se crea con la contraseña inicial indicada.">
              <ActionForm action={assignAdminAction} submitLabel="Asignar" className={ui.stack}>
              <label className={ui.field}><span className={ui.label}>Complejo</span>
                <select className={ui.select} name="tenantId" required>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label className={ui.field}><span className={ui.label}>Nombre</span><input className={ui.input} name="name" required minLength={2} /></label>
              <label className={ui.field}><span className={ui.label}>Email</span><input className={ui.input} name="email" type="email" required /></label>
              <label className={ui.field}><span className={ui.label}>Rol</span>
                <select className={ui.select} name="role" defaultValue="OWNER">
                  <option value="OWNER">Dueño</option><option value="ADMIN">Administrador</option><option value="STAFF">Personal</option>
                </select>
              </label>
              <label className={ui.field}><span className={ui.label}>Contraseña inicial (solo usuarios nuevos, mín. 12)</span><input className={ui.input} name="initialPassword" type="password" minLength={12} autoComplete="new-password" /></label>
            </ActionForm>
            </EditPanel>
            <EditPanel label="Nuevo complejo" title="Nuevo complejo" variant="primary" hash="nuevo" description="Después podés asignarle dueño, plan y datos de contacto.">
              <ActionForm action={createTenantAction} submitLabel="Crear complejo" className={ui.stack}>
              <label className={ui.field}><span className={ui.label}>Nombre</span><input className={ui.input} name="name" required minLength={2} maxLength={100} /></label>
              <label className={ui.field}><span className={ui.label}>Slug (URL)</span><input className={ui.input} name="slug" required pattern="[a-z0-9][a-z0-9-]{1,48}[a-z0-9]" placeholder="padel-centro" /></label>
              <label className={ui.field}><span className={ui.label}>Zona horaria</span><input className={ui.input} name="timezone" defaultValue="America/Argentina/Buenos_Aires" /></label>
            </ActionForm>
            </EditPanel>
          </div>
        </header>
        <FilterBar label="Buscar complejos" search={{ name: "q", placeholder: "Nombre, slug o ciudad", defaultValue: data.q }} active={data.estado !== "todos" || Boolean(sp.orden && sp.orden !== "recientes")} clearHref="/admin/complejos">
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
        </FilterBar>
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
      </div>
    </>
  );
}
