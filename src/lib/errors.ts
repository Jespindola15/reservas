/**
 * Errores de dominio con mensajes PÚBLICOS controlados. Cualquier otro error se
 * trata como interno: se registra en el servidor y al cliente le llega un
 * mensaje genérico, sin trazas, SQL ni nombres de tablas.
 */
export const ERROR_CATALOG = {
  VALIDATION_ERROR: { status: 400, message: "Los datos enviados no son válidos." },
  UNAUTHENTICATED: { status: 401, message: "Tenés que iniciar sesión." },
  FORBIDDEN: { status: 403, message: "No tenés permiso para realizar esta acción." },
  NOT_FOUND: { status: 404, message: "No encontramos lo que buscás." },
  TENANT_NOT_FOUND: { status: 404, message: "El complejo no existe." },
  TENANT_SUSPENDED: { status: 403, message: "Este complejo no está recibiendo reservas en este momento." },
  COURT_NOT_FOUND: { status: 404, message: "La cancha no existe o no está disponible." },
  BOOKING_NOT_FOUND: { status: 404, message: "La reserva no existe." },
  INVALID_DURATION: { status: 422, message: "La duración elegida no está permitida para esta cancha." },
  INVALID_SLOT: { status: 422, message: "El horario elegido no corresponde a un turno válido de la cancha." },
  SLOT_IN_PAST: { status: 422, message: "El horario elegido ya pasó o está demasiado cerca." },
  SLOT_TOO_FAR: { status: 422, message: "Todavía no se puede reservar con tanta anticipación." },
  SLOT_UNAVAILABLE: { status: 409, message: "Ese horario ya no está disponible. Elegí otro." },
  BLOCK_CONFLICT: { status: 409, message: "Hay reservas u otros bloqueos en ese intervalo." },
  INVALID_TRANSITION: { status: 409, message: "La reserva no admite ese cambio de estado." },
  STALE_VERSION: { status: 409, message: "La reserva fue modificada por otra persona. Recargá e intentá de nuevo." },
  IDEMPOTENCY_MISMATCH: { status: 422, message: "Esta solicitud ya fue usada con datos distintos." },
  BOOKING_EXPIRED: { status: 409, message: "La solicitud venció y el turno fue liberado. No puede confirmarse." },
  BOOKING_CLOSED: { status: 409, message: "La reserva ya está cerrada (cancelada, rechazada o vencida)." },
  COURT_HAS_HISTORY: { status: 409, message: "La cancha tiene reservas registradas: no se puede eliminar, solo desactivar." },
  IMAGE_INVALID: { status: 422, message: "La imagen debe ser JPG, PNG o WebP de hasta 1,5 MB." },
  LIMIT_REACHED: { status: 422, message: "Se alcanzó el máximo permitido para este elemento." },
  INVALID_LINK: { status: 404, message: "El enlace no es válido o la reserva no existe." },
  CANCELLATION_WINDOW_CLOSED: { status: 409, message: "Ya no se puede cancelar online. Comunicate con el complejo." },
  EMAIL_TAKEN: { status: 409, message: "Ya existe una cuenta con ese email. Iniciá sesión o recuperá tu contraseña." },
  BOOKING_OWNED: { status: 409, message: "Esa reserva ya está vinculada a otra cuenta." },
  REVIEW_NOT_ALLOWED: { status: 422, message: "Solo podés opinar sobre turnos que jugaste en los últimos 90 días, una vez por reserva." },
  PAYMENTS_NOT_CONFIGURED: { status: 409, message: "Este complejo todavía no configuró sus datos de cobro. Contactalo para reservar." },
  AMOUNT_UNAVAILABLE: { status: 409, message: "Este horario no tiene precio configurado: no se puede calcular el importe a transferir." },
  HOLD_LIMIT: { status: 422, message: "Ya tenés reservas esperando transferencia. Informá o cancelá esas antes de pedir otra." },
  TRANSFER_NOT_PENDING: { status: 409, message: "Esta reserva no está esperando una transferencia." },
  TRANSFER_VERIFY_REQUIRED: { status: 409, message: "Esta reserva espera una transferencia: confirmala desde Transferencias, indicando el importe recibido." },
  ALREADY_PROCESSED: { status: 409, message: "Esta operación ya fue procesada por otra persona. Actualizá la página." },
  RATE_LIMITED: { status: 429, message: "Demasiados intentos. Esperá un momento y volvé a probar." },
  INTERNAL: { status: 500, message: "Ocurrió un error inesperado. Intentá nuevamente." },
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly publicMessage: string;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, details?: Record<string, unknown>) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_CATALOG[code].status;
    this.publicMessage = ERROR_CATALOG[code].message;
    this.details = details;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export type PublicError = { code: ErrorCode; message: string; details?: Record<string, unknown> };

/** Convierte cualquier error en algo seguro para enviar al cliente. */
export function toPublicError(e: unknown): { status: number; body: PublicError } {
  if (isAppError(e)) {
    return { status: e.status, body: { code: e.code, message: e.publicMessage, details: e.details } };
  }
  return { status: 500, body: { code: "INTERNAL", message: ERROR_CATALOG.INTERNAL.message } };
}
