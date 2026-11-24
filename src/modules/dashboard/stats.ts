import { DateTime } from "luxon";
import { z } from "zod";
import { withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { dbDateToString, localMidnight, stringToDbDate, todayIn, weekdayOf, windowsForDate } from "@/modules/booking/time";

/**
 * Estadísticas del complejo para un período (fechas locales, inclusivas).
 *
 * Solo hechos registrados en TURNUP:
 *  - "Cobrado" = pagos/señas registrados a mano con fecha en el período, menos devoluciones.
 *  - "Proyectado" = precio congelado de las reservas activas del período (pendientes,
 *    confirmadas, jugadas o ausentes). Las reservas sin precio no suman y se informan aparte.
 *  - "Pendiente de cobro" = por reserva confirmada/jugada/ausente: precio − neto abonado (≥ 0).
 * Nunca se inventan datos: un período sin reservas devuelve ceros.
 */

export const MAX_RANGE_DAYS = 92;
export const PERIODS = ["day", "week", "month", "custom"] as const;
export type Period = (typeof PERIODS)[number];

const OCCUPYING = new Set(["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"]);
const BILLABLE = new Set(["CONFIRMED", "COMPLETED", "NO_SHOW"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type Range = { from: string; to: string; days: number };

/** Resuelve el período pedido a un rango de fechas locales y el período anterior equivalente. */
export function resolveRange(input: { period?: string; from?: string; to?: string; date?: string }, tz: string, now: Date = new Date()) {
  const period = (PERIODS as readonly string[]).includes(input.period ?? "") ? (input.period as Period) : "month";
  const anchorStr = input.date && DATE.test(input.date) ? input.date : todayIn(tz, now);
  let anchor = DateTime.fromISO(anchorStr, { zone: tz });
  if (!anchor.isValid) anchor = DateTime.fromISO(todayIn(tz, now), { zone: tz });
  let error: string | null = null;
  let from: DateTime;
  let to: DateTime;
  if (period === "day") {
    from = anchor;
    to = anchor;
  } else if (period === "week") {
    from = anchor.startOf("week");
    to = from.plus({ days: 6 });
  } else if (period === "month") {
    from = anchor.startOf("month");
    to = anchor.endOf("month").startOf("day");
  } else {
    const f = input.from && DATE.test(input.from) ? DateTime.fromISO(input.from, { zone: tz }) : null;
    const t = input.to && DATE.test(input.to) ? DateTime.fromISO(input.to, { zone: tz }) : null;
    if (!f?.isValid || !t?.isValid || t < f) {
      error = "Elegí un rango de fechas válido. Se muestra el día de hoy.";
      from = anchor;
      to = anchor;
    } else {
      from = f;
      to = t;
    }
  }
  let days = Math.round(to.diff(from, "days").days) + 1;
  if (days > MAX_RANGE_DAYS) {
    error = `El rango máximo es de ${MAX_RANGE_DAYS} días; se recortó.`;
    to = from.plus({ days: MAX_RANGE_DAYS - 1 });
    days = MAX_RANGE_DAYS;
  }
  const prevTo = from.minus({ days: 1 });
  const prevFrom = prevTo.minus({ days: days - 1 });
  const iso = (d: DateTime) => d.toISODate()!;
  return {
    period,
    error,
    current: { from: iso(from), to: iso(to), days } satisfies Range,
    previous: { from: iso(prevFrom), to: iso(prevTo), days } satisfies Range,
  };
}

export type StatBooking = {
  id: string;
  status: string;
  courtId: string;
  customerId: string;
  startsAt: Date;
  durationMinutes: number;
  priceAmount: number | null;
};
export type StatPayment = { bookingId: string; kind: string; amount: number; paidAt: Date };

/** Neto abonado por reserva (pagos + señas − devoluciones). */
export function netPaidByBooking(payments: StatPayment[]) {
  const m = new Map<string, number>();
  for (const p of payments) m.set(p.bookingId, (m.get(p.bookingId) ?? 0) + (p.kind === "REFUND" ? -p.amount : p.amount));
  return m;
}

/** Cálculo puro (testeable sin base de datos). */
export function computeStats(params: {
  tz: string;
  bookings: StatBooking[];
  /** Pagos con fecha dentro del período (para "cobrado"). */
  paymentsInRange: StatPayment[];
  /** Todos los pagos de las reservas del período (para "pendiente de cobro"). */
  paymentsOfBookings: StatPayment[];
  courts: { id: string; name: string; openMinutes: number }[];
  /** customerId → fecha del primer turno histórico. */
  firstBookingAt: Map<string, Date>;
  rangeStart: Date;
}) {
  const { bookings, tz } = params;
  const active = bookings.filter((b) => OCCUPYING.has(b.status));
  const cancelled = bookings.filter((b) => b.status === "CANCELLED").length;
  const noShow = bookings.filter((b) => b.status === "NO_SHOW").length;
  const decided = bookings.filter((b) => b.status !== "EXPIRED" && b.status !== "REJECTED").length;

  const collected = params.paymentsInRange.reduce((acc, p) => acc + (p.kind === "REFUND" ? -p.amount : p.amount), 0);
  const projected = active.reduce((acc, b) => acc + (b.priceAmount ?? 0), 0);
  const withoutPrice = active.filter((b) => b.priceAmount === null).length;
  const paidBy = netPaidByBooking(params.paymentsOfBookings);
  const pendingCollection = bookings
    .filter((b) => BILLABLE.has(b.status) && b.priceAmount !== null)
    .reduce((acc, b) => acc + Math.max(0, b.priceAmount! - (paidBy.get(b.id) ?? 0)), 0);

  const openMinutes = params.courts.reduce((a, c) => a + c.openMinutes, 0);
  const bookedMinutes = active.reduce((a, b) => a + b.durationMinutes, 0);

  const courts = params.courts
    .map((c) => {
      const mine = active.filter((b) => b.courtId === c.id);
      const minutes = mine.reduce((a, b) => a + b.durationMinutes, 0);
      return {
        id: c.id,
        name: c.name,
        bookings: mine.length,
        minutes,
        revenue: mine.reduce((a, b) => a + (b.priceAmount ?? 0), 0),
        occupancyPct: c.openMinutes ? Math.min(100, Math.round((minutes / c.openMinutes) * 100)) : null,
      };
    })
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));

  const byHour = Array.from({ length: 24 }, () => 0);
  const byWeekday = Array.from({ length: 7 }, () => 0); // 0 = lunes
  for (const b of active) {
    const local = DateTime.fromJSDate(b.startsAt, { zone: tz });
    byHour[local.hour]! += 1;
    byWeekday[local.weekday - 1]! += 1;
  }

  const customers = new Set(active.map((b) => b.customerId));
  let newCustomers = 0;
  for (const id of customers) {
    const first = params.firstBookingAt.get(id);
    if (!first || first >= params.rangeStart) newCustomers += 1;
  }

  return {
    bookings: { total: bookings.length, active: active.length, cancelled, noShow, withoutPrice },
    money: { collected, projected, pendingCollection },
    occupancy: { openMinutes, bookedMinutes, pct: openMinutes ? Math.min(100, Math.round((bookedMinutes / openMinutes) * 100)) : null },
    cancellationRate: decided ? Math.round((cancelled / decided) * 1000) / 10 : 0,
    customers: { total: customers.size, new: newCustomers, returning: customers.size - newCustomers },
    courts,
    byHour,
    byWeekday,
  };
}

export type Stats = ReturnType<typeof computeStats>;

async function loadPeriod(ctx: TenantContext, tz: string, range: Range) {
  const start = localMidnight(range.from, tz)!;
  const end = localMidnight(range.to, tz)!.plus({ days: 1 });
  const from = start.toJSDate();
  const to = end.toJSDate();
  return withTenant(ctx, async (tx) => {
    const courtsRaw = await tx.court.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, scheduleRules: { select: { weekday: true, openMinute: true, closeMinute: true } } },
    });
    const exceptions = await tx.scheduleException.findMany({
      where: { tenantId: ctx.tenantId, date: { gte: stringToDbDate(range.from), lte: stringToDbDate(range.to) } },
      select: { courtId: true, date: true, kind: true, openMinute: true, closeMinute: true },
    });
    const views = await tx.tenantDailyView.aggregate({
      where: { tenantId: ctx.tenantId, day: { gte: stringToDbDate(range.from), lte: stringToDbDate(range.to) } },
      _sum: { views: true },
    });
    // Reservas online CREADAS en el período, por origen (catálogo de TURNUP vs. enlace directo).
    const byOrigin = await tx.booking.groupBy({
      by: ["origin"],
      where: { tenantId: ctx.tenantId, source: "ONLINE", createdAt: { gte: from, lt: to } },
      _count: { _all: true },
    });
    const bookings = await tx.booking.findMany({
      where: { tenantId: ctx.tenantId, startsAt: { gte: from, lt: to } },
      select: { id: true, status: true, courtId: true, customerId: true, startsAt: true, durationMinutes: true, priceAmount: true },
    });
    const paymentsInRange = await tx.bookingPayment.findMany({
      where: { tenantId: ctx.tenantId, paidAt: { gte: from, lt: to } },
      select: { bookingId: true, kind: true, amount: true, paidAt: true },
    });
    const ids = bookings.map((b) => b.id);
    const paymentsOfBookings = ids.length
      ? await tx.bookingPayment.findMany({
          where: { tenantId: ctx.tenantId, bookingId: { in: ids } },
          select: { bookingId: true, kind: true, amount: true, paidAt: true },
        })
      : [];
    const customerIds = [...new Set(bookings.map((b) => b.customerId))];
    const firsts = customerIds.length
      ? await tx.booking.groupBy({
          by: ["customerId"],
          where: { tenantId: ctx.tenantId, customerId: { in: customerIds }, status: { in: ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"] } },
          _min: { startsAt: true },
        })
      : [];

    const exByDate = exceptions.map((e) => ({ ...e, date: dbDateToString(e.date) }));
    const dates: string[] = [];
    for (let d = start; d < end; d = d.plus({ days: 1 })) dates.push(d.toISODate()!);
    const courts = courtsRaw.map((c) => {
      let open = 0;
      for (const date of dates) {
        const wd = weekdayOf(date, tz)!;
        const ex = exByDate.filter((e) => e.date === date && (e.courtId === null || e.courtId === c.id));
        open += windowsForDate(date, wd, c.scheduleRules, ex).reduce((a, w) => a + (w.closeMinute - w.openMinute), 0);
      }
      return { id: c.id, name: c.name, openMinutes: open };
    });

    const base = computeStats({
      tz,
      bookings,
      paymentsInRange,
      paymentsOfBookings,
      courts,
      firstBookingAt: new Map(firsts.map((f) => [f.customerId, f._min.startsAt!])),
      rangeStart: from,
    });
    const count = (o: string | null) => byOrigin.find((b) => b.origin === o)?._count._all ?? 0;
    return {
      ...base,
      marketplace: {
        profileViews: views._sum.views ?? 0,
        onlineFromMarketplace: count("MARKETPLACE"),
        onlineDirect: count("DIRECT") + count(null),
      },
    };
  });
}

export const statsQuerySchema = z.object({
  period: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  date: z.string().optional(),
});

export async function getStats(ctx: TenantContext, tz: string, input: z.infer<typeof statsQuerySchema>, now: Date = new Date()) {
  const r = resolveRange(input, tz, now);
  const current = await loadPeriod(ctx, tz, r.current);
  const previous = await loadPeriod(ctx, tz, r.previous);
  return { ...r, stats: current, prev: previous };
}

/** Variación porcentual entre períodos; null si el anterior es 0. */
export function delta(curr: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}
