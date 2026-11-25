import { DateTime } from "luxon";

/**
 * Formatos únicos de TURNUP (Argentina): fechas DD/MM/AAAA, horas de 24 h y pesos (ARS).
 * Usar SIEMPRE estas funciones en la interfaz, en vez de toLocaleDateString sueltos.
 */
export const AR_TZ = "America/Argentina/Buenos_Aires";

/** 05/12/2026 */
export function fmtDate(d: Date, tz: string = AR_TZ): string {
  return DateTime.fromJSDate(d, { zone: tz }).toFormat("dd/LL/yyyy");
}
/** 05/12/2026 20:00 */
export function fmtDateTime(d: Date, tz: string = AR_TZ): string {
  return DateTime.fromJSDate(d, { zone: tz }).toFormat("dd/LL/yyyy HH:mm");
}
/** mié 05/12/2026 */
export function fmtWeekdayDate(d: Date, tz: string = AR_TZ): string {
  return DateTime.fromJSDate(d, { zone: tz }).setLocale("es-AR").toFormat("ccc dd/LL/yyyy").replace(".", "");
}
/** 20:00 */
export function fmtTime(d: Date, tz: string = AR_TZ): string {
  return DateTime.fromJSDate(d, { zone: tz }).toFormat("HH:mm");
}
/** $ 25.000 (pesos argentinos, sin centavos si no hay) */
export function fmtMoney(cents: number | null, currency = "ARS"): string {
  if (cents === null) return "A confirmar";
  const hasCents = cents % 100 !== 0;
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: hasCents ? 2 : 0 }).format(cents / 100);
}
