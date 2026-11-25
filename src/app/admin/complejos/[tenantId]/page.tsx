import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import ui from "@/components/ui.module.css";
import { requireSuperadminPage } from "@/lib/auth/dal";
import { isAppError } from "@/lib/errors";
import { listPlans } from "@/modules/platform/plans";
import { getTenantAdmin } from "@/modules/platform/tenants";
import { archiveTenantAction, assignSubscriptionAction, changeOwnerAction, extendTrialAction, updateTenantBasicsAction, setTenantStatusAction, unarchiveTenantAction } from "../../actions";

export const metadata: Metadata = { title: "Complejo · Superadministrador" };
const ROLE: Record<string, string> = { OWNER: "Dueño", ADMIN: "Administrador", STAFF: "Personal" };
const SUB: Record<string, string> = { TRIAL: "Prueba", ACTIVE: "Activa", PAST_DUE: "Vencida (gracia)", SUSPENDED: "Suspendida", CANCELLED: "Cancelada" };
const day = (d: Date) => d.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function TenantAdminPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const user = await requireSuperadminPage(`/admin/complejos/${tenantId}`);
  let d;
  try {
    d = await getTenantAdmin(user, tenantId);
  } catch (e) {
    if (isAppError(e) && (e.code === "TENANT_NOT_FOUND" || e.code === "VALIDATION_ERROR")) notFound();
    throw e;
  }
  const plans = await listPlans(user);
  const t = d.tenant;
  const trial = t.subscriptions.find((s) => s.status === "TRIAL");
  const today = new Date();

  return (
    <>
      <div className={ui.stack}>
        <header className={ui.pageHeader}><div><p className={ui.eyebrow}>Complejo</p><h1>{t.name}</h1></div></header>
        <div className={ui.row}>
          <Link href="/admin/complejos" className={ui.faint}>← Complejos</Link>
          <Link href={`/${t.slug}`} target="_blank" rel="noopener" className={`${ui.button} ${ui.buttonSmall} ${ui.buttonSecondary}`}>Ver página pública</Link>
        </div>
        {t.archivedAt ? <p className={`${ui.alert} ${ui.alertWarn}`}>Archivado el {day(t.archivedAt)}: oculto y sin reservas nuevas. Sus datos se conservan.</p>
          : t.status !== "ACTIVE" ? <p className={`${ui.alert} ${ui.alertWarn}`}>Suspendido{t.suspendedReason ? `: ${t.suspendedReason}` : ""}. No aparece en el catálogo ni recibe reservas nuevas.</p> : null}

        <section className={ui.grid3} aria-label="Indicadores">
          {[["Reservas (30 días)", d.stats.bookings30], ["Próximas reservas", d.stats.upcoming], ["Transferencias pendientes", d.stats.pendingTransfers], ["Incidencias de pago abiertas", d.stats.openIncidents]].map(([l, v]) => (
            <div key={String(l)} className={ui.card}><div className={ui.stat}><span className={ui.muted}>{l}</span><span className={ui.statValue}>{v}</span></div></div>
          ))}
        </section>

        <div className={ui.grid2} style={{ alignItems: "start" }}>
          <section className={ui.card} aria-labelledby="datos">
            <h2 id="datos">Datos</h2>
            <dl className={ui.dl}>
              <dt>Dirección</dt><dd>{[t.address, t.city, t.province].filter(Boolean).join(", ") || "—"}</dd>
              <dt>Contacto</dt><dd>{t.contactPhone ?? "—"}</dd>
              <dt>Alta</dt><dd>{day(t.createdAt)}</dd>
              <dt>Cobro por transferencia</dt><dd>{t.depositType === "NONE" ? "No pide pago anticipado" : t.paymentSettings ? "Configurado" : "Pide seña pero no cargó datos (reservas online bloqueadas)"}</dd>
              <dt>En el catálogo</dt><dd>{t.publicListed && t.status === "ACTIVE" && !t.archivedAt ? "Sí" : "No"}</dd>
            </dl>
            <details className={ui.details}>
              <summary>Editar datos del complejo</summary>
              <ActionForm action={updateTenantBasicsAction.bind(null, t.id)} submitLabel="Guardar datos" className={ui.stack}>
                <label className={ui.field}><span className={ui.label}>Nombre</span><input className={ui.input} name="name" defaultValue={t.name} minLength={2} maxLength={80} required /></label>
                <label className={ui.field}><span className={ui.label}>Dirección</span><input className={ui.input} name="address" defaultValue={t.address ?? ""} maxLength={160} /></label>
                <div className={ui.grid2}>
                  <label className={ui.field}><span className={ui.label}>Ciudad</span><input className={ui.input} name="city" defaultValue={t.city ?? ""} maxLength={80} /></label>
                  <label className={ui.field}><span className={ui.label}>Provincia</span><input className={ui.input} name="province" defaultValue={t.province ?? ""} maxLength={80} /></label>
                </div>
                <div className={ui.grid2}>
                  <label className={ui.field}><span className={ui.label}>Teléfono de contacto</span><input className={ui.input} name="contactPhone" type="tel" defaultValue={t.contactPhone ?? ""} maxLength={30} /></label>
                  <label className={ui.field}><span className={ui.label}>Email de contacto</span><input className={ui.input} name="contactEmail" type="email" defaultValue={t.contactEmail ?? ""} maxLength={254} /></label>
                </div>
                <p className={ui.hint} style={{ margin: 0 }}>La dirección web (/{t.slug}) no se cambia para no romper enlaces ya compartidos.</p>
              </ActionForm>
            </details>
            <h3>Canchas</h3>
            {t.courts.length ? <ul style={{ paddingLeft: "1rem" }}>{t.courts.map((c) => <li key={c.id}>{c.name}{c.isActive ? "" : " (inactiva)"}</li>)}</ul> : <p className={ui.muted}>Sin canchas.</p>}
          </section>

          <section className={ui.card} aria-labelledby="equipo">
            <h2 id="equipo">Equipo</h2>
            <ul style={{ paddingLeft: "1rem" }}>
              {t.memberships.map((m) => (
                <li key={m.id}><Link href={`/admin/usuarios/${m.user.id}`}>{m.user.name}</Link> · {ROLE[m.role]}{m.isActive ? "" : " (inactivo)"}{m.user.isDisabled ? " · suspendido" : ""}<div className={ui.faint}>{m.user.email}</div></li>
              ))}
            </ul>
            <ActionForm action={changeOwnerAction.bind(null, t.id)} submitLabel="Cambiar dueño" small className={ui.stack}
              confirm={{ title: "¿Cambiar el dueño?", body: "La persona indicada pasa a ser dueña. Los dueños actuales quedan como administradores.", confirmLabel: "Cambiar" }}>
              <label className={ui.field}><span className={ui.label}>Email del nuevo dueño (debe tener cuenta)</span><input className={ui.input} name="email" type="email" required maxLength={254} /></label>
            </ActionForm>
          </section>
        </div>

        <section className={ui.card} aria-labelledby="plan">
          <h2 id="plan">Plan y suscripción</h2>
          {t.subscriptions.length ? (
            <ul style={{ paddingLeft: "1rem" }}>{t.subscriptions.map((s) => <li key={s.id}>{s.plan.name} · {SUB[s.status] ?? s.status} · {day(s.currentPeriodStart)} al {day(s.currentPeriodEnd)}</li>)}</ul>
          ) : <p className={ui.muted}>Sin suscripción registrada.</p>}
          <div className={ui.grid2}>
            <ActionForm action={assignSubscriptionAction} submitLabel="Asignar plan / cambiar vencimiento" small className={ui.stack}>
              <input type="hidden" name="tenantId" value={t.id} />
              <label className={ui.field}><span className={ui.label}>Plan</span>
                <select className={ui.select} name="planId" required>{plans.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </label>
              <label className={ui.field}><span className={ui.label}>Estado</span>
                <select className={ui.select} name="status" defaultValue="ACTIVE"><option value="TRIAL">Prueba</option><option value="ACTIVE">Activa</option><option value="PAST_DUE">Vencida (gracia)</option></select>
              </label>
              <div className={ui.grid2}>
                <label className={ui.field}><span className={ui.label}>Desde</span><input className={ui.input} type="date" name="currentPeriodStart" required defaultValue={iso(today)} /></label>
                <label className={ui.field}><span className={ui.label}>Vence</span><input className={ui.input} type="date" name="currentPeriodEnd" required /></label>
              </div>
            </ActionForm>
            {trial ? (
              <ActionForm action={extendTrialAction.bind(null, t.id)} submitLabel="Extender prueba" small className={ui.stack}>
                <label className={ui.field}><span className={ui.label}>Días a sumar (hoy vence el {day(trial.currentPeriodEnd)})</span><input className={ui.input} type="number" name="days" min={1} max={90} required defaultValue={14} /></label>
              </ActionForm>
            ) : null}
          </div>
        </section>

        <section className={ui.card} aria-labelledby="estado">
          <h2 id="estado">Estado</h2>
          <div className={ui.stack}>
            {t.archivedAt ? (
              <ActionForm action={unarchiveTenantAction.bind(null, t.id)} submitLabel="Desarchivar" variant="secondary" />
            ) : t.status === "ACTIVE" ? (
              <ActionForm action={setTenantStatusAction} submitLabel="Suspender complejo" variant="danger" className={ui.stack}
                confirm={{ title: `¿Suspender ${t.name}?`, body: "Se oculta del catálogo, no recibe reservas nuevas y su panel queda inaccesible. Las reservas existentes y los datos se conservan.", confirmLabel: "Suspender" }}>
                <input type="hidden" name="tenantId" value={t.id} /><input type="hidden" name="status" value="SUSPENDED" />
                <label className={ui.field}><span className={ui.label}>Motivo (obligatorio, queda registrado)</span><input className={ui.input} name="reason" required minLength={5} maxLength={300} /></label>
              </ActionForm>
            ) : (
              <>
                <ActionForm action={setTenantStatusAction} submitLabel="Reactivar complejo" confirm={{ title: "¿Reactivar?", body: "Vuelve al catálogo y acepta reservas.", confirmLabel: "Reactivar" }}>
                  <input type="hidden" name="tenantId" value={t.id} /><input type="hidden" name="status" value="ACTIVE" /><input type="hidden" name="reason" value="" />
                </ActionForm>
                <details>
                  <summary style={{ cursor: "pointer", fontWeight: 700 }}>Archivar (dar de baja)</summary>
                  <ActionForm action={archiveTenantAction.bind(null, t.id)} submitLabel="Archivar" variant="danger" className={ui.stack}
                    confirm={{ title: "¿Archivar el complejo?", body: "Queda oculto en todos lados. No se borran reservas, pagos, fotos ni auditoría.", confirmLabel: "Archivar" }}>
                    <label className={ui.field}><span className={ui.label}>Escribí el slug “{t.slug}” para confirmar</span><input className={ui.input} name="confirmSlug" required autoComplete="off" /></label>
                  </ActionForm>
                </details>
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
