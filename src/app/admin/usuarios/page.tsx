import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import ui from "@/components/ui.module.css";
import { requireSuperadminPage } from "@/lib/auth/dal";
import { listUsers } from "@/modules/platform/users";
import { SignOutButton } from "../../panel/SignOutButton";
import { AdminNav } from "../AdminNav";

export const metadata: Metadata = { title: "Usuarios · Superadministrador" };

const ROLE: Record<string, string> = { OWNER: "Dueño", ADMIN: "Admin", STAFF: "Personal" };
const day = (d: Date) => d.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireSuperadminPage("/admin/usuarios");
  const sp = await searchParams;
  const data = await listUsers(user, sp);
  const href = (p: number) => `?${new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][]).toString()}`;
  return (
    <>
      <TopBar><SignOutButton /></TopBar>
      <main className={`${ui.container} ${ui.page} ${ui.stack}`}>
        <div className={ui.spread}><h1>Usuarios</h1><AdminNav current="/admin/usuarios" /></div>
        <p className={ui.muted} style={{ margin: 0 }}>Jugadores, dueños, administradores y personal. Nunca se muestran contraseñas, sesiones ni secretos.</p>
        <form method="get" className={ui.grid3} aria-label="Filtros">
          <label className={ui.field}><span className={ui.label}>Buscar</span><input className={ui.input} name="q" defaultValue={data.q} placeholder="Nombre o email" maxLength={80} /></label>
          <label className={ui.field}><span className={ui.label}>Tipo</span>
            <select className={ui.select} name="tipo" defaultValue={data.tipo}>
              <option value="todos">Todos</option><option value="jugador">Jugadores</option><option value="dueno">Dueños</option>
              <option value="admin">Administradores</option><option value="personal">Personal</option><option value="superadmin">Superadministradores</option>
            </select>
          </label>
          <label className={ui.field}><span className={ui.label}>Estado</span>
            <select className={ui.select} name="estado" defaultValue={data.estado}>
              <option value="todos">Todos</option><option value="activo">Activos</option><option value="suspendido">Suspendidos</option><option value="anonimizado">Eliminados</option>
            </select>
          </label>
          <label className={ui.field}><span className={ui.label}>Orden</span>
            <select className={ui.select} name="orden" defaultValue={sp.orden ?? "recientes"}>
              <option value="recientes">Más recientes</option><option value="antiguos">Más antiguos</option><option value="nombre">Nombre</option>
            </select>
          </label>
          <div className={ui.row} style={{ alignSelf: "end" }}><button className={ui.button} type="submit">Filtrar</button><Link className={`${ui.button} ${ui.buttonGhost}`} href="/admin/usuarios">Limpiar</Link></div>
        </form>
        <p className={ui.faint} style={{ margin: 0 }}>{data.total} usuario(s)</p>
        {data.rows.length === 0 ? <p className={ui.empty}>No hay usuarios con esos filtros.</p> : (
          <div className={ui.tableWrap}>
            <table className={`${ui.table} ${ui.tableResponsive}`}>
              <thead><tr><th>Usuario</th><th>Tipo</th><th>Estado</th><th>Alta</th></tr></thead>
              <tbody>
                {data.rows.map((u) => (
                  <tr key={u.id}>
                    <td data-label="Usuario"><Link href={`/admin/usuarios/${u.id}`}>{u.name}</Link><div className={ui.faint}>{u.email}</div></td>
                    <td data-label="Tipo">
                      {[u.platformRole === "SUPERADMIN" ? "Superadmin" : null, u.playerProfile ? "Jugador" : null, ...u.memberships.map((m) => `${ROLE[m.role]} · ${m.tenant.name}`)].filter(Boolean).join(" / ") || <span className={ui.faint}>Sin rol</span>}
                    </td>
                    <td data-label="Estado">
                      {u.anonymizedAt ? <span className={ui.badge}>Eliminado</span> : u.isDisabled ? <span className={`${ui.badge} ${ui.badgePENDING}`}>Suspendido</span> : <span className={`${ui.badge} ${ui.badgeCONFIRMED}`}>Activo</span>}
                    </td>
                    <td data-label="Alta">{day(u.createdAt)}</td>
                  </tr>
                ))}
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
