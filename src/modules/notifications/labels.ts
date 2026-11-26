/** Nombres legibles de los tipos de email (panel de correos y auditoría). */
export const KIND_LABEL: Record<string, string> = {
  password_reset: "Recuperación de contraseña",
  email_verification: "Verificación de email",
  player_welcome: "Bienvenida al jugador",
  booking_requested: "Solicitud recibida",
  booking_awaiting_transfer: "Datos para transferir",
  booking_transfer_reported: "Transferencia informada (jugador)",
  payment_approved: "Pago aprobado",
  payment_rejected: "Pago rechazado",
  booking_confirmed: "Reserva confirmada",
  booking_rescheduled: "Reserva modificada",
  booking_cancelled: "Reserva cancelada",
  booking_rejected: "Reserva rechazada",
  booking_expired: "Reserva vencida",
  booking_reminder: "Recordatorio",
  booking_reminder_24h: "Recordatorio 24 h",
  booking_reminder_2h: "Recordatorio 2 h",
  tenant_welcome: "Bienvenida al complejo",
  team_invitation: "Invitación al equipo",
  owner_new_request: "Nueva reserva (complejo)",
  owner_transfer_reported: "Transferencia para verificar",
  owner_transfer_expiring: "Transferencia por vencer",
  owner_booking_cancelled: "Cancelación de jugador",
  owner_payment_incident: "Incidencia de pago",
  owner_subscription_notice: "Aviso de suscripción",
  owner_digest: "Resumen diario",
  admin_tenant_created: "Nuevo complejo (superadmin)",
  admin_quota_warning: "Cupo diario (superadmin)",
  admin_email_failures: "Fallas de envío (superadmin)",
  admin_test: "Correo de prueba",
};

export const STATUS_LABEL: Record<string, string> = {
  PENDING: "En cola",
  SENDING: "Enviando",
  SENT: "Aceptado por el proveedor",
  FAILED: "Falló",
  SKIPPED: "Descartado",
};

/** Motivos de descarte/aplazamiento en lenguaje claro. */
export const REASON_LABEL: Record<string, string> = {
  stale: "Ya no correspondía (la reserva cambió)",
  rescheduled: "El turno se reprogramó",
  email_disabled: "Emails desactivados en el servidor",
  tenant_disabled: "El complejo desactivó los emails",
  tenant_inactive: "Complejo suspendido o archivado",
  players_disabled: "El complejo desactivó los avisos a jugadores",
  owner_disabled: "El complejo desactivó sus avisos",
  owner_muted: "El complejo apagó este tipo de aviso",
  player_opted_out: "El jugador desactivó los emails",
  player_no_reminders: "El jugador desactivó los recordatorios",
  quota_exhausted: "Sin cupo diario",
  already_verified: "El email ya estaba verificado",
  invitation_closed: "La invitación ya no está vigente",
  missing_link: "Enlace no disponible",
  not_superadmin: "El destinatario ya no es superadmin",
  renewed: "La suscripción ya se renovó",
  user_inactive: "Cuenta suspendida o eliminada",
};

/** Tipos que se pueden reintentar a mano (los que llevan un enlace secreto no: el enlace ya se borró). */
export const NON_RETRYABLE_KINDS = new Set(["password_reset", "email_verification", "team_invitation"]);

export function reasonLabel(raw: string | null): string {
  if (!raw) return "";
  const key = raw.split(":")[0]!.trim();
  return REASON_LABEL[key] ?? raw;
}

/** Oculta parte de la dirección: ju***@gmail.com */
export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 2)}${user.length > 2 ? "***" : ""}@${domain}`;
}
