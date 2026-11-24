/**
 * Enlace a WhatsApp (wa.me) para escribirle al cliente DESDE el teléfono del complejo.
 * Nunca envía nada automáticamente: abre la conversación con un texto sugerido.
 *
 * Normalización para Argentina: se quitan símbolos, el 0 inicial y el "15" de celulares
 * cuando el número viene en formato local; se antepone 54 9. Números que ya empiezan con
 * 54 se respetan. Si el resultado no es plausible, devuelve null (no se muestra el botón).
 */
export function whatsappNumber(raw: string | null | undefined, defaultCountry = "54"): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (!d.startsWith(defaultCountry)) {
    d = d.replace(/^0/, "");
    // 11 15 1234-5678 -> 11 1234-5678 (área de 2 a 4 dígitos + "15")
    const m = d.match(/^(\d{2,4})15(\d{6,8})$/);
    if (m && (m[1]!.length + m[2]!.length === 10)) d = m[1]! + m[2]!;
    if (d.length !== 10) return d.length >= 8 && d.length <= 15 ? defaultCountry + d : null;
    d = `${defaultCountry}9${d}`;
  }
  return d.length >= 10 && d.length <= 15 ? d : null;
}

export function whatsappLink(raw: string | null | undefined, text?: string): string | null {
  const n = whatsappNumber(raw);
  if (!n) return null;
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
