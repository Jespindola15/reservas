import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { FilterBar } from "@/components/FilterBar";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { whatsappLink } from "@/lib/contact/whatsapp";
import { hasPermission } from "@/modules/access/authorize";
import { formatMoney } from "@/modules/booking/pricing";
import { formatLocalDateTime, formatLocalTime } from "@/modules/booking/time";
import { INCIDENT_KINDS, INCIDENT_LABEL, listTransferQueue, readTransferSnapshot, RESOLUTIONS, RESOLUTION_LABEL } from "@/modules/payments/transfers";
import { confirmTransferAction, openIncidentAction, rejectTransferAction, resolveIncidentAction, transferNoteAction } from "./actions";
import styles from "./transfers.module.css";

export const metadata: Metadata = { title: "Transferencias por verificar" };

const TABS = [
  { key: "informadas", label: "Informadas" },
  { key: "pendientes", label: "Esperando transferencia" },
  { key: "incidencias", label: "Incidencias" },
  { key: "todas", label: "Historial" },
] as const;

function remaining(until: Date | null, now: Date) {
  if (!until) return null;
  const ms = until.getTime() - now.getTime();
  if (ms <= 0) return "vencido";
  const m = Math.ceil(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}
const pesos = (cents: number | null) => (cents === null ? "" : String(Math.round(cents / 100)));

export default async function TransfersPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const access = await requireTenantPage(slug, "payments.read");
  if (!access) notFound();
  const { ctx, tenant, role } = access;
  const canVerify = hasPermission(role, "payments.verify");
  const data = await listTransferQueue(ctx, { estado: sp.estado, q: sp.q, cancha: sp.cancha, fecha: sp.fecha });
  const tz = tenant.timezone;
  const tabHref = (key: string) => `?${new URLSearchParams({ estado: key, ...(sp.q ? { q: sp.q } : {}), ...(sp.cancha ? { cancha: sp.cancha } : {}), ...(sp.fecha ? { fecha: sp.fecha } : {}) }).toString()}`;

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Cobros</p>
          <h1>Transferencias por verificar</h1>
          <p className={ui.muted}>Revisá en tu cuenta bancaria que el dinero haya llegado antes de confirmar. Una transferencia informada por el jugador todavía no es un pago verificado.</p>
        </div>
        {hasPermission(role, "payments.configure") ? <Link className={`${ui.button} ${ui.buttonSecondary}`} href={`/panel/${slug}/cobros`}>Datos de cobro</Link> : null}
      </header>

      {sp.verificada && /^[A-Z0-9]{6,12}$/.test(sp.verificada) ? <p role="status" className={`${ui.alert} ${ui.alertOk}`}>Pago verificado. La reserva {sp.verificada} quedó confirmada y avisamos al jugador.</p> : null}
      {sp.rechazada && /^[A-Z0-9]{6,12}$/.test(sp.rechazada) ? <p role="status" className={`${ui.alert} ${ui.alertInfo}`}>Reserva {sp.rechazada} rechazada. El horario quedó libre.</p> : null}
      <nav className={styles.tabs} aria-label="Estado">
        {TABS.map((t) => {
          const count = t.key === "todas" ? null : data.counts[t.key];
          return (
            <Link key={t.key} href={tabHref(t.key)} className={data.estado === t.key ? styles.tabActive : styles.tab} aria-current={data.estado === t.key ? "page" : undefined}>
              {t.label}{count ? <span className={styles.count}>{count}</span> : null}
            </Link>
          );
        })}
      </nav>

      {data.estado !== "incidencias" ? (
        <FilterBar label="Buscar transferencias" search={{ name: "q", placeholder: "Jugador, titular, código, n.º de operación o importe", defaultValue: sp.q }}
          hidden={{ estado: data.estado }} active={Boolean(sp.cancha || sp.fecha)} clearHref={`?estado=${data.estado}`}>
          <label className={ui.field}>
            <span className={ui.label}>Cancha</span>
            <select className={ui.select} name="cancha" defaultValue={sp.cancha ?? ""}>
              <option value="">Todas</option>
              {data.courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className={ui.field}>
            <span className={ui.label}>Fecha del turno</span>
            <input className={ui.input} type="date" name="fecha" defaultValue={sp.fecha ?? ""} />
          </label>
        </FilterBar>
      ) : null}

      {data.estado !== "incidencias" ? (
        data.bookings.length === 0 ? (
          <p className={ui.empty}>{data.estado === "informadas" ? "No hay transferencias informadas para verificar." : data.estado === "pendientes" ? "No hay reservas esperando transferencia." : "Sin movimientos con estos filtros."}</p>
        ) : (
          <ul className={styles.list}>
            {data.bookings.map((b) => {
              const balance = b.priceAmount !== null && b.amountDue !== null ? b.priceAmount - b.amountDue : null;
              const left = b.status === "PENDING" ? remaining(b.expiresAt, data.now) : null;
              const wa = whatsappLink(b.customerPhone, `Hola ${b.customerName.split(" ")[0]}, te escribimos de ${tenant.name} por tu reserva ${b.code} del ${formatLocalDateTime(b.startsAt, tz)}.`);
              const pending = b.status === "PENDING";
              return (
                <li key={b.id} className={`${ui.card} ${styles.item}`}>
                  <div className={styles.head}>
                    <div>
                      <strong className={styles.code}>{b.code}</strong>
                      <span className={ui.muted}> · {b.court.name} · {formatLocalDateTime(b.startsAt, tz)} a {formatLocalTime(b.endsAt, tz)}</span>
                    </div>
                    <span className={`${ui.badge} ${b.paymentStatus === "VERIFIED" ? ui.badgeCONFIRMED : b.paymentStatus === "TRANSFER_REPORTED" ? styles.badgeReported : ui.badgePENDING}`}>
                      {b.paymentStatus === "VERIFIED" ? "Pago verificado" : b.paymentStatus === "TRANSFER_REPORTED" ? "Transferencia informada" : b.status === "PENDING" ? "Esperando transferencia" : b.status}
                    </span>
                  </div>
                  <dl className={styles.dl}>
                    <dt>Jugador</dt><dd>{b.customerName} · {b.customerPhone}</dd>
                    <dt>Titular que transfiere</dt><dd>{b.transferPayerName ?? <span className={ui.faint}>El mismo jugador</span>}</dd>
                    <dt>A transferir</dt><dd><strong>{formatMoney(b.amountDue, b.currency)}</strong> <span className={ui.faint}>de {formatMoney(b.priceAmount, b.currency)}{balance ? ` · saldo ${formatMoney(balance, b.currency)}` : ""}</span></dd>
                    <dt>Informada</dt><dd>{b.transferReportedAt ? formatLocalDateTime(b.transferReportedAt, tz) : <span className={ui.faint}>Todavía no</span>}</dd>
                    <dt>N.º de operación</dt><dd>{b.transferReference ?? <span className={ui.faint}>No informado</span>}</dd>
                    {(() => {
                      const snap = readTransferSnapshot(b.transferSnapshot);
                      return snap ? (<><dt>Cuenta mostrada</dt><dd>{[snap.alias, snap.cbuCvu, snap.holderName].filter(Boolean).join(" · ")}</dd></>) : null;
                    })()}
                    {b.paymentReceivedAmount !== null ? (<><dt>Recibido</dt><dd>{formatMoney(b.paymentReceivedAmount, b.currency)}{b.paymentReference ? ` · ref. ${b.paymentReference}` : ""}</dd></>) : null}
                    {pending ? (<><dt>{b.paymentStatus === "TRANSFER_REPORTED" ? "Tiempo para revisar" : "Tiempo para transferir"}</dt><dd className={left === "vencido" ? ui.textDanger : undefined}>{left ?? "Sin límite"}</dd></>) : null}
                    {b.paymentVerifiedAt ? (<><dt>Verificado</dt><dd>{formatLocalDateTime(b.paymentVerifiedAt, tz)}</dd></>) : null}
                  </dl>
                  <div className={styles.actions}>
                    {pending && canVerify ? (
                      <>
                        <details className={styles.action}>
                          <summary className={`${ui.button} ${ui.buttonSmall}`}>Confirmar pago</summary>
                          <ActionForm action={confirmTransferAction.bind(null, slug, b.id, b.version)} submitLabel="Confirmar: el dinero llegó" className={ui.stack}
                            confirm={{ title: `¿Confirmar ${b.code}?`, body: "Confirmá solo si verificaste el dinero en tu cuenta. La reserva quedará confirmada y se avisará al jugador.", confirmLabel: "Sí, verifiqué el pago" }}>
                            <label className={ui.field}>
                              <span className={ui.label}>Importe recibido (pesos)</span>
                              <input className={ui.input} name="receivedAmount" inputMode="decimal" required defaultValue={pesos(b.amountDue)} pattern="\d{1,9}([.,]\d{1,2})?" />
                            </label>
                            <label className={ui.field}><span className={ui.label}>N.º de operación verificado (opcional)</span><input className={ui.input} name="reference" maxLength={60} defaultValue={b.transferReference ?? ""} autoComplete="off" /><span className={ui.hint}>Un mismo número no puede confirmar dos reservas.</span></label>
                            <label className={ui.field}><span className={ui.label}>Si el importe no coincide</span>
                              <select className={ui.select} name="difference" defaultValue="">
                                <option value="">El importe coincide</option>
                                <option value="ACCEPT_PARTIAL">Recibí menos: confirmar igual y registrar la diferencia</option>
                                <option value="ACCEPT_OVERPAID">Recibí más: confirmar y devolver la diferencia</option>
                              </select>
                            </label>
                            <label className={ui.field}><span className={ui.label}>Nota (opcional)</span><input className={ui.input} name="note" maxLength={300} /></label>
                          </ActionForm>
                        </details>
                        <details className={styles.action}>
                          <summary className={`${ui.button} ${ui.buttonSmall} ${ui.buttonDanger}`}>Rechazar</summary>
                          <ActionForm action={rejectTransferAction.bind(null, slug, b.id, b.version)} submitLabel="Rechazar reserva" variant="danger" className={ui.stack}
                            confirm={{ title: `¿Rechazar ${b.code}?`, body: "El horario quedará libre y se avisará al jugador con el motivo.", confirmLabel: "Sí, rechazar" }}>
                            <label className={ui.field}><span className={ui.label}>Motivo (lo ve el jugador)</span><input className={ui.input} name="reason" required minLength={3} maxLength={300} placeholder="No recibimos la transferencia" /></label>
                            <label className={ui.checkbox}><input type="checkbox" name="moneyReceived" /> Recibí dinero igual (queda una incidencia para gestionar la devolución)</label>
                            <label className={ui.field}><span className={ui.label}>Importe recibido (opcional)</span><input className={ui.input} name="receivedAmount" inputMode="decimal" /></label>
                          </ActionForm>
                        </details>
                      </>
                    ) : null}
                    {wa ? <a className={`${ui.button} ${ui.buttonSmall} ${ui.buttonSecondary}`} href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a> : null}
                    <Link className={`${ui.button} ${ui.buttonSmall} ${ui.buttonGhost}`} href={`/panel/${slug}/reservas/${b.id}`}>Ver reserva</Link>
                    <details className={styles.action}>
                      <summary className={`${ui.button} ${ui.buttonSmall} ${ui.buttonGhost}`}>Nota interna</summary>
                      <ActionForm action={transferNoteAction.bind(null, slug, b.id)} submitLabel="Guardar nota" small className={ui.stack}>
                        <label className={ui.field}><span className="sr-only">Nota interna</span><textarea className={ui.textarea} name="notes" maxLength={2000} placeholder="Solo la ve el equipo del complejo" /></label>
                      </ActionForm>
                    </details>
                    {canVerify ? (
                      <details className={styles.action}>
                        <summary className={`${ui.button} ${ui.buttonSmall} ${ui.buttonGhost}`}>Incidencia</summary>
                        <ActionForm action={openIncidentAction.bind(null, slug, b.id)} submitLabel="Registrar incidencia" small className={ui.stack}>
                          <label className={ui.field}>
                            <span className={ui.label}>Tipo</span>
                            <select className={ui.select} name="kind" required defaultValue="OTHER">
                              {INCIDENT_KINDS.map((k) => <option key={k} value={k}>{INCIDENT_LABEL[k]}</option>)}
                            </select>
                          </label>
                          <label className={ui.field}><span className={ui.label}>Importe (opcional)</span><input className={ui.input} name="amount" inputMode="decimal" /></label>
                          <label className={ui.field}><span className={ui.label}>Detalle</span><textarea className={ui.textarea} name="notes" maxLength={500} /></label>
                        </ActionForm>
                      </details>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {data.incidents.length ? (
        <section aria-labelledby="inc" style={{ marginTop: "1.5rem" }}>
          <h2 id="inc">{data.estado === "incidencias" ? "Incidencias de pago" : "Incidencias abiertas"}</h2>
          <p className={ui.faint}>TURNUP no recibe ni devuelve dinero: las devoluciones las hace el complejo desde su cuenta y acá solo se registran.</p>
          <ul className={styles.list}>
            {data.incidents.map((i) => (
              <li key={i.id} className={`${ui.card} ${styles.item}`}>
                <div className={styles.head}>
                  <div><strong>{INCIDENT_LABEL[i.kind as keyof typeof INCIDENT_LABEL] ?? i.kind}</strong> <span className={ui.muted}>· {i.booking.code} · {i.booking.customerName}</span></div>
                  <span className={`${ui.badge} ${i.status === "OPEN" ? ui.badgePENDING : ""}`}>{i.status === "OPEN" ? "Abierta" : `Cerrada · ${RESOLUTION_LABEL[i.resolution as keyof typeof RESOLUTION_LABEL] ?? ""}`}</span>
                </div>
                <p className={ui.muted} style={{ margin: 0 }}>
                  {formatLocalDateTime(i.createdAt, tz)}{i.amount ? ` · ${formatMoney(i.amount, tenant.currency)}` : ""}{i.notes ? ` · ${i.notes}` : ""}
                </p>
                {i.status === "OPEN" && canVerify ? (
                  <ActionForm action={resolveIncidentAction.bind(null, slug, i.id)} submitLabel="Cerrar incidencia" small className={styles.resolve}>
                    <select className={ui.select} name="resolution" required defaultValue="REFUNDED_EXTERNALLY" aria-label="Resolución">
                      {RESOLUTIONS.map((r) => <option key={r} value={r}>{RESOLUTION_LABEL[r]}</option>)}
                    </select>
                    <input className={ui.input} name="notes" maxLength={500} placeholder="Detalle (opcional)" aria-label="Detalle" />
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : data.estado === "incidencias" ? <p className={ui.empty}>No hay incidencias registradas.</p> : null}
    </>
  );
}
