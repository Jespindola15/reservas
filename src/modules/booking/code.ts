import { createHash, randomInt } from "node:crypto";

// Sin 0/O ni 1/I para evitar confusiones al dictarlo por teléfono.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Código de reserva legible: 8 caracteres, ~1e12 combinaciones, aleatorio criptográfico. */
export function generateBookingCode(length = 8): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Huella de una solicitud para detectar reusos de la clave de idempotencia con otros datos. */
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Clave de deduplicación de clientes: email normalizado o "tel:<dígitos>". */
export function customerContactKey(email: string | null | undefined, phone: string | null | undefined): string {
  if (email && email.trim()) return email.trim().toLowerCase();
  const digits = (phone ?? "").replace(/\D/g, "");
  return `tel:${digits}`;
}
