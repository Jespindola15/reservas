"use client";

import { useEffect, useState } from "react";
import ui from "@/components/ui.module.css";
import styles from "./transfer.module.css";

export type TransferData = {
  alias: string | null;
  cbuCvu: string | null;
  holderName: string | null;
  bankName: string | null;
  instructions: string | null;
};

export const NOT_CONFIRMED_MESSAGE =
  "Tu turno todavía no está confirmado. Realizá la transferencia e informá el pago para que el complejo pueda verificarlo.";

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

/** Cuenta regresiva hasta `deadline`; devuelve el texto "mm:ss" o "h h mm min". */
export function useCountdown(deadline: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [deadline]);
  if (!deadline) return { left: null as number | null, label: "" };
  const left = Math.max(0, new Date(deadline).getTime() - now);
  const totalMin = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  const label = totalMin >= 60 ? `${Math.floor(totalMin / 60)} h ${String(totalMin % 60).padStart(2, "0")} min` : `${String(totalMin).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return { left, label };
}

function CopyRow({ label, value, copyValue }: { label: string; value: string; copyValue?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.copyRow}>
      <div className={styles.copyText}>
        <span className={ui.label}>{label}</span>
        <strong className={styles.copyValue}>{value}</strong>
      </div>
      <button
        type="button"
        className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`}
        aria-label={`Copiar ${label.toLowerCase()}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(copyValue ?? value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

/**
 * Datos para transferir al complejo. TURNUP no recibe ni intermedia el dinero: el jugador
 * transfiere directo a la cuenta del complejo y el complejo verifica el pago manualmente.
 */
export function TransferPanel(props: {
  transfer: TransferData;
  amountDue: number;
  currency: string;
  code: string;
  /** Plazo para transferir (o para que el complejo revise, si ya se informó). */
  deadline: string | null;
  reported: boolean;
  timezone: string;
}) {
  const { left, label } = useCountdown(props.deadline);
  const timeFmt = new Intl.DateTimeFormat("es-AR", { timeZone: props.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const expired = left !== null && left <= 0;
  return (
    <div className={styles.panel}>
      {props.reported ? (
        <p className={`${ui.alert} ${ui.alertInfo}`} role="status">
          Informaste la transferencia. El complejo la está verificando: el turno se confirma recién cuando el complejo verifique el pago.
        </p>
      ) : (
        <p className={`${ui.alert} ${ui.alertWarn}`} role="status">{NOT_CONFIRMED_MESSAGE}</p>
      )}
      {props.deadline ? (
        <div className={styles.countdown} aria-live="off">
          <span className={ui.label}>{props.reported ? "Plazo de verificación del complejo" : "Tiempo para transferir"}</span>
          <strong className={expired ? styles.countExpired : styles.countValue}>{expired ? "Vencido" : label}</strong>
          <span className={ui.faint}>
            {expired
              ? "El plazo terminó. Si ya transferiste, comunicate con el complejo."
              : `Hasta las ${timeFmt.format(new Date(props.deadline))} hs. Si vence, el turno se libera.`}
          </span>
        </div>
      ) : null}
      <CopyRow label="Importe a transferir" value={formatMoney(props.amountDue, props.currency)} copyValue={String(Math.round(props.amountDue / 100))} />
      {props.transfer.alias ? <CopyRow label="Alias" value={props.transfer.alias} /> : null}
      {props.transfer.cbuCvu ? <CopyRow label="CBU / CVU" value={props.transfer.cbuCvu} /> : null}
      <CopyRow label="Código de reserva (ponelo en el concepto)" value={props.code} />
      <dl className={styles.dl}>
        {props.transfer.holderName ? (<><dt>Titular</dt><dd>{props.transfer.holderName}</dd></>) : null}
        {props.transfer.bankName ? (<><dt>Banco / billetera</dt><dd>{props.transfer.bankName}</dd></>) : null}
      </dl>
      {props.transfer.instructions ? <p className={styles.instructions}>{props.transfer.instructions}</p> : null}
      <p className={ui.faint}>
        La transferencia va directo a la cuenta del complejo. TURNUP no recibe ni retiene dinero; cualquier devolución la gestiona el complejo.
      </p>
    </div>
  );
}
