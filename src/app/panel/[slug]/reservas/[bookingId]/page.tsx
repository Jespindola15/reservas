import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { ActionForm } from "@/components/ActionForm";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { isAppError } from "@/lib/errors";
import { hasPermission } from "@/modules/access/authorize";
import { getBookingDetail } from "@/modules/booking/admin-queries";
import { getBookingPayments, KIND_LABEL, METHOD_LABEL, PAYMENT_METHODS } from "@/modules/booking/payments";
import { whatsappLink } from "@/lib/contact/whatsapp";
import { formatMoney } from "@/modules/booking/pricing";
import { formatLocalDateTime, formatLocalTime } from "@/modules/booking/time";
import { listCourtsAdmin } from "@/modules/courts/service";
import {
  cancelBookingAction,
  completeBookingAction,
  confirmBookingAction,
  noShowBookingAction,
  rejectBookingAction,
  rescheduleBookingAction,
  saveInternalNotesAction,
  recordPaymentAction,
  voidPaymentAction,
  cancelSeriesAction,
} from "../../actions";
import { STATUS_LABEL, actionLabel } from "../../labels";
import styles from "./detail.module.css";

export const metadata: Metadata = { title: "Detalle de reserva" };

const OK_MESSAGES: Record<string, string> = {
  confirmed: "Reserva confirmada.",
  rejected: "Solicitud rechazada. El turno quedó libre.",
  cancelled: "Reserva cancelada. El turno quedó libre.",
  completed: "Marcada como jugada.",
  no_show: "Marcada como ausente.",
  rescheduled: "Reserva reprogramada.",
};

export default async function BookingDetailPage({ params, searchParams }: { params: Promise<{ slug: string; bookingId: string }>; searchParams: Promise<{ ok?: string }> }) {
  const { slug, bookingId } = await params;
  const { ok } = await searchParams;
  const access = await requireTenantPage(slug, "booking.read");
  if (!access) notFound();
  const { ctx, tenant, role } = access;
  let data;
  try {
    data = await getBookingDetail(ctx, bookingId);
  } catch (e) {
    if (isAppError(e) && (e.code === "BOOKING_NOT_FOUND" || e.code === "VALIDATION_ERROR")) notFound();
    throw e;
  }
  const { booking: b, history } = data;
  const tz = tenant.timezone;
  const now = new Date();
  const canManage = hasPermission(role, "booking.manage");
  const expired = b.status === "PENDING" && b.expiresAt !== null && b.expiresAt <= now;
  const active = (b.status === "PENDING" && !expired) || b.status === "CONFIRMED";
  const started = b.startsAt <= now;
  const courts = active && canManage ? (await listCourtsAdmin(ctx)).filter((c) => c.isActive) : [];
  const local = DateTime.fromJSDate(b.startsAt, { zone: tz });
  const pay = await getBookingPayments(ctx, b.id);
  const canPay = hasPermission(role, "payment.record");
  const canVoid = hasPermission(role, "payment.void");
  const wa = whatsappLink(
    b.customerPhone,
    `Hola ${b.customerName.split(" ")[0]}, te escribimos de ${tenant.name} por tu turno del ${local.setLocale("es-AR").toFormat("cccc d/LL 'a las' HH:mm")} (${b.court.name}).`,
  );
  const hidden = (
    <>
      <input type="hidden" name="bookingId" value={b.id} />
      <input type="hidden" name="version" value={b.version} />
    </>
  );

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}><Link href={`/panel/${slug}/reservas`}>Reservas</Link> / {b.code}</p>
          <h1>{b.customerName}</h1>
        </div>
        <span className={`${ui.badge} ${ui[`badge${expired ? "EXPIRED" : b.status}`] ?? ""}`}>{expired ? "Vencida" : STATUS_LABEL[b.status]}</span>
      </header>

      {ok && OK_MESSAGES[ok] ? <p role="status" className={`${ui.alert} ${ui.alertOk}`} style={{ marginBottom: "1rem" }}>{OK_MESSAGES[ok]}</p> : null}
      {expired ? <p className={`${ui.alert} ${ui.alertWarn}`} style={{ marginBottom: "1rem" }}>La solicitud venció sin aprobarse. El turno se libera automáticamente y ya no puede confirmarse.</p> : null}

      <div className={styles.columns}>
        <div className={ui.stack}>
          <section className={ui.card} aria-labelledby="turno">
            <div className={ui.cardHeader}><h2 id="turno">Turno</h2></div>
            <dl className={styles.dl}>
              <dt>Cancha</dt><dd>{b.court.name}</dd>
              <dt>Fecha</dt><dd>{formatLocalDateTime(b.startsAt, tz)} a {formatLocalTime(b.endsAt, tz)}</dd>
              <dt>Duración</dt><dd>{b.durationMinutes} min</dd>
              <dt>Importe</dt><dd>{formatMoney(b.priceAmount, b.currency)}</dd>
              <dt>Abonado</dt><dd>{formatMoney(pay.balance.paid, b.currency)}</dd>
              <dt>Saldo</dt><dd>{pay.balance.due === null ? "Precio a confirmar" : pay.balance.due === 0 ? <span className={`${ui.badge} ${ui.badgeCONFIRMED}`}>Saldado</span> : <strong>{formatMoney(pay.balance.due, b.currency)}</strong>}</dd>
              {b.series ? (<><dt>Turno fijo</dt><dd>Se repite cada semana hasta el {b.series.endsOn.toISOString().slice(0, 10).split("-").reverse().join("/")}</dd></>) : null}
              <dt>Origen</dt><dd>{b.source === "ONLINE" ? "Página pública" : "Carga manual"}</dd>
              {b.status === "PENDING" && b.expiresAt ? (<><dt>Vence</dt><dd>{formatLocalDateTime(b.expiresAt, tz)}</dd></>) : null}
              {b.notes ? (<><dt>Comentario del jugador</dt><dd>{b.notes}</dd></>) : null}
              {b.cancelReason ? (<><dt>Motivo</dt><dd>{b.cancelReason}</dd></>) : null}
            </dl>
            {canManage && active ? (
              <div className={styles.actions}>
                {b.status === "PENDING" ? (
                  <>
                    <ActionForm action={confirmBookingAction.bind(null, slug)} submitLabel="Confirmar">{hidden}</ActionForm>
                    <ActionForm action={rejectBookingAction.bind(null, slug)} submitLabel="Rechazar" variant="danger" confirm={{ title: "¿Rechazar la solicitud?", body: "El turno quedará libre." }}>{hidden}</ActionForm>
                  </>
                ) : null}
                {!started ? (
                  <ActionForm action={cancelBookingAction.bind(null, slug)} submitLabel="Cancelar reserva" variant="danger" confirm={{ title: "¿Cancelar la reserva?", body: "El turno quedará libre para otros jugadores. No se puede deshacer.", confirmLabel: "Sí, cancelar" }}>
                    {hidden}
                    <input type="hidden" name="reason" value="Cancelada por el complejo" />
                  </ActionForm>
                ) : null}
                {b.status === "CONFIRMED" && started ? (
                  <>
                    <ActionForm action={completeBookingAction.bind(null, slug)} submitLabel="Marcar como jugada" variant="secondary">{hidden}</ActionForm>
                    <ActionForm action={noShowBookingAction.bind(null, slug)} submitLabel="No se presentó" variant="secondary" confirm={{ title: "¿Marcar como ausente?" }}>{hidden}</ActionForm>
                  </>
                ) : null}
              </div>
            ) : null}
          </section>

          {canManage && active && !started ? (
            <section className={ui.card} aria-labelledby="reprogramar">
              <div className={ui.cardHeader}>
                <h2 id="reprogramar">Reprogramar</h2>
                <span className={ui.muted}>Se valida horario y superposición en la base de datos</span>
              </div>
              <ActionForm action={rescheduleBookingAction.bind(null, slug)} submitLabel="Mover reserva" className={ui.stack} confirm={{ title: "¿Mover la reserva?", body: "Si el nuevo horario está ocupado, no se cambia nada." }}>
                {hidden}
                <div className={ui.grid2}>
                  <label className={ui.field}>
                    <span className={ui.label}>Cancha</span>
                    <select className={ui.select} name="courtId" defaultValue={b.courtId}>
                      {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                  <label className={ui.field}>
                    <span className={ui.label}>Fecha</span>
                    <input className={ui.input} type="date" name="date" defaultValue={local.toISODate() ?? ""} required />
                  </label>
                  <label className={ui.field}>
                    <span className={ui.label}>Hora</span>
                    <input className={ui.input} type="time" name="time" defaultValue={local.toFormat("HH:mm")} required />
                  </label>
                  <label className={ui.field}>
                    <span className={ui.label}>Duración</span>
                    <select className={ui.select} name="durationMinutes" defaultValue={b.durationMinutes}>
                      {[60, 90, 120].map((d) => <option key={d} value={d}>{d} min</option>)}
                    </select>
                  </label>
                </div>
              </ActionForm>
            </section>
          ) : null}

          <section className={ui.card} aria-labelledby="historial">
            <div className={ui.cardHeader}><h2 id="historial">Historial</h2></div>
            <ol className={styles.timeline}>
              {history.map((h) => (
                <li key={h.id}>
                  <strong>{actionLabel(h.action)}</strong>
                  <span className={ui.faint}>
                    {formatLocalDateTime(h.createdAt, tz)} · {h.actorType === "PUBLIC" ? "Jugador" : h.actorType === "SYSTEM" ? "Sistema (automático)" : h.actorName ?? "Equipo"}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className={ui.stack}>
          <section className={ui.card} aria-labelledby="jugador">
            <div className={ui.cardHeader}><h2 id="jugador">Jugador</h2></div>
            <dl className={styles.dl}>
              <dt>Nombre</dt><dd>{b.customerName}</dd>
              <dt>Teléfono</dt><dd>{b.customerPhone ? <a href={`tel:${b.customerPhone.replace(/[^0-9+]/g, "")}`}>{b.customerPhone}</a> : "—"}</dd>
              <dt>Email</dt><dd>{b.customerEmail ?? "—"}</dd>
              <dt>Reservas totales</dt><dd>{b.customer._count.bookings}</dd>
            </dl>
            <div className={ui.row}>
              {wa ? <a href={wa} target="_blank" rel="noopener noreferrer" className={`${ui.button} ${ui.buttonSmall}`}>WhatsApp</a> : null}
              <Link href={`/panel/${slug}/clientes/${b.customer.id}`} className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`}>Ver ficha del cliente</Link>
            </div>
          </section>
          <section className={ui.card} aria-labelledby="pagos">
            <div className={ui.cardHeader}><h2 id="pagos">Pagos y señas</h2><span className={ui.faint}>Registro manual</span></div>
            {pay.payments.length ? (
              <ul className={ui.stackSm} style={{ listStyle: "none", padding: 0, margin: "0 0 1rem" }}>
                {pay.payments.map((p) => (
                  <li key={p.id} className={ui.spread}>
                    <span>
                      <strong>{p.kind === "REFUND" ? "−" : ""}{formatMoney(p.amount, pay.currency)}</strong> · {KIND_LABEL[p.kind]} · {METHOD_LABEL[p.method]}
                      <div className={ui.faint}>{formatLocalDateTime(p.paidAt, tz)}{p.note ? ` · ${p.note}` : ""}</div>
                    </span>
                    {canVoid ? (
                      <ActionForm action={voidPaymentAction.bind(null, slug, b.id, p.id)} submitLabel="Anular" variant="ghost" small quietSuccess confirm={{ title: "¿Anular este pago?", body: "Se descuenta del total abonado. Queda registrado en el historial." }} />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <p className={ui.muted}>Todavía no se registraron pagos.</p>}
            {canPay ? (
              <ActionForm action={recordPaymentAction.bind(null, slug, b.id)} submitLabel="Registrar" variant="secondary" className={ui.stack} resetOnSuccess>
                <div className={ui.grid2}>
                  <label className={ui.field}><span className={ui.label}>Tipo</span>
                    <select className={ui.select} name="kind" defaultValue={pay.balance.paid === 0 ? "DEPOSIT" : "PAYMENT"}>
                      <option value="DEPOSIT">Seña</option><option value="PAYMENT">Pago</option>{pay.balance.paid > 0 ? <option value="REFUND">Devolución</option> : null}
                    </select>
                  </label>
                  <label className={ui.field}><span className={ui.label}>Medio</span>
                    <select className={ui.select} name="method" defaultValue="CASH">
                      {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
                    </select>
                  </label>
                  <label className={ui.field}><span className={ui.label}>Importe ($)</span>
                    <input className={ui.input} name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" required defaultValue={pay.balance.due ? (pay.balance.due / 100).toFixed(0) : ""} />
                  </label>
                  <label className={ui.field}><span className={ui.label}>Nota (opcional)</span>
                    <input className={ui.input} name="note" maxLength={300} placeholder="Ej.: transferencia de Juan" />
                  </label>
                </div>
              </ActionForm>
            ) : null}
          </section>

          {b.series && b.series.status === "ACTIVE" && canManage ? (
            <section className={ui.card} aria-labelledby="serie">
              <div className={ui.cardHeader}><h2 id="serie">Turno fijo</h2></div>
              <p className={ui.muted}>Podés cancelar solo esta fecha (arriba) o todas las fechas desde esta en adelante.</p>
              <ActionForm action={cancelSeriesAction.bind(null, slug, b.series.id)} submitLabel="Cancelar desde esta fecha" variant="danger" small confirm={{ title: "¿Cancelar el turno fijo?", body: "Se cancelan esta reserva y todas las siguientes de la serie. Las anteriores no se tocan.", confirmLabel: "Sí, cancelar la serie" }}>
                <input type="hidden" name="fromDate" value={local.toISODate() ?? ""} />
              </ActionForm>
            </section>
          ) : null}

          <section className={ui.card} aria-labelledby="notas">
            <div className={ui.cardHeader}><h2 id="notas">Observaciones internas</h2></div>
            {canManage ? (
              <ActionForm action={saveInternalNotesAction.bind(null, slug)} submitLabel="Guardar" variant="secondary" className={ui.stack}>
                <input type="hidden" name="bookingId" value={b.id} />
                <textarea className={ui.textarea} name="notes" maxLength={2000} defaultValue={b.internalNotes ?? ""} placeholder="Solo las ve el equipo del complejo." aria-label="Observaciones internas" />
              </ActionForm>
            ) : (
              <p className={ui.muted}>{b.internalNotes ?? "Sin observaciones."}</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
