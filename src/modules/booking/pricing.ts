export type PriceRule = {
  durationMinutes: number;
  weekday: number | null;
  startMinute: number | null;
  endMinute: number | null;
  /** "YYYY-MM-DD" del día operativo, o null. */
  specialDate?: string | null;
  amount: number;
};

/**
 * Elige el precio de un turno. Gana la regla más específica:
 *   fecha especial (+4) > día + franja (3) > franja (2) > día (1) > general (0).
 * Si ninguna regla coincide y hay precio base (por 60 min), se prorratea por duración.
 * Ante empate, el menor importe (criterio favorable al cliente y determinista).
 * `localMinute` es relativo al día operativo (puede ser >= 1440 después de medianoche).
 * Devuelve null si no hay precio configurado ("a confirmar").
 */
export function resolvePrice(
  rules: readonly PriceRule[],
  q: { durationMinutes: number; weekday: number; localMinute: number; operatingDate?: string; basePrice?: number | null },
): number | null {
  let best: { score: number; amount: number } | null = null;
  for (const r of rules) {
    if (r.durationMinutes !== q.durationMinutes) continue;
    if (r.specialDate && r.specialDate !== q.operatingDate) continue;
    if (r.weekday !== null && r.weekday !== q.weekday) continue;
    const hasBand = r.startMinute !== null && r.endMinute !== null;
    if (hasBand && !(q.localMinute >= r.startMinute! && q.localMinute < r.endMinute!)) continue;
    const score = (r.specialDate ? 4 : 0) + (hasBand ? 2 : 0) + (r.weekday !== null ? 1 : 0);
    if (!best || score > best.score || (score === best.score && r.amount < best.amount)) {
      best = { score, amount: r.amount };
    }
  }
  if (best) return best.amount;
  if (q.basePrice !== null && q.basePrice !== undefined) return Math.round((q.basePrice * q.durationMinutes) / 60);
  return null;
}

export function formatMoney(cents: number | null, currency: string): string {
  if (cents === null) return "A confirmar";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}
