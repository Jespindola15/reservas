export const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
  REJECTED: "Rechazada",
  COMPLETED: "Jugada",
  NO_SHOW: "No se presentó",
  EXPIRED: "Vencida",
};

const ACTIONS: Record<string, string> = {
  "booking.created": "Reserva creada",
  "booking.status.confirmed": "Reserva confirmada",
  "booking.status.cancelled": "Reserva cancelada",
  "booking.status.rejected": "Solicitud rechazada",
  "booking.status.expired": "Solicitud vencida (turno liberado)",
  "booking.status.completed": "Marcada como jugada",
  "booking.status.no_show": "Marcada como ausente",
  "booking.rescheduled": "Reserva reprogramada",
  "booking.internal_notes.updated": "Observaciones actualizadas",
  "booking.public_cancelled": "Cancelada por el jugador",
};

export function actionLabel(action: string): string {
  return ACTIONS[action] ?? action;
}
