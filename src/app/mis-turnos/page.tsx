import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { SPORT_LABEL } from "@/components/player/ComplexCard";
import { PlayerShell } from "@/components/player/PlayerShell";
import styles from "@/components/player/player.module.css";
import ui from "@/components/ui.module.css";
import { getCurrentUser } from "@/lib/auth/dal";
import { formatMoney } from "@/modules/booking/pricing";
import { TransferPanel, type TransferData } from "@/components/transfer/TransferPanel";
import { listPlayerBookings, playerTransferInfos, type PlayerBooking } from "@/modules/player/bookings";
import { STATUS_LABEL } from "../panel/[slug]/labels";
import { cancelMyBookingAction, claimBookingAction, reportMyTransferAction, reviewAction } from "../cuenta/actions";

export const metadata: Metadata = { title: "Mis turnos — TURNUP" };

function when(b: PlayerBooking) {
  const o = { timeZone: b.tenantTimezone } as const;
  return `${b.startsAt.toLocaleDateString("es-AR", { ...o, weekday: "long", day: "numeric", month: "long" })} · ${b.startsAt.toLocaleTimeString("es-AR", { ...o, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} hs`;
}

const PAY_LABEL: Record<string, string> = { AWAITING_TRANSFER: "Pendiente de transferencia", TRANSFER_REPORTED: "Transferencia informada" };

function Turn({ b, transfer }: { b: PlayerBooking; transfer?: TransferData | null }) {
  const payLabel = b.status === "PENDING" && b.paymentStatus ? PAY_LABEL[b.paymentStatus] : undefined;
  return (
    <li className={styles.turn}>
      <div className={styles.turnHead}>
        <div>
          <strong><Link href={`/${b.tenantSlug}`} className={ui.linkPlain}>{b.tenantName}</Link></strong>
          <div className={styles.meta}>{when(b)}</div>
          <div className={styles.meta}>{b.courtName} · {SPORT_LABEL[b.sport] ?? b.sport} · {b.durationMinutes} min{b.priceAmount !== null ? ` · ${formatMoney(b.priceAmount, b.currency)}` : ""}</div>
          {b.tenantAddress ? <div className={styles.meta}>{b.tenantAddress}</div> : null}
        </div>
        <span className={`${ui.badge} ${ui[`badge${b.status}` as keyof typeof ui] ?? ""}`}>{payLabel ?? STATUS_LABEL[b.status as keyof typeof STATUS_LABEL] ?? b.status}</span>
      </div>
      <div className={styles.meta}>Código <strong>{b.code}</strong>{b.status === "CONFIRMED" && b.paymentStatus === "VERIFIED" ? " · Pago verificado por el complejo" : ""}</div>
      {b.status === "PENDING" && b.amountDue && (b.paymentStatus === "AWAITING_TRANSFER" || b.paymentStatus === "TRANSFER_REPORTED") ? (
        <details open={b.paymentStatus === "AWAITING_TRANSFER"}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>{b.paymentStatus === "AWAITING_TRANSFER" ? "Datos para transferir" : "Estado de la transferencia"}</summary>
          <div className={ui.stack} style={{ marginTop: "0.75rem" }}>
            {transfer || b.paymentStatus === "TRANSFER_REPORTED" ? (
              <TransferPanel transfer={transfer ?? { alias: null, cbuCvu: null, holderName: null, bankName: null, instructions: null }} amountDue={b.amountDue} currency={b.currency} code={b.code}
                deadline={b.expiresAt ? b.expiresAt.toISOString() : null} reported={b.paymentStatus === "TRANSFER_REPORTED"} timezone={b.tenantTimezone} />
            ) : <p className={`${ui.alert} ${ui.alertWarn}`}>El complejo no tiene datos de cobro cargados. Comunicate con el complejo.</p>}
            {b.paymentStatus === "AWAITING_TRANSFER" ? (
              <ActionForm action={reportMyTransferAction.bind(null, b.id)} submitLabel="Ya realicé la transferencia" className={ui.stack}
                confirm={{ title: "¿Ya transferiste?", body: "Avisaremos al complejo para que verifique el pago.", confirmLabel: "Sí, ya transferí" }}>
                <label className={ui.field}>
                  <span className={ui.label}>Número de operación (opcional)</span>
                  <input className={ui.input} name="reference" maxLength={40} autoComplete="off" />
                </label>
              </ActionForm>
            ) : null}
          </div>
        </details>
      ) : null}
      <div className={styles.turnActions}>
        {b.canCancel ? (
          <ActionForm
            action={cancelMyBookingAction.bind(null, b.id)}
            submitLabel="Cancelar turno"
            variant="danger"
            small
            confirm={{ title: "¿Cancelar este turno?", body: `${b.tenantName} · ${when(b)}. El horario queda libre para otros jugadores.`, confirmLabel: "Sí, cancelar" }}
          />
        ) : null}
        {b.reviewRating !== null ? <span className={styles.meta}>Tu opinión: <span className={styles.rating}>{"★".repeat(b.reviewRating)}</span></span> : null}
      </div>
      {b.canReview ? (
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Opinar sobre {b.tenantName}</summary>
          <ActionForm action={reviewAction.bind(null, b.id)} submitLabel="Publicar opinión" className={ui.stack}>
            <fieldset style={{ border: 0, padding: 0, margin: "0.5rem 0 0" }}>
              <legend className={ui.label}>Calificación</legend>
              <div className={ui.row}>
                {[5, 4, 3, 2, 1].map((n) => (
                  <label key={n} className={ui.checkbox}><input type="radio" name="rating" value={n} required defaultChecked={n === 5} />{"★".repeat(n)}<span className="sr-only">{n} de 5</span></label>
                ))}
              </div>
            </fieldset>
            <label className={ui.field}><span className={ui.label}>Comentario (opcional)</span><textarea className={ui.textarea} name="comment" maxLength={1000} /></label>
            <span className={ui.faint}>Tu opinión se publica con tu nombre abreviado. El complejo puede responderla.</span>
          </ActionForm>
        </details>
      ) : null}
    </li>
  );
}

export default async function MyBookings() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return (
      <PlayerShell user={null}>
        <h1 className={styles.hello}>Mis turnos</h1>
        <div className={styles.empty}>
          <p>Ingresá para ver tus reservas en todos los complejos.</p>
          <div className={ui.row} style={{ justifyContent: "center" }}>
            <Link className={ui.button} href="/cuenta/ingresar?next=/mis-turnos">Ingresar</Link>
            <Link className={`${ui.button} ${ui.buttonSecondary}`} href="/cuenta/registro?next=/mis-turnos">Crear cuenta</Link>
          </div>
          <p className={ui.faint}>¿Reservaste como invitado? Abrí el enlace privado que recibiste al reservar.</p>
        </div>
      </PlayerShell>
    );
  }
  const all = await listPlayerBookings(user.id);
  const transfers = await playerTransferInfos(user.id, all);
  const now = new Date();
  const byStart = (a: PlayerBooking, b: PlayerBooking) => a.startsAt.getTime() - b.startsAt.getTime();
  const live = all.filter((b) => b.endsAt > now && (b.status === "CONFIRMED" || b.status === "PENDING"));
  const awaiting = live.filter((b) => b.status === "PENDING" && b.paymentStatus === "AWAITING_TRANSFER").sort(byStart);
  const reviewing = live.filter((b) => b.status === "PENDING" && b.paymentStatus === "TRANSFER_REPORTED").sort(byStart);
  const upcoming = live.filter((b) => !awaiting.includes(b) && !reviewing.includes(b)).sort(byStart);
  const cancelled = all.filter((b) => !live.includes(b) && (b.status === "CANCELLED" || b.status === "REJECTED" || b.status === "EXPIRED"));
  const past = all.filter((b) => !live.includes(b) && !cancelled.includes(b));

  return (
    <PlayerShell user={user}>
      <h1 className={styles.hello}>Mis turnos</h1>
      {awaiting.length ? (
        <section className={styles.section} aria-labelledby="transferir">
          <div className={styles.sectionHead}><h2 id="transferir">Pendientes de transferencia</h2></div>
          <p className={ui.faint}>Tu turno todavía no está confirmado. Realizá la transferencia e informá el pago para que el complejo pueda verificarlo.</p>
          <ul className={styles.turns}>{awaiting.map((b) => <Turn key={b.id} b={b} transfer={transfers.get(b.tenantId) ?? null} />)}</ul>
        </section>
      ) : null}
      {reviewing.length ? (
        <section className={styles.section} aria-labelledby="verificando">
          <div className={styles.sectionHead}><h2 id="verificando">Pendientes de verificación</h2></div>
          <ul className={styles.turns}>{reviewing.map((b) => <Turn key={b.id} b={b} />)}</ul>
        </section>
      ) : null}
      <section className={styles.section} aria-labelledby="proximos">
        <div className={styles.sectionHead}><h2 id="proximos">Próximos</h2><Link href="/explorar">Reservar otro</Link></div>
        {upcoming.length ? <ul className={styles.turns}>{upcoming.map((b) => <Turn key={b.id} b={b} />)}</ul> : <p className={styles.empty}>No tenés turnos próximos. <Link href="/explorar">Buscá dónde jugar</Link></p>}
      </section>
      <section className={styles.section} aria-labelledby="historial">
        <div className={styles.sectionHead}><h2 id="historial">Historial</h2></div>
        {past.length ? <ul className={styles.turns}>{past.map((b) => <Turn key={b.id} b={b} />)}</ul> : <p className={styles.empty}>Todavía no hay turnos jugados.</p>}
      </section>
      {cancelled.length ? (
        <section className={styles.section} aria-labelledby="canceladas">
          <div className={styles.sectionHead}><h2 id="canceladas">Canceladas y vencidas</h2></div>
          <ul className={styles.turns}>{cancelled.map((b) => <Turn key={b.id} b={b} />)}</ul>
        </section>
      ) : null}
      <section className={styles.section} aria-labelledby="vincular">
        <div className={styles.sectionHead}><h2 id="vincular">¿Reservaste sin cuenta?</h2></div>
        <ActionForm action={claimBookingAction} submitLabel="Vincular reserva" className={ui.stack} resetOnSuccess>
          <label className={ui.field}>
            <span className={ui.label}>Enlace privado de la reserva</span>
            <input className={ui.input} name="link" required maxLength={500} placeholder="https://…/complejo/reserva/ABCD2345?t=…" />
            <span className={ui.hint}>Es el enlace que recibiste al reservar como invitado. Solo con ese enlace se puede probar que la reserva es tuya.</span>
          </label>
        </ActionForm>
      </section>
    </PlayerShell>
  );
}
