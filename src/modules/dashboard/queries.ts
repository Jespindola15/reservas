import { withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { dbDateToString, localMidnight, stringToDbDate, todayIn, weekdayOf, windowsForDate } from "@/modules/booking/time";

/**
 * Indicadores del panel principal. Solo hechos registrados: cantidades de
 * reservas por estado, ocupación en minutos y actividad. NO se calculan
 * ingresos ni se infiere que algo esté pagado (todavía no hay pagos).
 */
export async function getDashboard(ctx: TenantContext, timezone: string, now: Date = new Date()) {
  const today = todayIn(timezone, now);
  const midnight = localMidnight(today, timezone)!;
  const from = midnight.toJSDate();
  const to = midnight.plus({ days: 1 }).toJSDate();
  const weekday = weekdayOf(today, timezone)!;

  return withTenant(ctx, async (tx) => {
    const courts = await tx.court.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, scheduleRules: { select: { weekday: true, openMinute: true, closeMinute: true } } },
    });
    const exceptions = await tx.scheduleException.findMany({
      where: { tenantId: ctx.tenantId, date: stringToDbDate(today) },
      select: { courtId: true, date: true, kind: true, openMinute: true, closeMinute: true },
    });
    const todays = await tx.booking.findMany({
      where: { tenantId: ctx.tenantId, startsAt: { gte: from, lt: to } },
      orderBy: { startsAt: "asc" },
      select: {
        id: true, status: true, courtId: true, durationMinutes: true, startsAt: true, endsAt: true, code: true,
        customerName: true, customerPhone: true, paymentStatus: true, amountDue: true, currency: true, court: { select: { name: true } },
      },
    });
    const pending = await tx.booking.count({
      where: { tenantId: ctx.tenantId, status: "PENDING", startsAt: { gte: now }, expiresAt: { gt: now } },
    });
    const upcoming = await tx.booking.findMany({
      where: { tenantId: ctx.tenantId, status: { in: ["PENDING", "CONFIRMED"] }, startsAt: { gte: now } },
      orderBy: { startsAt: "asc" },
      take: 16,
      select: {
        id: true, code: true, status: true, startsAt: true, endsAt: true, customerName: true, expiresAt: true, paymentStatus: true,
        court: { select: { name: true } },
      },
    });
    const activity = await tx.auditLog.findMany({
      where: { tenantId: ctx.tenantId, entityType: "booking" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, action: true, actorType: true, entityId: true, createdAt: true },
    });
    const expired7d = await tx.booking.count({
      where: { tenantId: ctx.tenantId, status: "EXPIRED", expiredAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
    });

    const occupying = new Set(["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"]);
    const occupancy = courts.map((c) => {
      const ex = exceptions
        .filter((e) => e.courtId === null || e.courtId === c.id)
        .map((e) => ({ ...e, date: dbDateToString(e.date) }));
      const openMinutes = windowsForDate(today, weekday, c.scheduleRules, ex).reduce(
        (acc, w) => acc + (w.closeMinute - w.openMinute),
        0,
      );
      const booked = todays
        .filter((b) => b.courtId === c.id && occupying.has(b.status))
        .reduce((acc, b) => acc + b.durationMinutes, 0);
      return { id: c.id, name: c.name, openMinutes, bookedMinutes: booked, pct: openMinutes ? Math.min(100, Math.round((booked / openMinutes) * 100)) : null };
    });

    const count = (s: string) => todays.filter((b) => b.status === s).length;
    return {
      today,
      totals: {
        today: todays.filter((b) => occupying.has(b.status)).length,
        confirmedToday: count("CONFIRMED"),
        pendingToday: count("PENDING"),
        cancelledToday: count("CANCELLED") + count("REJECTED"),
        pendingUpcoming: pending,
        expired7d,
      },
      occupancy,
      agenda: todays.filter((b) => occupying.has(b.status)),
      upcoming: upcoming.filter((b) => b.startsAt >= to),
      activity,
    };
  });
}
