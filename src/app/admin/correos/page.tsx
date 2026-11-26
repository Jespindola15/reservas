import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { EditPanel } from "@/components/EditPanel";
import { FilterBar } from "@/components/FilterBar";
import ui from "@/components/ui.module.css";
import { requireSuperadminPage } from "@/lib/auth/dal";
import { fmtDateTime } from "@/lib/format";
import { DELIVERY_LABEL } from "@/modules/notifications/delivery";
import { KIND_LABEL, NON_RETRYABLE_KINDS, STATUS_LABEL, maskEmail, reasonLabel } from "@/modules/notifications/labels";
import { emailDashboard, testRecipients } from "@/modules/platform/emails";
import { retryEmailAction, sendTestEmailAction } from "./actions";

export const metadata: Metadata = { title: "Correos · Superadministrador" };

const STATUS_BADGE: Record<string, string> = { PENDING: ui.badgePENDING!, SENDING: ui.badgePENDING!, SENT: ui.badgeCONFIRMED!, FAILED: ui.badgeCANCELLED!, SKIPPED: "" };
const PROVIDER: Record<string, string> = { brevo: "Brevo", resend: "Resend", log: "Registro (desarrollo)", memory: "Memoria (pruebas)", disabled: "Desactivado" };

/** Panel de correos: cupo diario, cola, fallas, entrega y reintento. No muestra el contenido de los emails. */
export default async function EmailsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireSuperadminPage("/admin/correos");
  const sp = await searchParams;
  const d = await emailDashboard(user, sp);
  const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
  const href = (p: number) => `?${new URLSearchParams(Object.entries({ ...sp, pagina: String(p) }).filter(([, v]) => v) as [string, string][]).toString()}`;
  const usageAlert = d.usage.pct >= 80;
  const recipients = testRecipients(user);

  return (
    <div className={ui.stack}>
      <header className={ui.pageHeader}>
        <div><p className={ui.eyebrow}>Operación</p><h1>Correos</h1><p className={ui.muted}>Emails transaccionales de la plataforma. &quot;Aceptado&quot; significa que el proveedor lo recibió; la entrega la informa el proveedor después.</p></div>
        <EditPanel label="Enviar correo de prueba" title="Correo de prueba" variant="primary" description="Se envía en el momento por el proveedor activo y usa 1 email del cupo diario.">
          <ActionForm action={sendTestEmailAction} submitLabel="Enviar prueba" className={ui.stack}>
            <label className={ui.field}><span className={ui.label}>Destinatario autorizado</span>
              <select className={ui.select} name="recipient" defaultValue={recipients[0]}>
                {recipients.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <span className={ui.hint}>Tu email o las direcciones de EMAIL_TEST_RECIPIENTS. Nunca se envía a usuarios reales.</span>
            </label>
          </ActionForm>
        </EditPanel>
      </header>

      {d.config.issues.length ? (
        <div role="alert" className={`${ui.alert} ${ui.alertError}`}>{d.config.issues.map((i) => <p key={i} style={{ margin: 0 }}>{i}</p>)}</div>
      ) : null}
      {d.config.senderIsFreeMail ? (
        <div className={`${ui.alert} ${ui.alertWarn}`}>
          <p style={{ margin: 0 }}><strong>Remitente de Gmail u otro correo gratuito ({d.config.senderEmail}).</strong> Brevo reemplaza el remitente por una dirección propia (…@…brevosend.com o …t-sender-sib.com) y muchos emails pueden ir a Spam. Para una entrega confiable hace falta un dominio propio autenticado (DKIM y DMARC).</p>
        </div>
      ) : null}

      <section className={ui.stats} aria-label="Resumen de hoy">
        <div className={`${ui.statTile} ${usageAlert ? ui.statTileAlert : ""}`}>
          <span className={ui.statLabel}>Cupo diario usado</span>
          <span className={ui.statValue}>{d.usage.used}/{d.usage.limit}</span>
          <span className={ui.statHint}>{d.usage.pct}% · día {d.usage.day.split("-").reverse().join("/")} (UTC). Recordatorios y bienvenidas hasta {d.usage.nonCriticalCap}; el resto queda reservado para lo crítico.</span>
        </div>
        <div className={ui.statTile}><span className={ui.statLabel}>Aceptados hoy</span><span className={ui.statValue}>{d.stats.sentToday}</span><span className={ui.statHint}>{d.config.webhook ? `${d.stats.deliveredToday} entregados · ${d.stats.bouncedToday} con problemas` : "Sin webhook de entrega configurado"}</span></div>
        <div className={ui.statTile}><span className={ui.statLabel}>En cola</span><span className={ui.statValue}>{d.stats.pending}</span><span className={ui.statHint}>{d.stats.deferred ? `${d.stats.deferred} esperando cupo` : "Salen en el próximo ciclo"}</span></div>
        <div className={`${ui.statTile} ${d.stats.failed7d ? ui.statTileAlert : ""}`}><span className={ui.statLabel}>Fallidos (7 días)</span><span className={ui.statValue}>{d.stats.failed7d}</span></div>
        <div className={ui.statTile}><span className={ui.statLabel}>Proveedor</span><span className={ui.statValue} style={{ fontSize: "var(--fs-lg)" }}>{PROVIDER[d.config.provider] ?? d.config.provider}</span><span className={ui.statHint}>{d.config.senderEmail ? `Remitente ${d.config.senderEmail}` : "Sin remitente válido"}</span></div>
      </section>

      <FilterBar label="Filtrar correos" search={{ name: "q", placeholder: "Email del destinatario", defaultValue: d.filters.q }} active={Boolean(sp.estado || sp.tipo || sp.complejo)} clearHref="/admin/correos">
        <label className={ui.field}><span className={ui.label}>Estado</span>
          <select className={ui.select} name="estado" defaultValue={d.filters.estado ?? ""}>
            <option value="">Todos</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className={ui.field}><span className={ui.label}>Tipo</span>
          <select className={ui.select} name="tipo" defaultValue={d.filters.tipo ?? ""}>
            <option value="">Todos</option>
            {d.kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}
          </select>
        </label>
        <label className={ui.field}><span className={ui.label}>Complejo</span>
          <select className={ui.select} name="complejo" defaultValue={d.filters.complejo ?? ""}>
            <option value="">Todos</option>
            {d.tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      </FilterBar>
      <p className={ui.faint} style={{ margin: 0 }}>{d.total} email(s)</p>

      {d.rows.length === 0 ? <p className={ui.empty}>No hay emails con esos filtros.</p> : (
        <div className={ui.tableWrap}>
          <table className={`${ui.table} ${ui.tableResponsive}`}>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Destinatario</th><th>Complejo</th><th>Estado</th><th>Detalle</th><th><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Fecha">{fmtDateTime(r.createdAt)}{r.sentAt ? <div className={ui.faint}>Aceptado {fmtDateTime(r.sentAt)}</div> : null}</td>
                  <td data-label="Tipo">{KIND_LABEL[r.kind] ?? r.kind}<div className={ui.faint}>Prioridad {r.priority}</div></td>
                  <td data-label="Destinatario">{maskEmail(r.recipient)}</td>
                  <td data-label="Complejo">{r.tenant ? <Link href={`/admin/complejos/${r.tenant.id}`}>{r.tenant.name}</Link> : <span className={ui.faint}>Plataforma</span>}</td>
                  <td data-label="Estado">
                    <span className={`${ui.badge} ${STATUS_BADGE[r.status] ?? ""}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                    {r.deliveryStatus ? <div className={ui.faint}>{DELIVERY_LABEL[r.deliveryStatus] ?? r.deliveryStatus}{r.deliveryUpdatedAt ? ` · ${fmtDateTime(r.deliveryUpdatedAt)}` : ""}</div> : null}
                  </td>
                  <td data-label="Detalle">
                    {r.lastError ? <span className={r.status === "FAILED" ? undefined : ui.faint}>{reasonLabel(r.lastError)}</span> : null}
                    {r.status === "PENDING" && r.nextAttemptAt > new Date() ? <div className={ui.faint}>Próximo intento {fmtDateTime(r.nextAttemptAt)}</div> : null}
                    <div className={ui.faint}>{r.attempts} intento(s){r.provider ? ` · ${PROVIDER[r.provider] ?? r.provider}` : ""}</div>
                  </td>
                  <td data-label="Acciones" className={(r.status === "FAILED" || r.status === "SKIPPED") && !NON_RETRYABLE_KINDS.has(r.kind) ? undefined : ui.hideMobileEmpty}>
                    {(r.status === "FAILED" || r.status === "SKIPPED") && !NON_RETRYABLE_KINDS.has(r.kind) ? (
                      <ActionForm action={retryEmailAction.bind(null, r.id)} submitLabel="Reintentar" variant="secondary" small confirm={{ title: "¿Reintentar este email?", body: "Vuelve a la cola. Antes de enviarse se revisa que todavía corresponda (por ejemplo, que la reserva no haya cambiado).", confirmLabel: "Reintentar" }} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 ? (
        <nav className={ui.row} aria-label="Páginas">
          {d.filters.pagina > 1 ? <Link className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} href={href(d.filters.pagina - 1)}>Anterior</Link> : null}
          <span className={ui.faint}>Página {d.filters.pagina} de {pages}</span>
          {d.filters.pagina < pages ? <Link className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} href={href(d.filters.pagina + 1)}>Siguiente</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}
