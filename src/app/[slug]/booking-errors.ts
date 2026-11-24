/**
 * Mensajes de error de la reserva pública. Antes cualquier respuesta no-JSON se mostraba como
 * "Problema de conexión" y los errores de validación no decían qué campo estaba mal: eso hizo
 * imposible diagnosticar el error reportado. Ahora se nombra el campo y se muestra un código de soporte.
 */
const FIELD_LABEL: Record<string, string> = {
  name: "nombre y apellido", phone: "teléfono (solo números, espacios, +, - o paréntesis)", email: "email",
  notes: "comentarios", transferPayerName: "nombre del titular de la cuenta", startsAt: "horario", courtId: "cancha", durationMinutes: "duración",
};

/** Mensaje claro a partir de la respuesta de error de la API (sin ocultar el código para soporte). */
export function bookingErrorMessage(status: number, json: unknown): string {
  const err = (json as { error?: { code?: string; message?: string; requestId?: string; details?: { fields?: string[] } } } | null)?.error;
  const ref = err?.requestId ? ` (código de soporte: ${err.requestId.slice(0, 8)})` : ` (error ${status})`;
  if (!err) return `No pudimos registrar la reserva: el servidor no respondió correctamente${ref}. Volvé a intentar; no se duplicará.`;
  if (err.code === "LIMIT_REACHED") return "Ya tenés varias reservas activas en este complejo. Para reservar más, comunicate con el complejo.";
  if (err.code === "VALIDATION_ERROR" && err.details?.fields?.length) {
    const names = [...new Set(err.details.fields.map((f) => FIELD_LABEL[f.split(".").pop() ?? f] ?? f))];
    return `Revisá estos datos: ${names.join(", ")}.`;
  }
  return `${err.message ?? "No pudimos registrar la reserva."}${err.code === "INTERNAL" ? ref : ""}`;
}
