/**
 * Textos en castellano de los eventos de auditoría. El nombre técnico (p. ej. booking.transfer.reported)
 * queda solo en la base y en los registros; en la interfaz siempre se muestra esta traducción.
 */
const ACTIONS: Record<string, string> = {
  // Reservas
  "booking.created": "Reserva creada",
  "booking.status.pending": "Reserva marcada como pendiente",
  "booking.status.confirmed": "Reserva confirmada",
  "booking.status.cancelled": "Reserva cancelada",
  "booking.status.rejected": "Solicitud rechazada",
  "booking.status.expired": "Solicitud vencida (turno liberado)",
  "booking.status.completed": "Marcada como jugada",
  "booking.status.no_show": "Marcada como ausente",
  "booking.rescheduled": "Reserva reprogramada",
  "booking.internal_notes.updated": "Nota interna actualizada",
  "booking.public_cancelled": "Cancelada por el jugador (enlace privado)",
  "booking.player_cancelled": "Cancelada por el jugador (Mis turnos)",
  "booking.claimed_by_player": "Vinculada a la cuenta del jugador",
  "booking.payment.recorded": "Pago registrado",
  "booking.payment.voided": "Pago anulado",
  "booking.series.created": "Turno fijo creado",
  "booking.series.cancelled": "Turno fijo cancelado",
  // Transferencias
  "booking.transfer.reported": "Transferencia informada",
  "booking.transfer.reported_late": "Transferencia informada fuera de plazo",
  "booking.transfer.verified": "Transferencia verificada",
  "booking.transfer.rejected": "Transferencia rechazada",
  "payment.incident.opened": "Incidencia de pago abierta",
  "payment.incident.resolved": "Incidencia de pago resuelta",
  "tenant.payment_settings.updated": "Datos de cobro actualizados",
  // Canchas, horarios y precios
  "court.created": "Cancha creada",
  "court.updated": "Cancha modificada",
  "court.deleted": "Cancha eliminada",
  "court.reordered": "Orden de canchas cambiado",
  "court.schedule.replaced": "Horarios de cancha actualizados",
  "court.price_rule.created": "Tarifa agregada",
  "court.price_rule.deleted": "Tarifa eliminada",
  "court.image.added": "Foto de cancha agregada",
  "court.image.deleted": "Foto de cancha eliminada",
  "court.image.reordered": "Orden de fotos cambiado",
  "block.created": "Horario bloqueado",
  "block.deleted": "Bloqueo quitado",
  "schedule.exception.created": "Feriado o cierre agregado",
  "schedule.exception.deleted": "Feriado o cierre quitado",
  // Complejo
  "tenant.settings.updated": "Ajustes del complejo actualizados",
  "tenant.branding.updated": "Página pública actualizada",
  "tenant.asset.added": "Imagen del complejo agregada",
  "tenant.asset.deleted": "Imagen del complejo eliminada",
  "tenant.onboarding.step": "Paso de puesta en marcha completado",
  "customer.notes.updated": "Nota de cliente actualizada",
  "data.exported": "Datos exportados",
  // Equipo
  "team.invitation.created": "Invitación enviada",
  "team.invitation.accepted": "Invitación aceptada",
  "team.invitation.revoked": "Invitación revocada",
  "team.member.permissions_changed": "Permisos de un miembro cambiados",
  // Opiniones
  "review.created": "Opinión publicada",
  "review.replied": "Opinión respondida",
  "review.reported": "Opinión denunciada",
  "review.moderated": "Opinión moderada",
  // Plataforma
  "platform.tenant.created": "Complejo creado",
  "platform.tenant.updated": "Datos del complejo editados",
  "platform.tenant.activated": "Complejo reactivado",
  "platform.tenant.suspended": "Complejo suspendido",
  "platform.tenant.archived": "Complejo archivado",
  "platform.tenant.unarchived": "Complejo desarchivado",
  "platform.tenant.owner_changed": "Dueño del complejo cambiado",
  "platform.membership.assigned": "Acceso al panel asignado",
  "platform.subscription.assigned": "Plan asignado",
  "platform.subscription.trial_extended": "Prueba extendida",
  "platform.subscription.payment_recorded": "Pago de suscripción registrado",
  "platform.email.retried": "Reintento manual de email",
  "platform.email.test": "Correo de prueba enviado",
  "platform.plan.created": "Plan creado",
  "platform.plan.updated": "Plan modificado",
  "platform.user.suspended": "Usuario suspendido",
  "platform.user.reactivated": "Usuario reactivado",
  "platform.user.sessions_revoked": "Sesiones cerradas",
  "platform.user.password_recovery_sent": "Recuperación de contraseña enviada",
  "platform.user.updated": "Datos del usuario editados",
  "platform.user.anonymized": "Cuenta eliminada (datos anonimizados)",
};

const AREAS: Record<string, string> = {
  booking: "Reserva", court: "Cancha", block: "Bloqueo", schedule: "Horarios", tenant: "Complejo", team: "Equipo",
  review: "Opinión", platform: "Plataforma", payment: "Pago", customer: "Cliente", data: "Datos",
};

export function actionLabel(action: string): string {
  if (ACTIONS[action]) return ACTIONS[action]!;
  // Prefijo conocido (p. ej. filtros "booking."): se muestra el área sin el nombre técnico.
  const area = AREAS[action.split(".")[0] ?? ""];
  return area ? `${area}: otra acción` : "Acción del sistema";
}

export const ENTITY_LABEL: Record<string, string> = {
  booking: "Reserva", court: "Cancha", tenant: "Complejo", user: "Usuario", subscription: "Suscripción", plan: "Plan",
  customer: "Cliente", review: "Opinión", invitation: "Invitación", membership: "Acceso", block: "Bloqueo", payment_incident: "Incidencia", notification: "Email",
};

export const ACTOR_LABEL: Record<string, string> = { USER: "Usuario", PLATFORM_ADMIN: "Superadministrador", PUBLIC: "Público (jugador)", SYSTEM: "Sistema" };

/** Opciones para filtrar el historial por tipo de acción (prefijos). */
export const ACTION_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Todas" },
  { value: "booking.", label: "Reservas" },
  { value: "booking.transfer.", label: "Transferencias" },
  { value: "payment.", label: "Incidencias de pago" },
  { value: "court.", label: "Canchas y precios" },
  { value: "tenant.", label: "Complejo" },
  { value: "team.", label: "Equipo" },
  { value: "review.", label: "Opiniones" },
  { value: "platform.tenant.", label: "Plataforma: complejos" },
  { value: "platform.user.", label: "Plataforma: usuarios" },
  { value: "platform.subscription.", label: "Plataforma: suscripciones" },
  { value: "platform.plan", label: "Plataforma: planes" },
];
