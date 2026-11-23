import { DateTime } from "luxon";

/**
 * Modelo de tiempo del motor de reservas
 * --------------------------------------
 * - En la base todo se guarda como instantes absolutos (timestamptz, UTC).
 * - Los horarios de apertura se configuran en HORA LOCAL del complejo
 *   (zona IANA, p. ej. America/Argentina/Buenos_Aires) como minutos desde la
 *   medianoche del "día operativo".
 * - Un día operativo puede extenderse después de medianoche: una franja
 *   18:00–02:00 se guarda como open=1080, close=1560. Los turnos de 00:00 a
 *   02:00 pertenecen al día operativo ANTERIOR (así lo ve el dueño: "el sábado
 *   a la noche").
 * - Los turnos empiezan en una grilla local (open + k*step). La duración es
 *   tiempo real: un partido de 90 min dura 90 min aunque haya cambio de hora.
 * - Horas locales inexistentes (salto de horario de verano) no generan turno.
 */

export type ScheduleRule = { weekday: number; openMinute: number; closeMinute: number };

export type Slot = {
  startsAt: Date;
  endsAt: Date;
  /** Minutos desde la medianoche del día operativo (puede ser >= 1440). */
  localMinute: number;
  /** Fecha local YYYY-MM-DD del día operativo al que pertenece el turno. */
  operatingDate: string;
  /** Día de semana ISO del día operativo (1=lunes ... 7=domingo). */
  weekday: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidTimeZone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

/** Valida y devuelve la medianoche local de una fecha YYYY-MM-DD. */
export function localMidnight(operatingDate: string, tz: string): DateTime | null {
  if (!DATE_RE.test(operatingDate)) return null;
  const dt = DateTime.fromISO(operatingDate, { zone: tz }).startOf("day");
  if (!dt.isValid || dt.toISODate() !== operatingDate) return null;
  return dt;
}

/**
 * Convierte (día operativo, minuto local) a un instante. Devuelve null si esa
 * hora local no existe (salto de horario de verano).
 */
export function wallTimeToInstant(operatingDate: string, minute: number, tz: string): DateTime | null {
  const midnight = localMidnight(operatingDate, tz);
  if (!midnight) return null;
  const dayOffset = Math.floor(minute / 1440);
  const m = minute - dayOffset * 1440;
  const hour = Math.floor(m / 60);
  const min = m % 60;
  const day = midnight.plus({ days: dayOffset });
  const dt = day.set({ hour, minute: min, second: 0, millisecond: 0 });
  if (!dt.isValid || dt.hour !== hour || dt.minute !== min || dt.toISODate() !== day.toISODate()) return null;
  return dt;
}

/** Instante de cierre: si la hora local no existe, Luxon la corre hacia adelante. */
function closingInstant(operatingDate: string, minute: number, tz: string): DateTime | null {
  const exact = wallTimeToInstant(operatingDate, minute, tz);
  if (exact) return exact;
  const midnight = localMidnight(operatingDate, tz);
  if (!midnight) return null;
  const dayOffset = Math.floor(minute / 1440);
  const m = minute - dayOffset * 1440;
  return midnight.plus({ days: dayOffset }).set({ hour: Math.floor(m / 60), minute: m % 60 });
}

export function weekdayOf(operatingDate: string, tz: string): number | null {
  return localMidnight(operatingDate, tz)?.weekday ?? null;
}

/** Genera todos los turnos posibles de un día operativo para una duración. */
export function generateSlots(params: {
  operatingDate: string;
  tz: string;
  rules: readonly ScheduleRule[];
  stepMinutes: number;
  durationMinutes: number;
}): Slot[] {
  const { operatingDate, tz, rules, stepMinutes, durationMinutes } = params;
  const weekday = weekdayOf(operatingDate, tz);
  if (weekday === null || stepMinutes <= 0 || durationMinutes <= 0) return [];

  const byStart = new Map<number, Slot>();
  for (const rule of rules) {
    if (rule.weekday !== weekday) continue;
    const windowEnd = closingInstant(operatingDate, rule.closeMinute, tz);
    if (!windowEnd) continue;
    for (let m = rule.openMinute; m < rule.closeMinute; m += stepMinutes) {
      const start = wallTimeToInstant(operatingDate, m, tz);
      if (!start) continue;
      const end = start.plus({ minutes: durationMinutes });
      if (end > windowEnd) break;
      const ms = start.toMillis();
      if (!byStart.has(ms)) {
        byStart.set(ms, {
          startsAt: start.toJSDate(),
          endsAt: end.toJSDate(),
          localMinute: m,
          operatingDate,
          weekday,
        });
      }
    }
  }
  return [...byStart.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/**
 * Verifica que un instante + duración corresponda EXACTAMENTE a un turno válido
 * de la cancha. Considera el día local del inicio y el anterior (por las
 * franjas que cruzan la medianoche). Devuelve el turno o null.
 */
export function findSlot(params: {
  startsAt: Date;
  durationMinutes: number;
  tz: string;
  rules: readonly ScheduleRule[];
  stepMinutes: number;
}): Slot | null {
  const local = DateTime.fromJSDate(params.startsAt, { zone: params.tz });
  if (!local.isValid) return null;
  const candidates = [local.toISODate(), local.minus({ days: 1 }).toISODate()].filter(
    (d): d is string => d !== null,
  );
  const target = params.startsAt.getTime();
  for (const operatingDate of candidates) {
    const slots = generateSlots({
      operatingDate,
      tz: params.tz,
      rules: params.rules,
      stepMinutes: params.stepMinutes,
      durationMinutes: params.durationMinutes,
    });
    const hit = slots.find((s) => s.startsAt.getTime() === target);
    if (hit) return hit;
  }
  return null;
}

/** Rango [inicio, fin) que cubre un día operativo completo (incluye después de medianoche). */
export function operatingDayRange(operatingDate: string, tz: string): { from: Date; to: Date } | null {
  const midnight = localMidnight(operatingDate, tz);
  if (!midnight) return null;
  return { from: midnight.toJSDate(), to: midnight.plus({ days: 2 }).toJSDate() };
}

export function todayIn(tz: string, now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone: tz }).toISODate() ?? "";
}

export function formatLocalTime(date: Date, tz: string): string {
  return DateTime.fromJSDate(date, { zone: tz }).toFormat("HH:mm");
}

export function formatLocalDateTime(date: Date, tz: string): string {
  return DateTime.fromJSDate(date, { zone: tz }).setLocale("es-AR").toFormat("cccc d 'de' LLLL, HH:mm");
}

export function minutesToHHMM(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Fecha + hora local (HH:mm) ingresadas por el dueño -> instante. Null si no existe o es inválida. */
export function localDateTimeToInstant(date: string, hhmm: string, tz: string): Date | null {
  if (!DATE_RE.test(date) || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  if (h > 23 || m > 59) return null;
  return wallTimeToInstant(date, h * 60 + m, tz)?.toJSDate() ?? null;
}

/** Rango [00:00, 24:00) de un día calendario local. */
export function calendarDayRange(date: string, tz: string): { from: Date; to: Date } | null {
  const midnight = localMidnight(date, tz);
  if (!midnight) return null;
  return { from: midnight.toJSDate(), to: midnight.plus({ days: 1 }).toJSDate() };
}
