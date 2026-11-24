import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { SPORT_LABEL } from "@/components/player/ComplexCard";
import { PlayerShell } from "@/components/player/PlayerShell";
import styles from "@/components/player/player.module.css";
import ui from "@/components/ui.module.css";
import { getCurrentUser } from "@/lib/auth/dal";
import { formatMoney } from "@/modules/booking/pricing";
import { listPlayerBookings, type PlayerBooking } from "@/modules/player/bookings";
import { STATUS_LABEL } from "../panel/[slug]/labels";
import { cancelMyBookingAction, claimBookingAction, reviewAction } from "../cuenta/actions";

export const metadata: Metadata = { title: "Mis turnos — TURNUP" };

function when(b: PlayerBooking) {
  const o = { timeZone: b.tenantTimezone } as const;
  return `${b.startsAt.toLocaleDateString("es-AR", { ...o, weekday: "long", day: "numeric", month: "long" })} · ${b.startsAt.toLocaleTimeString("es-AR", { ...o, hour: "2-digit", minute: "2-digit" })} hs`;
}

function Turn({ b }: { b: PlayerBooking }) {
  return (
    <li className={styles.turn}>
      <div className={styles.turnHead}>
        <div>
          <strong><Link href={`/${b.tenantSlug}`} className={ui.linkPlain}>{b.tenantName}</Link></strong>
          <div className={styles.meta}>{when(b)}</div>
          <div className={styles.meta}>{b.courtName} · {SPORT_LABEL[b.sport] ?? b.sport} · {b.durationMinutes} min{b.priceAmount !== null ? ` · ${formatMoney(b.priceAmount, b.currency)}` : ""}</div>
          {b.tenantAddress ? <div className={styles.meta}>{b.tenantAddress}</div> : null}
        </div>
        <span className={`${ui.badge} ${ui[`badge${b.status}` as keyof typeof ui] ?? ""}`}>{STATUS_LABEL[b.status as keyof typeof STATUS_LABEL] ?? b.status}</span>
      </div>
      <div className={styles.meta}>Código <strong>{b.code}</strong></div>
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
  const now = new Date();
  const upcoming = all.filter((b) => b.endsAt > now && (b.status === "CONFIRMED" || b.status === "PENDING")).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const past = all.filter((b) => !upcoming.includes(b));

  return (
    <PlayerShell user={user}>
      <h1 className={styles.hello}>Mis turnos</h1>
      <section className={styles.section} aria-labelledby="proximos">
        <div className={styles.sectionHead}><h2 id="proximos">Próximos</h2><Link href="/explorar">Reservar otro</Link></div>
        {upcoming.length ? <ul className={styles.turns}>{upcoming.map((b) => <Turn key={b.id} b={b} />)}</ul> : <p className={styles.empty}>No tenés turnos próximos. <Link href="/explorar">Buscá dónde jugar</Link></p>}
      </section>
      <section className={styles.section} aria-labelledby="historial">
        <div className={styles.sectionHead}><h2 id="historial">Historial</h2></div>
        {past.length ? <ul className={styles.turns}>{past.map((b) => <Turn key={b.id} b={b} />)}</ul> : <p className={styles.empty}>Todavía no hay turnos jugados.</p>}
      </section>
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
