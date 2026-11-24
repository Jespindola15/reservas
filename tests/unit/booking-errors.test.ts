import { describe, expect, it } from "vitest";
import { bookingErrorMessage } from "@/app/[slug]/booking-errors";

describe("mensajes de error de la reserva pública (regresión del error de reservas)", () => {
  it("nombra los campos inválidos en lugar de un mensaje genérico", () => {
    const msg = bookingErrorMessage(400, { error: { code: "VALIDATION_ERROR", message: "Los datos enviados no son válidos.", requestId: "abcdef12-3456", details: { fields: ["customer.phone"] } } });
    expect(msg).toContain("teléfono");
  });
  it("una respuesta que no es JSON (p. ej. 502) no se confunde con un problema de conexión y muestra el estado", () => {
    expect(bookingErrorMessage(502, null)).toContain("error 502");
  });
  it("errores internos muestran un código de soporte para rastrearlos en los registros", () => {
    expect(bookingErrorMessage(500, { error: { code: "INTERNAL", message: "Ocurrió un error inesperado.", requestId: "1234abcd-xxxx" } })).toContain("1234abcd");
  });
  it("errores de negocio muestran el mensaje claro del servidor", () => {
    expect(bookingErrorMessage(422, { error: { code: "SLOT_IN_PAST", message: "El horario elegido ya pasó o está demasiado cerca." } })).toBe("El horario elegido ya pasó o está demasiado cerca.");
  });
});
