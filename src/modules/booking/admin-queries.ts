import { z } from "zod";
import type { BookingStatus, Prisma } from "@/generated/prisma/client";
import { withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";
import { dbDateToString, localMidnight, stringToDbDate, weekdayOf, windowsForDate } from "./time";

/**
 * Consultas del panel (calendario, listado, detalle). Todas dentro de
 * withTenant + filtro explícito por tenantId.
 */

const BOOKING_LIST_SELECT = {
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
  expiresAt: true,
  version: true,
  court: { select: { name: true } },
} as const;

const STATUSES = ["PENDING", "CONFIRMED", "CANCELLED", "REJECTED", "COMPLETED", "NO_SHOW", "EXPIRED"] as const;

export const bookingFiltersSchema = z.object({
  status: z.enum(STATUSES).optional(),
  courtId: z.uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type BookingFilters = z.input<typeof bookingFiltersSchema>;

const PAGE_SIZE = 25;

/** Listado filtrable (cancha, rango de fechas locales, estado, texto). */
export async function listBookings(ctx: TenantContext, timezone: string, filters: BookingFilters) {
  const f = parseOrThrow(bookingFiltersSchema, filters);
  const where: Prisma.BookingWhereInput = { tenantId: ctx.tenantId };
  if (f.status) where.status = f.status as BookingStatus;
  if (f.courtId) where.courtId = f.courtId;
  const startsAt: Prisma.DateTimeFilter = {};
  if (f.from) {
    const m = localMidnight(f.from, timezone);
    if (m) startsAt.gte = m.toJSDate();
  }
  if (f.to) {
    const m = localMidnight(f.to, timezone);
    if (m) startsAt.lt = m.plus({ days: 1 }).toJSDate();
  }
  if (Object.keys(startsAt).length) where.startsAt = startsAt;
  // Sin comodines de LIKE provistos por el usuario.
  const q = f.q?.replace(/[%_\\]/g, "").trim();
  if (q) {
    where.OR = [
      { customerName: { contains: q, mode: "insensitive" } },
      { customerPhone: { contains: q } },
      { code: { equals: q.toUpperCase() } },
    ];
  }
  return withTenant(ctx, async (tx) => {
    const total = await tx.booking.count({ where });
    const rows = await tx.booking.findMany({
      where,
      orderBy: { startsAt: f.status === "PENDING" ? "asc" : "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: BOOKING_LIST_SELECT,
    });
    return { rows, total, page: f.page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  });
}

/** Detalle de una reserva + historial (auditoría) para el panel. */
export async function getBookingDetail(ctx: TenantContext, bookingId: string) {
  parseOrThrow(z.uuid(), bookingId);
  return withTenant(ctx, async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: bookingId, tenantId: ctx.tenantId },
      select: {
        ...BOOKING_LIST_SELECT,
        customerEmail: true,
        notes: true,
        internalNotes: true,
        createdAt: true,
        confirmedAt: true,
        cancelledAt: true,
        cancelReason: true,
        expiredAt: true,
        customerId: true,
        customer: { select: { id: true, name: true, phone: true, email: true, _count: { select: { bookings: true } } } },
      },
    });
    if (!booking) throw new AppError("BOOKING_NOT_FOUND");
    const history = await tx.auditLog.findMany({
      where: { tenantId: ctx.tenantId, entityType: "booking", entityId: booking.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, action: true, actorType: true, actorUserId: true, metadata: true, createdAt: true },
    });
    const actorIds = [...new Set(history.map((h) => h.actorUserId).filter((x): x is string => Boolean(x)))];
    const actors = actorIds.length
      ? await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
      : [];
    const names = new Map(actors.map((a) => [a.id, a.name]));
    return {
      booking,
      history: history.map((h) => ({ ...h, actorName: h.actorUserId ? (names.get(h.actorUserId) ?? "Usuario") : null })),
    };
  });
}

/**
 * Datos del calendario. `days` = 1 (vista diaria) o 7 (semanal).
 * Trae las reservas y bloqueos de [inicio del día, fin + 6 h] para incluir
 * turnos de madrugada, y la franja de apertura de cada cancha para la grilla.
 */
export async function getCalendar(ctx: TenantContext, timezone: string, q: { date: string; days: 1 | 7; courtId?: string }) {
  const start = localMidnight(q.date, timezone);
  if (!start) throw new AppError("VALIDATION_ERROR");
  const from = start.toJSDate();
  const to = start.plus({ days: q.days, hours: 6 }).toJSDate();
  const dates = Array.from({ length: q.days }, (_, i) => start.plus({ days: i }).toISODate()!);

  return withTenant(ctx, async (tx) => {
    const courts = await tx.court.findMany({
      where: { tenantId: ctx.tenantId, isActive: true, ...(q.courtId ? { id: q.courtId } : {}) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, sport: true, allowedDurations: true, scheduleRules: { select: { weekday: true, openMinute: true, closeMinute: true } } },
    });
    const ids = courts.map((c) => c.id);
    const bookings = await tx.booking.findMany({
      where: {
        tenantId: ctx.tenantId,
        courtId: { in: ids },
        startsAt: { lt: to },
        endsAt: { gt: from },
        status: { in: ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"] },
      },
      orderBy: { startsAt: "asc" },
      select: BOOKING_LIST_SELECT,
    });
    const blocks = await tx.availabilityBlock.findMany({
      where: { tenantId: ctx.tenantId, courtId: { in: ids }, startsAt: { lt: to }, endsAt: { gt: from } },
      select: { id: true, courtId: true, startsAt: true, endsAt: true, reason: true },
    });
    const exRows = await tx.scheduleException.findMany({
      where: { tenantId: ctx.tenantId, date: { in: dates.map(stringToDbDate) } },
      select: { courtId: true, date: true, kind: true, openMinute: true, closeMinute: true, reason: true },
    });
    const exceptions = exRows.map((e) => ({ ...e, date: dbDateToString(e.date) }));

    const windows = dates.map((date) => {
      const wd = weekdayOf(date, timezone)!;
      return {
        date,
        closedReason: exceptions.find((e) => e.date === date && e.courtId === null && e.kind === "CLOSED")?.reason ?? null,
        courts: courts.map((c) => ({
          courtId: c.id,
          windows: windowsForDate(date, wd, c.scheduleRules, exceptions.filter((e) => e.courtId === null || e.courtId === c.id)),
        })),
      };
    });
    return { courts, bookings, blocks, dates, windows };
  });
}
