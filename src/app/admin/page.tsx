import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { TopBar } from "@/components/TopBar";
import ui from "@/components/ui.module.css";
import { requireSuperadminPage } from "@/lib/auth/dal";
import { formatMoney } from "@/modules/booking/pricing";
import { listSubscriptionPayments, platformOverview, tenantActivity } from "@/modules/platform/billing";
import { listTenantsForPlatform } from "@/modules/platform/service";
import { SignOutButton } from "../panel/SignOutButton";
import { AdminNav } from "./AdminNav";
import { assignAdminAction, createTenantAction, recordSubscriptionPaymentAction } from "./actions";

const SUB_LABEL: Record<string, string> = { TRIAL: "Prueba", ACTIVE: "Activa", PAST_DUE: "Vencida (en gracia)", SUSPENDED: "Suspendida", CANCELLED: "Cancelada" };
const day = (d: Date | null | undefined) => (d ? d.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }) : "—");

export const metadata: Metadata = { title: "Superadministrador" };

export default async function AdminPage() {
  // 404 a quien no es superadmin (no revela que la ruta existe); sin 2FA, a configurarlo.
  const user = await requireSuperadminPage("/admin");

  const now = new Date();
  const [o, tenants, activity, payments] = await Promise.all([platformOverview(user, now), listTenantsForPlatform(user), tenantActivity(user, now), listSubscriptionPayments(user, 15)]);
  const today = now.toISOString().slice(0, 10);

  return (
    <>
      <TopBar>
        <Link href="/panel" className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`}>Mis complejos</Link>
        <SignOutButton />
      </TopBar>
      <main className={`${ui.container} ${ui.page} ${ui.stack}`}>
        <div className={ui.spread}><h1>Plataforma</h1><AdminNav current="/admin" /></div>
        <section className={ui.grid3} aria-label="Métricas">
          {[
            ["Complejos", o.tenants, `${o.active} activos · ${o.suspended} suspendidos`],
            ["En prueba", o.trial, `${o.expiringSoon} vencen en 7 días · ${o.expired} vencidas`],
            ["MRR registrado", formatMoney(o.mrr, "ARS"), `Cobrado 30 días: ${formatMoney(o.collected30d, "ARS")}`],
            ["Canchas activas", o.courts, ""],
            ["Reservas (30 días)", o.bookings30d, ""],
            ["Usuarios activos (30 días)", o.activeUsers30d, ""],
          ].map(([label, value, hint]) => (
            <div key={String(label)} className={ui.card}>
              <div className={ui.stat}><span className={ui.muted}>{label}</span><span className={ui.statValue}>{value}</span>{hint ? <span className={ui.statHint}>{hint}</span> : null}</div>
            </div>
          ))}
        </section>

        <section className={ui.card} aria-labelledby="sistema">
          <h2 id="sistema">Estado del sistema</h2>
          <ul className={ui.stackSm} style={{ margin: 0, paddingLeft: "1.1rem" }}>
            <li>
              Base de datos: <strong>respondiendo</strong> · {(o.system.dbBytes / 1024 / 1024).toFixed(1)} MB de {Math.round(o.system.dbLimitBytes / 1024 / 1024)} MB del plan gratuito
              {o.system.dbBytes > o.system.dbLimitBytes * 0.7 ? <strong className={ui.textDanger}> · superó el 70 %: conviene revisar el plan (ver docs/INFRAESTRUCTURA.md)</strong> : null}
            </li>
            <li>Emails: <strong>{o.system.emailProvider === "resend" ? "Resend configurado" : o.system.emailProvider === "disabled" ? "desactivados" : `modo ${o.system.emailProvider} (no se envían)`}</strong></li>
            {o.system.jobs.length === 0 ? <li>Tareas programadas: <strong>sin ejecuciones registradas</strong></li> : null}
            {o.system.jobs.map((j) => (
              <li key={j.name}>Tarea <code>{j.name}</code>: {j.stale ? <strong className={ui.textDanger}>sin éxito hace más de 2 h</strong> : "OK"} · último éxito {j.lastSuccessAt ? j.lastSuccessAt.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hourCycle: "h23" }) : "nunca"}{j.consecutiveFailures ? ` · ${j.consecutiveFailures} fallos seguidos` : ""}</li>
            ))}
          </ul>
        </section>

        <section className={ui.card} aria-labelledby="complejos">
          <div className={ui.spread}><h2 id="complejos">Complejos</h2><Link href="/admin/complejos">Buscar y filtrar →</Link></div>
          <div className={ui.tableWrap}>
          <table className={`${ui.table} ${ui.tableResponsive}`}>
            <thead><tr><th>Complejo</th><th>Estado</th><th>Canchas / Reservas / Usuarios</th><th>Actividad (30 días)</th><th>Suscripción</th><th><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>
              {tenants.map((t) => {
                const sub = t.subscriptions[0];
                return (
                  <tr key={t.id}>
                    <td><Link href={`/admin/complejos/${t.id}`}><strong>{t.name}</strong></Link><div className={ui.muted}>/{t.slug} · alta {day(t.createdAt)}</div></td>
                    <td><span className={`${ui.badge} ${t.status === "ACTIVE" ? ui.badgeCONFIRMED : ui.badgeCANCELLED}`}>{t.archivedAt ? "Archivado" : t.status === "ACTIVE" ? "Activo" : "Suspendido"}</span></td>
                    <td>{t._count.courts} / {t._count.bookings} / {t._count.memberships}</td>
                    <td>{activity.bookings30d.get(t.id) ?? 0} reservas<div className={ui.faint}>última {day(activity.lastBookingAt.get(t.id))}</div></td>
                    <td>
                      {sub ? <>{sub.plan.name} · {SUB_LABEL[sub.status] ?? sub.status}<div className={sub.currentPeriodEnd < now ? ui.textDanger : ui.faint}>vence {day(sub.currentPeriodEnd)}</div></> : <span className={ui.muted}>Sin registrar</span>}
                      <div className={ui.faint}>último pago {day(activity.lastPaymentAt.get(t.id))}</div>
                    </td>
                    <td>
                      <Link className={`${ui.button} ${ui.buttonSmall} ${ui.buttonSecondary}`} href={`/admin/complejos/${t.id}`}>Administrar</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </section>

        <div className={ui.grid2}>
          <section className={ui.card} aria-labelledby="cobro">
            <h2 id="cobro">Registrar pago de suscripción</h2>
            <p className={ui.faint}>Pagos recibidos por fuera de TURNUP (transferencia, efectivo, link de pago). No se guardan datos de tarjetas.</p>
            <ActionForm action={recordSubscriptionPaymentAction} submitLabel="Registrar pago" className={ui.stack} resetOnSuccess>
              <label className={ui.field}><span className={ui.label}>Complejo</span>
                <select className={ui.select} name="tenantId" required>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <div className={ui.grid2}>
                <label className={ui.field}><span className={ui.label}>Importe ($)</span><input className={ui.input} name="amount" inputMode="decimal" required pattern="\d{1,9}([.,]\d{1,2})?" /></label>
                <label className={ui.field}><span className={ui.label}>Medio</span>
                  <select className={ui.select} name="method" defaultValue="TRANSFER">
                    <option value="TRANSFER">Transferencia</option><option value="CASH">Efectivo</option><option value="MERCADOPAGO_MANUAL">Mercado Pago (manual)</option><option value="CARD">Tarjeta (terminal)</option><option value="OTHER">Otro</option>
                  </select>
                </label>
                <label className={ui.field}><span className={ui.label}>Fecha de pago</span><input className={ui.input} type="date" name="paidAt" defaultValue={today} required /></label>
                <span />
                <label className={ui.field}><span className={ui.label}>Período desde</span><input className={ui.input} type="date" name="periodStart" required /></label>
                <label className={ui.field}><span className={ui.label}>Período hasta</span><input className={ui.input} type="date" name="periodEnd" required /></label>
              </div>
              <label className={ui.field}><span className={ui.label}>Nota (opcional)</span><input className={ui.input} name="note" maxLength={300} /></label>
              <label className={ui.checkbox}><input type="checkbox" name="extend" defaultChecked /> Activar la suscripción y extender el vencimiento hasta el fin del período</label>
            </ActionForm>
          </section>
          <section className={ui.card} aria-labelledby="pagos">
            <h2 id="pagos">Últimos pagos registrados</h2>
            {payments.length === 0 ? <p className={ui.muted}>Todavía no hay pagos registrados.</p> : (
              <ul className={ui.stackSm} style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {payments.map((p) => (
                  <li key={p.id}><strong>{formatMoney(p.amount, p.currency)}</strong> · {p.tenant.name} · {day(p.paidAt)}<div className={ui.faint}>Período {p.periodStart.toISOString().slice(0, 10)} a {p.periodEnd.toISOString().slice(0, 10)}{p.note ? ` · ${p.note}` : ""}</div></li>
                ))}
              </ul>
            )}
          </section>
        </div>

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
