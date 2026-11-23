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
              <dt>Importe</dt><dd>{formatMoney(b.priceAmount, b.currency)} <span className={ui.faint}>(precio congelado al reservar, no cobrado)</span></dd>
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
            <Link href={`/panel/${slug}/clientes/${b.customer.id}`} className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`}>Ver ficha del cliente</Link>
          </section>
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
