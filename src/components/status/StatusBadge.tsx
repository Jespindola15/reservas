import ui from "@/components/ui.module.css";

/**
 * Estado de una reserva combinado con su estado de pago, igual en las tres interfaces.
 * Una transferencia INFORMADA nunca se muestra como pagada: solo "verificado" lo es.
 */
export const BOOKING_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendiente de aprobación",
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
  REJECTED: "Rechazada",
  EXPIRED: "Vencida",
  COMPLETED: "Jugada",
  NO_SHOW: "No asistió",
};
export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  AWAITING_TRANSFER: "Esperando transferencia",
  TRANSFER_REPORTED: "Transferencia informada",
  VERIFIED: "Pago verificado",
};

export function statusKey(status: string, paymentStatus?: string | null) {
  if (status === "PENDING" && (paymentStatus === "AWAITING_TRANSFER" || paymentStatus === "TRANSFER_REPORTED")) return paymentStatus;
  return status;
}

export function statusLabel(status: string, paymentStatus?: string | null) {
  const k = statusKey(status, paymentStatus);
  return PAYMENT_STATUS_LABEL[k] ?? BOOKING_STATUS_LABEL[k] ?? k;
}

export function StatusBadge({ status, paymentStatus, showPayment = false }: { status: string; paymentStatus?: string | null; showPayment?: boolean }) {
  const k = statusKey(status, paymentStatus);
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      <span className={`${ui.badge} ${ui[`badge${k}`] ?? ""}`}>{statusLabel(status, paymentStatus)}</span>
      {showPayment && status === "CONFIRMED" && paymentStatus === "VERIFIED" ? <span className={`${ui.badge} ${ui.badgeVERIFIED}`}>Pago verificado</span> : null}
    </span>
  );
}
