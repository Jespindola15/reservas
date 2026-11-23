import { withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { calendarDayRange } from "./time";

/** Reservas y bloqueos de un día calendario local para el panel del complejo. */
export async function getDayBoard(ctx: TenantContext, date: string, timezone: string) {
  const range = calendarDayRange(date, timezone);
  if (!range) throw new AppError("VALIDATION_ERROR");
  return withTenant(ctx, async (tx) => {
    const [courts, bookings, blocks] = await Promise.all([
      tx.court.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, sport: true, isActive: true, allowedDurations: true },
      }),
      tx.booking.findMany({
        where: { tenantId: ctx.tenantId, startsAt: { gte: range.from, lt: range.to } },
        orderBy: [{ startsAt: "asc" }],
        select: {
          id: true,
          code: true,
          status: true,
          source: true,
          courtId: true,
          startsAt: true,
          endsAt: true,
          durationMinutes: true,
          priceAmount: true,
          currency: true,
          customerName: true,
          customerPhone: true,
          customerEmail: true,
          notes: true,
          version: true,
        },
      }),
      tx.availabilityBlock.findMany({
        where: { tenantId: ctx.tenantId, startsAt: { lt: range.to }, endsAt: { gt: range.from } },
        orderBy: { startsAt: "asc" },
        select: { id: true, courtId: true, startsAt: true, endsAt: true, reason: true },
      }),
    ]);
    return { courts, bookings, blocks };
  });
}

export async function countPendingBookings(ctx: TenantContext, now: Date = new Date()) {
  return withTenant(ctx, (tx) =>
    tx.booking.count({ where: { tenantId: ctx.tenantId, status: "PENDING", startsAt: { gte: now } } }),
  );
}
