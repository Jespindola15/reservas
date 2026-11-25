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
import { ForgetPending } from "@/components/transfer/ForgetPending";
import { TransferPanel } from "@/components/transfer/TransferPanel";
import { whatsappLink } from "@/lib/contact/whatsapp";
import { cancelOwnBookingAction, reportTransferAction } from "./actions";
import styles from "../../public.module.css";

// Página privada: no indexar ni cachear. La URL contiene el token del jugador.
export const metadata: Metadata = { title: "Tu reserva", robots: { index: false, follow: false }, referrer: "no-referrer" };

const PAYMENT: Record<string, { label: string; text: string }> = {
  AWAITING_TRANSFER: { label: "Pendiente de transferencia", text: "Tu turno todavía no está confirmado. Realizá la transferencia e informá el pago para que el complejo pueda verificarlo." },
  TRANSFER_REPORTED: { label: "Transferencia informada", text: "Informaste la transferencia. El turno se confirma cuando el complejo verifique el pago." },
};

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
          ) : view.transfer && view.amountDue && view.status === "PENDING" ? (
            // Pantalla exclusiva para completar la transferencia: sin ficha comercial, opiniones ni canchas.
            <section className={`${ui.card} ${styles.transferScreen}`} aria-labelledby="t">
              <p className={ui.eyebrow}>{view.tenant.name}</p>
              <h1 id="t">{view.paymentStatus === "TRANSFER_REPORTED" ? "Estamos esperando que el complejo verifique tu pago" : "Completá la transferencia"}</h1>
              <dl className={styles.dl} aria-label="Resumen de la reserva">
                <dt>Código</dt><dd><span className={styles.code}>{view.code}</span></dd>
                <dt>Turno</dt><dd>{formatLocalDateTime(view.startsAt, view.tenant.timezone)} a {formatLocalTime(view.endsAt, view.tenant.timezone)} hs</dd>
                <dt>Cancha</dt><dd>{view.court.name} · {SPORT_LABEL[view.court.sport]}</dd>
                <dt>Precio del turno</dt><dd>{formatMoney(view.priceAmount, view.currency)}</dd>
                {view.priceAmount !== null && view.amountDue < view.priceAmount ? (<><dt>Saldo en el complejo</dt><dd>{formatMoney(view.priceAmount - view.amountDue, view.currency)}</dd></>) : null}
              </dl>
              <TransferPanel
                transfer={view.transfer}
                amountDue={view.amountDue}
                currency={view.currency}
                code={view.code}
                deadline={view.expiresAt ? view.expiresAt.toISOString() : null}
                reported={view.paymentStatus === "TRANSFER_REPORTED"}
                timezone={view.tenant.timezone}
                serverNow={view.serverNow.toISOString()}
              />
              {view.paymentStatus !== "AWAITING_TRANSFER" ? <ForgetPending code={view.code} /> : null}
              {view.paymentStatus === "AWAITING_TRANSFER" ? (
                <ActionForm action={reportTransferAction.bind(null, slug, view.code, t)} submitLabel="Ya realicé la transferencia" className={ui.stack}
                  confirm={{ title: "¿Ya transferiste?", body: "Avisaremos al complejo para que verifique el pago. Informalo solo si la transferencia ya fue enviada.", confirmLabel: "Sí, ya transferí" }}>
                  <label className={ui.field}>
                    <span className={ui.label}>Número de operación (opcional)</span>
                    <input className={ui.input} name="reference" maxLength={40} inputMode="text" autoComplete="off" />
                    <span className={ui.hint}>Lo encontrás en el comprobante de tu banco o billetera. Ayuda al complejo a encontrar tu pago.</span>
                  </label>
                </ActionForm>
              ) : null}
              <ContactComplex name={view.tenant.name} phone={view.tenant.contactPhone} code={view.code} />
              <p className={ui.faint} style={{ marginTop: "var(--sp-4)" }}>
                Guardá este enlace: es la única forma de volver a esta pantalla si no tenés cuenta. No lo compartas.
                {view.canCancel ? <> ¿Te equivocaste de horario? <a href="#cancelar">Cancelar la reserva</a>.</> : null}
              </p>
              {view.canCancel ? (
                <div id="cancelar">
                  <ActionForm action={cancelOwnBookingAction.bind(null, slug, view.code, t)} submitLabel="Cancelar mi reserva" variant="ghost" small
                    confirm={{ title: "¿Cancelar tu reserva?", body: "El turno quedará libre para otra persona. Si ya transferiste, comunicate con el complejo para la devolución.", confirmLabel: "Sí, cancelar" }} />
                </div>
              ) : null}
            </section>
          ) : (
            <section className={ui.card} aria-labelledby="t">
              <p className={ui.eyebrow}>{view.tenant.name}</p>
              <h1 id="t">Hola, {view.firstName}</h1>
              <div className={ui.spread} style={{ margin: "0.75rem 0 1rem" }}>
                <span className={`${ui.badge} ${ui[`badge${view.status}`] ?? ""}`}>
                  {view.status === "PENDING" && PAYMENT[view.paymentStatus ?? ""] ? PAYMENT[view.paymentStatus ?? ""]!.label : STATUS[view.status]?.label}
                </span>
                <span className={styles.code}>{view.code}</span>
              </div>
              {cancelada && view.status === "CANCELLED" ? <p role="status" className={`${ui.alert} ${ui.alertOk}`}>Tu reserva fue cancelada. El turno quedó libre.</p> : null}
              <p>{view.status === "PENDING" && PAYMENT[view.paymentStatus ?? ""] ? PAYMENT[view.paymentStatus ?? ""]!.text : STATUS[view.status]?.text}</p>
              {view.status === "CONFIRMED" && view.paymentStatus === "VERIFIED" ? <p className={ui.faint}>El complejo verificó tu transferencia.</p> : null}
              {view.status === "EXPIRED" && view.paymentStatus === "TRANSFER_REPORTED" ? (
                <div className={`${ui.alert} ${ui.alertWarn}`} role="status">
                  <strong>El complejo no llegó a verificar tu transferencia a tiempo y el turno se liberó.</strong>
                  <p style={{ margin: "0.4rem 0 0" }}>
                    Si transferiste, el dinero está en la cuenta del complejo: comunicate con {view.tenant.name} indicando el código {view.code} para
                    que te reprogramen el turno o te devuelvan el importe. TURNUP no recibe ni devuelve dinero.
                  </p>
                </div>
              ) : null}
              {view.status === "EXPIRED" && view.paymentStatus === "AWAITING_TRANSFER" ? (
                <p className={`${ui.alert} ${ui.alertInfo}`}>No se informó la transferencia dentro del plazo. Si igualmente transferiste, comunicate con el complejo.</p>
              ) : null}
              {view.transfer && view.amountDue ? (
                <div className={ui.stack} style={{ margin: "1rem 0" }}>
                  <TransferPanel
                    transfer={view.transfer}
                    amountDue={view.amountDue}
                    currency={view.currency}
                    code={view.code}
                    deadline={view.expiresAt ? view.expiresAt.toISOString() : null}
                    reported={view.paymentStatus === "TRANSFER_REPORTED"}
                    timezone={view.tenant.timezone}
                  />
                  {view.paymentStatus === "AWAITING_TRANSFER" ? (
                    <ActionForm action={reportTransferAction.bind(null, slug, view.code, t)} submitLabel="Ya realicé la transferencia" className={ui.stack}
                      confirm={{ title: "¿Ya transferiste?", body: "Avisaremos al complejo para que verifique el pago. Informalo solo si la transferencia ya fue enviada.", confirmLabel: "Sí, ya transferí" }}>
                      <label className={ui.field}>
                        <span className={ui.label}>Número de operación (opcional)</span>
                        <input className={ui.input} name="reference" maxLength={40} inputMode="text" autoComplete="off" />
                      </label>
                    </ActionForm>
                  ) : null}
                </div>
              ) : null}
              <dl className={styles.dl}>
                <dt>Cancha</dt><dd>{view.court.name} · {SPORT_LABEL[view.court.sport]}</dd>
                <dt>Turno</dt><dd>{formatLocalDateTime(view.startsAt, view.tenant.timezone)} a {formatLocalTime(view.endsAt, view.tenant.timezone)}</dd>
                <dt>Precio</dt><dd>{formatMoney(view.priceAmount, view.currency)}</dd>
                {view.amountDue ? (<><dt>{view.amountDue === view.priceAmount ? "A transferir" : "Seña a transferir"}</dt><dd>{formatMoney(view.amountDue, view.currency)}{view.priceAmount !== null && view.amountDue < view.priceAmount ? <span className={ui.faint}> · saldo {formatMoney(view.priceAmount - view.amountDue, view.currency)} en el complejo</span> : null}</dd></>) : null}
                {view.expiresAt && !view.transfer ? (<><dt>Aprobación</dt><dd>Si no se confirma antes de {formatLocalDateTime(view.expiresAt, view.tenant.timezone)}, el turno se libera.</dd></>) : null}
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
              <ContactComplex name={view.tenant.name} phone={view.tenant.contactPhone} code={view.code} />
              <ForgetPending code={view.code} />
              <p className={ui.faint} style={{ marginTop: "1rem" }}>Guardá este enlace: es la única forma de consultar o cancelar tu reserva. No lo compartas.</p>
            </section>
          )}
        </div>
      </main>
    </>
  );
}

/** Botones para hablar con el complejo (abren WhatsApp o el teléfono; TURNUP no envía nada solo). */
function ContactComplex({ name, phone, code }: { name: string; phone: string | null; code: string }) {
  if (!phone) return null;
  const wa = whatsappLink(phone, `Hola, te escribo por mi reserva ${code} en ${name}.`);
  return (
    <div className={ui.row} style={{ marginTop: "var(--sp-3)" }}>
      {wa ? <a className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} href={wa} target="_blank" rel="noopener noreferrer">WhatsApp al complejo</a> : null}
      <a className={`${ui.button} ${ui.buttonGhost} ${ui.buttonSmall}`} href={`tel:${phone.replace(/[^0-9+]/g, "")}`}>Llamar</a>
    </div>
  );
}
