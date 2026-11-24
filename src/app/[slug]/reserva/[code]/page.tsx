import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { TopBar } from "@/components/TopBar";
import ui from "@/components/ui.module.css";
import { isAppError, toPublicError } from "@/lib/errors";
import { enforceIpRateLimit } from "@/lib/http";
import { getClientIp } from "@/lib/security/client-ip";
import { formatMoney } from "@/modules/booking/pricing";
import { getPublicBooking } from "@/modules/booking/public-access";
import { formatLocalDateTime, formatLocalTime } from "@/modules/booking/time";
import { SPORT_LABEL } from "@/modules/courts/service";
import { cancelOwnBookingAction } from "./actions";
import styles from "../../public.module.css";

// Página privada: no indexar ni cachear. La URL contiene el token del jugador.
export const metadata: Metadata = { title: "Tu reserva", robots: { index: false, follow: false } };

const STATUS: Record<string, { label: string; text: string }> = {
  PENDING: { label: "Pendiente de aprobación", text: "El complejo todavía no confirmó tu solicitud." },
  CONFIRMED: { label: "Confirmada", text: "¡Listo! Te esperamos en la cancha." },
  CANCELLED: { label: "Cancelada", text: "Esta reserva fue cancelada." },
  REJECTED: { label: "Rechazada", text: "El complejo no pudo aceptar esta solicitud." },
  EXPIRED: { label: "Vencida", text: "La solicitud no se aprobó a tiempo y el turno se liberó." },
  COMPLETED: { label: "Jugada", text: "¡Gracias por venir!" },
  NO_SHOW: { label: "Ausente", text: "El complejo registró que no te presentaste." },
};

export default async function TrackingPage({ params, searchParams }: { params: Promise<{ slug: string; code: string }>; searchParams: Promise<{ t?: string; cancelada?: string }> }) {
  const { slug, code } = await params;
  const { t = "", cancelada } = await searchParams;
  let view;
  let error: string | null = null;
  try {
    await enforceIpRateLimit(getClientIp(await headers()), "publink", { window: 600, max: 60 });
    view = await getPublicBooking(slug, code, t);
  } catch (e) {
    if (!isAppError(e)) throw e;
    error = toPublicError(e).body.message;
  }

  return (
    <>
      <TopBar />
      <main className={`${ui.container} ${ui.page}`}>
        <div className={styles.trackCard}>
          {!view ? (
            <section className={ui.card}>
              <h1>No pudimos mostrar la reserva</h1>
              <p className={ui.muted}>{error}</p>
              <p className={ui.faint}>Por seguridad, la reserva solo se puede consultar con el enlace completo que recibiste al reservar.</p>
              <Link className={ui.button} href={`/${slug}`}>Ir al complejo</Link>
            </section>
          ) : (
            <section className={ui.card} aria-labelledby="t">
              <p className={ui.eyebrow}>{view.tenant.name}</p>
              <h1 id="t">Hola, {view.firstName}</h1>
              <div className={ui.spread} style={{ margin: "0.75rem 0 1rem" }}>
                <span className={`${ui.badge} ${ui[`badge${view.status}`] ?? ""}`}>{STATUS[view.status]?.label}</span>
                <span className={styles.code}>{view.code}</span>
              </div>
              {cancelada && view.status === "CANCELLED" ? <p role="status" className={`${ui.alert} ${ui.alertOk}`}>Tu reserva fue cancelada. El turno quedó libre.</p> : null}
              <p>{STATUS[view.status]?.text}</p>
              <dl className={styles.dl}>
                <dt>Cancha</dt><dd>{view.court.name} · {SPORT_LABEL[view.court.sport]}</dd>
                <dt>Turno</dt><dd>{formatLocalDateTime(view.startsAt, view.tenant.timezone)} a {formatLocalTime(view.endsAt, view.tenant.timezone)}</dd>
                <dt>Precio</dt><dd>{formatMoney(view.priceAmount, view.currency)} <span className={ui.faint}>(se abona en el complejo)</span></dd>
                {view.expiresAt ? (<><dt>Aprobación</dt><dd>Si no se confirma antes de {formatLocalDateTime(view.expiresAt, view.tenant.timezone)}, el turno se libera.</dd></>) : null}
                {view.tenant.address ? (<><dt>Dirección</dt><dd>{view.tenant.address}</dd></>) : null}
                {view.tenant.contactPhone ? (<><dt>Contacto</dt><dd>{view.tenant.contactPhone}</dd></>) : null}
              </dl>
              {view.canCancel ? (
                <ActionForm
                  action={cancelOwnBookingAction.bind(null, slug, view.code, t)}
                  submitLabel="Cancelar mi reserva"
                  variant="danger"
                  className={ui.stack}
                  confirm={{ title: "¿Cancelar tu reserva?", body: "El turno quedará libre para otra persona. No se puede deshacer.", confirmLabel: "Sí, cancelar" }}
                >
                  <p className={ui.faint}>Podés cancelar online hasta {formatLocalDateTime(view.cancellationDeadline, view.tenant.timezone)}.</p>
                </ActionForm>
              ) : view.status === "PENDING" || view.status === "CONFIRMED" ? (
                <p className={`${ui.alert} ${ui.alertInfo}`}>El plazo para cancelar online terminó. Comunicate con el complejo.</p>
              ) : null}
              <p className={ui.faint} style={{ marginTop: "1rem" }}>Guardá este enlace: es la única forma de consultar o cancelar tu reserva. No lo compartas.</p>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
