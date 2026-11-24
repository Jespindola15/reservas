import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { TopBar } from "@/components/TopBar";
import ui from "@/components/ui.module.css";
import { requireSuperadminPage } from "@/lib/auth/dal";
import { listTenantsForPlatform, platformMetrics } from "@/modules/platform/service";
import { SignOutButton } from "../panel/SignOutButton";
import { AdminNav } from "./AdminNav";
import { assignAdminAction, createTenantAction, setTenantStatusAction } from "./actions";

export const metadata: Metadata = { title: "Superadministrador" };

export default async function AdminPage() {
  // 404 a quien no es superadmin (no revela que la ruta existe); sin 2FA, a configurarlo.
  const user = await requireSuperadminPage("/admin");

  const [metrics, tenants] = await Promise.all([platformMetrics(user), listTenantsForPlatform(user)]);

  return (
    <>
      <TopBar>
        <Link href="/panel" className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`}>Mis complejos</Link>
        <SignOutButton />
      </TopBar>
      <main className={`${ui.container} ${ui.page} ${ui.stack}`}>
        <div className={ui.spread}><h1>Plataforma</h1><AdminNav current="/admin" /></div>
        <section className={ui.grid2} aria-label="Métricas">
          {[
            ["Complejos", metrics.tenants],
            ["Activos", metrics.activeTenants],
            ["Canchas activas", metrics.courts],
            ["Reservas (30 días)", metrics.bookings30d],
          ].map(([label, value]) => (
            <div key={label} className={ui.card}>
              <div className={ui.stat}><span className={ui.muted}>{label}</span><span className={ui.statValue}>{value}</span></div>
            </div>
          ))}
        </section>

        <section className={ui.card} aria-labelledby="complejos">
          <h2 id="complejos">Complejos</h2>
          <div className={ui.tableWrap}>
          <table className={`${ui.table} ${ui.tableResponsive}`}>
            <thead><tr><th>Complejo</th><th>Estado</th><th>Canchas / Reservas / Usuarios</th><th>Suscripción</th><th><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>
              {tenants.map((t) => {
                const sub = t.subscriptions[0];
                return (
                  <tr key={t.id}>
                    <td><strong>{t.name}</strong><div className={ui.muted}>/{t.slug}</div></td>
                    <td><span className={`${ui.badge} ${t.status === "ACTIVE" ? ui.badgeCONFIRMED : ui.badgeCANCELLED}`}>{t.status === "ACTIVE" ? "Activo" : "Suspendido"}</span></td>
                    <td>{t._count.courts} / {t._count.bookings} / {t._count.memberships}</td>
                    <td>{sub ? `${sub.plan.name} · ${sub.status}` : <span className={ui.muted}>Sin registrar</span>}</td>
                    <td>
                      <ActionForm
                        action={setTenantStatusAction}
                        submitLabel={t.status === "ACTIVE" ? "Suspender" : "Activar"}
                        variant={t.status === "ACTIVE" ? "danger" : "secondary"}
                        small
                        confirm={t.status === "ACTIVE" ? { title: `¿Suspender ${t.name}?`, body: "Dejará de recibir reservas y su panel quedará inaccesible." } : undefined}
                      >
                        <input type="hidden" name="tenantId" value={t.id} />
                        <input type="hidden" name="status" value={t.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"} />
                      </ActionForm>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </section>

        <div className={ui.grid2}>
          <section className={ui.card} aria-labelledby="nuevo">
            <h2 id="nuevo">Nuevo complejo</h2>
            <ActionForm action={createTenantAction} submitLabel="Crear complejo" className={ui.stack}>
              <label className={ui.field}><span className={ui.label}>Nombre</span><input className={ui.input} name="name" required minLength={2} maxLength={100} /></label>
              <label className={ui.field}><span className={ui.label}>Slug (URL)</span><input className={ui.input} name="slug" required pattern="[a-z0-9][a-z0-9-]{1,48}[a-z0-9]" placeholder="padel-centro" /></label>
              <label className={ui.field}><span className={ui.label}>Zona horaria</span><input className={ui.input} name="timezone" defaultValue="America/Argentina/Buenos_Aires" /></label>
            </ActionForm>
          </section>
          <section className={ui.card} aria-labelledby="asignar">
            <h2 id="asignar">Asignar administrador</h2>
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
          </section>
        </div>
      </main>
    </>
  );
}
