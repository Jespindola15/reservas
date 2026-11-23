import type { SportType } from "@/generated/prisma/client";
import { withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { resolvePrice } from "./pricing";
import { PRICE_RULE_SELECT, toPriceRules } from "./service";
import { dbDateToString, generateSlots, localMidnight, operatingDayRange, stringToDbDate } from "./time";

export type AvailabilitySlot = {
  startsAt: string;
  endsAt: string;
  available: boolean;
  priceAmount: number | null;
};

export type CourtAvailability = {
  id: string;
  name: string;
  sport: SportType;
  allowedDurations: number[];
  description: string | null;
  capacity: number | null;
  imageIds: string[];
  /** Motivo si el día está cerrado (feriado/cierre). */
  closedReason: string | null;
  slots: AvailabilitySlot[];
};

export type DayAvailability = {
  operatingDate: string;
  timezone: string;
  currency: string;
  durationMinutes: number;
  courts: CourtAvailability[];
};

/**
 * Disponibilidad de un día operativo calculada en el SERVIDOR a partir de los
 * horarios, la anticipación y las ocupaciones reales (reservas + bloqueos).
 * Es informativa: la confirmación definitiva la decide `createBooking` y la
 * restricción de exclusión, no esta lista.
 * No expone quién ocupa un turno ni por qué (privacidad).
 */
export async function getDayAvailability(
  ctx: TenantContext,
  q: { operatingDate: string; durationMinutes: number; courtId?: string },
  opts: { now?: Date; forStaff?: boolean } = {},
): Promise<DayAvailability> {
  const now = opts.now ?? new Date();
  return withTenant(ctx, async (tx) => {
    const tenant = await tx.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { timezone: true, currency: true, minLeadMinutes: true, maxAdvanceDays: true, status: true },
    });
    if (!tenant) throw new AppError("TENANT_NOT_FOUND");
    if (!localMidnight(q.operatingDate, tenant.timezone)) throw new AppError("VALIDATION_ERROR");
    const range = operatingDayRange(q.operatingDate, tenant.timezone);
    if (!range) throw new AppError("VALIDATION_ERROR");

    const courts = await tx.court.findMany({
      where: { tenantId: ctx.tenantId, isActive: true, ...(q.courtId ? { id: q.courtId } : {}) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        sport: true,
        slotStepMinutes: true,
        allowedDurations: true,
        basePrice: true,
        description: true,
        capacity: true,
        images: { select: { id: true }, orderBy: { sortOrder: "asc" }, take: 6 },
        scheduleRules: { select: { weekday: true, openMinute: true, closeMinute: true } },
        priceRules: { select: PRICE_RULE_SELECT },
      },
    });

    const exceptionRows = await tx.scheduleException.findMany({
      where: { tenantId: ctx.tenantId, date: stringToDbDate(q.operatingDate) },
      select: { courtId: true, date: true, kind: true, openMinute: true, closeMinute: true, reason: true },
    });

    const allocations = await tx.courtAllocation.findMany({
      where: {
        tenantId: ctx.tenantId,
        courtId: { in: courts.map((c) => c.id) },
        startsAt: { lt: range.to },
        endsAt: { gt: range.from },
      },
      select: {
        courtId: true,
        startsAt: true,
        endsAt: true,
        // Una PENDING vencida que el job todavía no procesó NO bloquea el turno.
        booking: { select: { status: true, expiresAt: true } },
      },
    });

    const minLead = opts.forStaff ? 0 : tenant.minLeadMinutes;
    const earliest = now.getTime() + minLead * 60_000;
    const latest = now.getTime() + tenant.maxAdvanceDays * 86_400_000;

    return {
      operatingDate: q.operatingDate,
      timezone: tenant.timezone,
      currency: tenant.currency,
      durationMinutes: q.durationMinutes,
      courts: courts.map((court) => {
        const busy = allocations.filter(
          (a) =>
            a.courtId === court.id &&
            !(a.booking?.status === "PENDING" && a.booking.expiresAt && a.booking.expiresAt.getTime() <= now.getTime()),
        );
        const exceptions = exceptionRows
          .filter((e) => e.courtId === null || e.courtId === court.id)
          .map((e) => ({ ...e, date: dbDateToString(e.date) }));
        const priceRules = toPriceRules(court.priceRules);
        const closedReason = exceptions.find((e) => e.kind === "CLOSED")?.reason ?? null;
        const slots = court.allowedDurations.includes(q.durationMinutes)
          ? generateSlots({
              operatingDate: q.operatingDate,
              tz: tenant.timezone,
              rules: court.scheduleRules,
              stepMinutes: court.slotStepMinutes,
              durationMinutes: q.durationMinutes,
              exceptions,
            })
          : [];
        return {
          id: court.id,
          name: court.name,
          sport: court.sport,
          allowedDurations: court.allowedDurations,
          description: court.description,
          capacity: court.capacity,
          imageIds: court.images.map((i) => i.id),
          closedReason,
          slots: slots.map((s) => {
            const start = s.startsAt.getTime();
            const overlaps = busy.some(
              (a) => a.startsAt.getTime() < s.endsAt.getTime() && a.endsAt.getTime() > start,
            );
            return {
              startsAt: s.startsAt.toISOString(),
              endsAt: s.endsAt.toISOString(),
              available: tenant.status === "ACTIVE" && !overlaps && start >= earliest && start <= latest,
              priceAmount: resolvePrice(priceRules, {
                durationMinutes: q.durationMinutes,
                weekday: s.weekday,
                localMinute: s.localMinute,
                operatingDate: s.operatingDate,
                basePrice: court.basePrice,
              }),
            };
          }),
        };
      }),
    };
  });
}
