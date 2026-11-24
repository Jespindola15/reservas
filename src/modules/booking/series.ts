import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { z } from "zod";
import { audit, type Actor } from "@/lib/audit";
import { withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { AppError, isAppError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";
import { getDayAvailability } from "./availability";
import { customerContactKey } from "./code";
import { changeBookingStatus, createBooking } from "./service";
import { dbDateToString, localMidnight, stringToDbDate, weekdayOf } from "./time";

/**
 * Reservas fijas semanales ("todos los martes a las 21 en la cancha 2").
 * Flujo: vista previa con conflictos -> el complejo elige qué fechas omitir -> se crean
 * las reservas UNA por fecha con clave de idempotencia determinística (serie + fecha):
 * repetir la operación nunca duplica turnos. La exclusión de PostgreSQL sigue siendo la
 * garantía final ante reservas simultáneas.
 */
export const SERIES_MAX_WEEKS = 26;

export const seriesInputSchema = z
  .object({
    courtId: z.uuid(),
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora HH:MM"),
    durationMinutes: z.coerce.number().int().min(15).max(720),
    customer: z.object({
      name: z.string().trim().min(2).max(80),
      phone: z.string().trim().min(6).max(30),
      email: z.union([z.literal(""), z.email().max(254)]).optional(),
    }),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.endsOn >= v.startsOn, { path: ["endsOn"], message: "La fecha final debe ser posterior" });
export type SeriesInput = z.input<typeof seriesInputSchema>;

export type Occurrence = { date: string; startsAt: string; status: "ok" | "taken" | "closed" | "past" };

function occurrenceDates(startsOn: string, endsOn: string): string[] {
  const out: string[] = [];
  let d = DateTime.fromISO(startsOn);
  const end = DateTime.fromISO(endsOn);
  while (d <= end && out.length <= SERIES_MAX_WEEKS) {
    out.push(d.toISODate()!);
    d = d.plus({ weeks: 1 });
  }
  if (out.length > SERIES_MAX_WEEKS) throw new AppError("VALIDATION_ERROR", { field: "endsOn", reason: "max_weeks", max: SERIES_MAX_WEEKS });
  return out;
}

/** Revisa cada fecha con las MISMAS reglas que la disponibilidad del panel. No escribe nada. */
export async function previewSeries(ctx: TenantContext, raw: SeriesInput, opts: { now?: Date } = {}) {
  const input = parseOrThrow(seriesInputSchema, raw);
  const dates = occurrenceDates(input.startsOn, input.endsOn);
  const now = opts.now ?? new Date();
  const [hh, mm] = input.startTime.split(":").map(Number) as [number, number];
  const occurrences: Occurrence[] = [];
  let timezone = "";
  for (const date of dates) {
    const day = await getDayAvailability(ctx, { operatingDate: date, durationMinutes: input.durationMinutes, courtId: input.courtId }, { now, forStaff: true, ignoreMaxAdvance: true });
    timezone = day.timezone;
    const startsAt = localMidnight(date, day.timezone)!.plus({ minutes: hh * 60 + mm }).toJSDate();
    const court = day.courts[0];
    if (!court) throw new AppError("COURT_NOT_FOUND");
    const slot = court.slots.find((s) => s.startsAt === startsAt.toISOString());
    const status: Occurrence["status"] =
      startsAt.getTime() <= now.getTime() ? "past" : !slot ? "closed" : slot.available ? "ok" : "taken";
    occurrences.push({ date, startsAt: startsAt.toISOString(), status });
  }
  return { occurrences, timezone, weekday: weekdayOf(input.startsOn, timezone || "UTC"), ok: occurrences.filter((o) => o.status === "ok").length };
}

/**
 * Crea la serie y sus reservas (solo las fechas libres que no se omitieron). Devuelve lo
 * creado y lo que no se pudo crear (p. ej. si alguien reservó entre la vista previa y la confirmación).
 */
export async function createSeries(ctx: TenantContext, raw: SeriesInput & { skipDates?: string[] }, actor: Actor, opts: { now?: Date } = {}) {
  const input = parseOrThrow(seriesInputSchema, raw);
  const skip = new Set((raw.skipDates ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
  const preview = await previewSeries(ctx, raw, opts);
  const [hh, mm] = input.startTime.split(":").map(Number) as [number, number];

  const series = await withTenant(ctx, async (tx) => {
    const court = await tx.court.findFirst({ where: { id: input.courtId, tenantId: ctx.tenantId }, select: { id: true } });
    if (!court) throw new AppError("COURT_NOT_FOUND");
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { timezone: true } });
    // El cliente se resuelve al crear la primera reserva; la serie guarda el mismo cliente.
    const contactKey = customerContactKey(input.customer.email || null, input.customer.phone);
    const customer = await tx.customer.upsert({
      where: { tenantId_contactKey: { tenantId: ctx.tenantId, contactKey } },
      update: {},
      create: { tenantId: ctx.tenantId, contactKey, name: input.customer.name, phone: input.customer.phone, email: input.customer.email || null },
      select: { id: true },
    });
    const s = await tx.bookingSeries.create({
      data: {
        tenantId: ctx.tenantId,
        courtId: court.id,
        customerId: customer.id,
        weekday: weekdayOf(input.startsOn, tenant.timezone) ?? 1,
        startMinute: hh * 60 + mm,
        durationMinutes: input.durationMinutes,
        startsOn: stringToDbDate(input.startsOn),
        endsOn: stringToDbDate(input.endsOn),
        notes: input.notes || null,
        createdByUserId: actor.type === "USER" ? actor.userId : null,
      },
      select: { id: true },
    });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "booking.series.created", entityType: "booking_series", entityId: s.id, metadata: { from: input.startsOn, to: input.endsOn, time: input.startTime, skipped: [...skip] } });
    return s;
  });

  const created: { date: string; code: string }[] = [];
  const failed: { date: string; reason: string }[] = [];
  for (const o of preview.occurrences) {
    if (o.status !== "ok" || skip.has(o.date)) continue;
    try {
      const r = await createBooking(
        ctx,
        {
          courtId: input.courtId,
          startsAt: new Date(o.startsAt),
          durationMinutes: input.durationMinutes,
          customer: { name: input.customer.name, phone: input.customer.phone, email: input.customer.email || null },
          notes: input.notes || null,
          idempotencyKey: `series:${series.id}:${o.date}`,
          source: "MANUAL",
          seriesId: series.id,
        },
        actor,
        opts,
      );
      created.push({ date: o.date, code: r.booking.code });
    } catch (e) {
      if (!isAppError(e)) throw e;
      failed.push({ date: o.date, reason: e.code });
    }
  }
  return { seriesId: series.id, created, failed };
}

/** Cancela la serie desde una fecha (incluida): las reservas futuras activas se cancelan una por una. */
export async function cancelSeries(ctx: TenantContext, seriesId: string, fromDate: string | null, actor: Actor, opts: { now?: Date } = {}) {
  parseOrThrow(z.uuid(), seriesId);
  const now = opts.now ?? new Date();
  const targets = await withTenant(ctx, async (tx) => {
    const s = await tx.bookingSeries.findFirst({ where: { id: seriesId, tenantId: ctx.tenantId }, select: { id: true } });
    if (!s) throw new AppError("NOT_FOUND");
    const tz = (await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { timezone: true } })).timezone;
    const from = fromDate ? (localMidnight(fromDate, tz)?.toJSDate() ?? now) : now;
    return tx.booking.findMany({
      where: { tenantId: ctx.tenantId, seriesId, status: { in: ["PENDING", "CONFIRMED"] }, startsAt: { gte: from > now ? from : now } },
      select: { id: true, version: true },
      orderBy: { startsAt: "asc" },
    });
  });
  let cancelled = 0;
  for (const b of targets) {
    await changeBookingStatus(ctx, { bookingId: b.id, to: "CANCELLED", expectedVersion: b.version, reason: "Cancelación del turno fijo" }, actor, opts);
    cancelled++;
  }
  await withTenant(ctx, async (tx) => {
    const remaining = await tx.booking.count({ where: { tenantId: ctx.tenantId, seriesId, status: { in: ["PENDING", "CONFIRMED"] }, startsAt: { gte: now } } });
    await tx.bookingSeries.update({ where: { id: seriesId }, data: { status: remaining === 0 ? "CANCELLED" : "ACTIVE" } });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "booking.series.cancelled", entityType: "booking_series", entityId: seriesId, metadata: { from: fromDate, cancelled } });
  });
  return { cancelled };
}

export async function listSeries(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => {
    const rows = await tx.bookingSeries.findMany({
      where: { tenantId: ctx.tenantId, status: "ACTIVE" },
      orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
      select: {
        id: true, weekday: true, startMinute: true, durationMinutes: true, startsOn: true, endsOn: true, notes: true,
        court: { select: { name: true } }, customer: { select: { name: true, phone: true } },
        _count: { select: { bookings: { where: { status: { in: ["PENDING", "CONFIRMED"] }, startsAt: { gte: new Date() } } } } },
      },
    });
    return rows.map((r) => ({ ...r, startsOn: dbDateToString(r.startsOn), endsOn: dbDateToString(r.endsOn), upcoming: r._count.bookings }));
  });
}

export const newIdempotencyKey = () => randomUUID();
