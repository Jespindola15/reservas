import { z } from "zod";
import { audit, type Actor } from "@/lib/audit";
import { withTenant, type TenantContext, type Tx } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";
import { dbDateToString, stringToDbDate } from "@/modules/booking/time";

/**
 * Gestión de canchas, horarios semanales, excepciones (feriados / días
 * especiales), tarifas e imágenes. Todas las funciones reciben un
 * TenantContext ya autorizado, filtran por tenantId (además de RLS) y auditan.
 */

export const SPORTS = ["FOOTBALL_5", "FOOTBALL_7", "FOOTBALL_11", "PADEL"] as const;
export const SPORT_LABEL: Record<(typeof SPORTS)[number], string> = {
  FOOTBALL_5: "Fútbol 5",
  FOOTBALL_7: "Fútbol 7",
  FOOTBALL_11: "Fútbol 11",
  PADEL: "Pádel",
};
export const ALLOWED_DURATIONS = [60, 90, 120] as const;
export const SLOT_STEPS = [15, 30, 60] as const;
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 1_572_864; // 1,5 MB
const MAX_PRICE_RULES = 100;

const moneyCents = z.coerce.number().int().min(0).max(100_000_000);

export const courtSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sport: z.enum(SPORTS),
  description: z.string().trim().max(500).optional().transform((v) => v || null),
  capacity: z.coerce.number().int().min(1).max(50).nullable().optional(),
  allowedDurations: z
    .array(z.coerce.number().int())
    .min(1, "Elegí al menos una duración")
    .refine((a) => a.every((d) => (ALLOWED_DURATIONS as readonly number[]).includes(d)), "Duración no permitida")
    .transform((a) => [...new Set(a)].sort((x, y) => x - y)),
  slotStepMinutes: z.coerce.number().int().refine((v) => (SLOT_STEPS as readonly number[]).includes(v)),
  basePrice: moneyCents.nullable().optional(),
});
export type CourtInput = z.input<typeof courtSchema>;

async function assertCourt(tx: Tx, tenantId: string, courtId: string) {
  const court = await tx.court.findFirst({ where: { id: courtId, tenantId }, select: { id: true, name: true } });
  if (!court) throw new AppError("COURT_NOT_FOUND");
  return court;
}

// ----------------------------------------------------------------------- Canchas

export async function listCourtsAdmin(ctx: TenantContext) {
  return withTenant(ctx, (tx) =>
    tx.court.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        sport: true,
        description: true,
        isActive: true,
        capacity: true,
        basePrice: true,
        allowedDurations: true,
        slotStepMinutes: true,
        images: { select: { id: true }, orderBy: { sortOrder: "asc" } },
        scheduleRules: { select: { weekday: true, openMinute: true, closeMinute: true }, orderBy: { weekday: "asc" } },
        _count: { select: { bookings: true, priceRules: true } },
      },
    }),
  );
}

export async function getCourtAdmin(ctx: TenantContext, courtId: string) {
  parseOrThrow(z.uuid(), courtId);
  return withTenant(ctx, async (tx) => {
    const court = await tx.court.findFirst({
      where: { id: courtId, tenantId: ctx.tenantId },
      select: {
        id: true,
        name: true,
        sport: true,
        description: true,
        isActive: true,
        capacity: true,
        basePrice: true,
        allowedDurations: true,
        slotStepMinutes: true,
        images: { select: { id: true, sizeBytes: true }, orderBy: { sortOrder: "asc" } },
        scheduleRules: { select: { id: true, weekday: true, openMinute: true, closeMinute: true }, orderBy: { weekday: "asc" } },
        priceRules: {
          select: {
            id: true,
            durationMinutes: true,
            weekday: true,
            startMinute: true,
            endMinute: true,
            specialDate: true,
            amount: true,
          },
          orderBy: [{ specialDate: "asc" }, { durationMinutes: "asc" }, { weekday: "asc" }, { startMinute: "asc" }],
        },
        _count: { select: { bookings: true } },
      },
    });
    if (!court) throw new AppError("COURT_NOT_FOUND");
    return {
      ...court,
      priceRules: court.priceRules.map((r) => ({ ...r, specialDate: r.specialDate ? dbDateToString(r.specialDate) : null })),
    };
  });
}

export async function createCourt(ctx: TenantContext, input: CourtInput, actor: Actor) {
  const data = parseOrThrow(courtSchema, input);
  return withTenant(ctx, async (tx) => {
    const count = await tx.court.count({ where: { tenantId: ctx.tenantId } });
    if (count >= 50) throw new AppError("LIMIT_REACHED");
    const court = await tx.court.create({
      data: { ...data, capacity: data.capacity ?? null, basePrice: data.basePrice ?? null, tenantId: ctx.tenantId, sortOrder: count },
      select: { id: true, name: true },
    });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "court.created", entityType: "court", entityId: court.id, metadata: { name: court.name, sport: data.sport } });
    return court;
  });
}

export async function updateCourt(ctx: TenantContext, courtId: string, input: CourtInput, actor: Actor) {
  parseOrThrow(z.uuid(), courtId);
  const data = parseOrThrow(courtSchema, input);
  return withTenant(ctx, async (tx) => {
    await assertCourt(tx, ctx.tenantId, courtId);
    await tx.court.updateMany({
      where: { id: courtId, tenantId: ctx.tenantId },
      data: { ...data, capacity: data.capacity ?? null, basePrice: data.basePrice ?? null },
    });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "court.updated", entityType: "court", entityId: courtId, metadata: { ...data } });
  });
}

/** Desactivar no borra historial: la cancha deja de ofrecer turnos nuevos. */
export async function setCourtActive(ctx: TenantContext, courtId: string, active: boolean, actor: Actor) {
  parseOrThrow(z.uuid(), courtId);
  return withTenant(ctx, async (tx) => {
    await assertCourt(tx, ctx.tenantId, courtId);
    await tx.court.updateMany({ where: { id: courtId, tenantId: ctx.tenantId }, data: { isActive: active } });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: active ? "court.activated" : "court.deactivated", entityType: "court", entityId: courtId });
  });
}

/** Borrado físico SOLO si nunca tuvo reservas. Con historial: desactivar. */
export async function deleteCourt(ctx: TenantContext, courtId: string, actor: Actor) {
  parseOrThrow(z.uuid(), courtId);
  return withTenant(ctx, async (tx) => {
    const court = await assertCourt(tx, ctx.tenantId, courtId);
    const bookings = await tx.booking.count({ where: { tenantId: ctx.tenantId, courtId } });
    if (bookings > 0) throw new AppError("COURT_HAS_HISTORY");
    await tx.court.deleteMany({ where: { id: courtId, tenantId: ctx.tenantId } });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "court.deleted", entityType: "court", entityId: courtId, metadata: { name: court.name } });
  });
}

// ------------------------------------------------------------- Horario semanal

const dayScheduleSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    openMinute: z.number().int().min(0).max(1439),
    closeMinute: z.number().int().min(1).max(2880),
  })
  .refine((d) => d.closeMinute > d.openMinute && d.closeMinute <= d.openMinute + 1440, "Horario inválido");

export const weeklyScheduleSchema = z
  .array(dayScheduleSchema)
  .max(21)
  .refine((days) => {
    // Sin franjas superpuestas dentro del mismo día.
    for (const d of days) {
      const overlap = days.filter((o) => o !== d && o.weekday === d.weekday && o.openMinute < d.closeMinute && d.openMinute < o.closeMinute);
      if (overlap.length) return false;
    }
    return true;
  }, "Hay franjas superpuestas en un mismo día");

/**
 * Reemplaza el horario semanal de una o varias canchas (atómico).
 * Las reservas ya tomadas no se modifican; las nuevas respetan el horario nuevo.
 */
export async function replaceWeeklySchedule(
  ctx: TenantContext,
  courtIds: string[],
  days: z.input<typeof weeklyScheduleSchema>,
  actor: Actor,
) {
  const ids = parseOrThrow(z.array(z.uuid()).min(1).max(50), courtIds);
  const schedule = parseOrThrow(weeklyScheduleSchema, days);
  return withTenant(ctx, async (tx) => {
    for (const courtId of ids) {
      await assertCourt(tx, ctx.tenantId, courtId);
      await tx.courtScheduleRule.deleteMany({ where: { tenantId: ctx.tenantId, courtId } });
      if (schedule.length) {
        await tx.courtScheduleRule.createMany({
          data: schedule.map((d) => ({ ...d, tenantId: ctx.tenantId, courtId })),
        });
      }
      await audit(tx, {
        tenantId: ctx.tenantId,
        actor,
        action: "court.schedule.replaced",
        entityType: "court",
        entityId: courtId,
        metadata: { days: schedule },
      });
    }
  });
}

// --------------------------------------------- Feriados, cierres y días especiales

export const exceptionSchema = z
  .object({
    courtId: z.uuid().nullable(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(["CLOSED", "SPECIAL_HOURS"]),
    openMinute: z.number().int().min(0).max(1439).nullable(),
    closeMinute: z.number().int().min(1).max(2880).nullable(),
    reason: z.string().trim().min(2).max(200),
  })
  .refine(
    (e) =>
      e.kind === "CLOSED"
        ? e.openMinute === null && e.closeMinute === null
        : e.openMinute !== null && e.closeMinute !== null && e.closeMinute > e.openMinute && e.closeMinute <= e.openMinute + 1440,
    "Horario especial inválido",
  );

export async function createScheduleException(ctx: TenantContext, input: z.input<typeof exceptionSchema>, actor: Actor) {
  const data = parseOrThrow(exceptionSchema, input);
  return withTenant(ctx, async (tx) => {
    if (data.courtId) await assertCourt(tx, ctx.tenantId, data.courtId);
    const count = await tx.scheduleException.count({ where: { tenantId: ctx.tenantId } });
    if (count >= 1000) throw new AppError("LIMIT_REACHED");
    const ex = await tx.scheduleException.create({
      data: { ...data, date: stringToDbDate(data.date), tenantId: ctx.tenantId },
      select: { id: true },
    });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "schedule.exception.created", entityType: "schedule_exception", entityId: ex.id, metadata: { ...data } });
    return ex;
  });
}

export async function deleteScheduleException(ctx: TenantContext, exceptionId: string, actor: Actor) {
  parseOrThrow(z.uuid(), exceptionId);
  return withTenant(ctx, async (tx) => {
    const res = await tx.scheduleException.deleteMany({ where: { id: exceptionId, tenantId: ctx.tenantId } });
    if (res.count !== 1) throw new AppError("NOT_FOUND");
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "schedule.exception.deleted", entityType: "schedule_exception", entityId: exceptionId });
  });
}

export async function listScheduleExceptions(ctx: TenantContext, fromDate: string) {
  parseOrThrow(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), fromDate);
  const rows = await withTenant(ctx, (tx) =>
    tx.scheduleException.findMany({
      where: { tenantId: ctx.tenantId, date: { gte: stringToDbDate(fromDate) } },
      orderBy: [{ date: "asc" }],
      take: 200,
      select: { id: true, courtId: true, date: true, kind: true, openMinute: true, closeMinute: true, reason: true, court: { select: { name: true } } },
    }),
  );
  return rows.map((r) => ({ ...r, date: dbDateToString(r.date) }));
}

// ---------------------------------------------------------------------- Tarifas

export const priceRuleSchema = z
  .object({
    durationMinutes: z.number().int().refine((d) => (ALLOWED_DURATIONS as readonly number[]).includes(d)),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
    startMinute: z.number().int().min(0).max(2879).nullable(),
    endMinute: z.number().int().min(1).max(2880).nullable(),
    specialDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    amount: moneyCents,
  })
  .refine((r) => (r.startMinute === null) === (r.endMinute === null), "Completá desde y hasta")
  .refine((r) => r.startMinute === null || r.endMinute! > r.startMinute, "La franja debe terminar después de empezar");

/**
 * Agrega una tarifa. `weekdays` vacío = todos los días; [6,7] = fin de semana
 * (crea una regla por día). specialDate = tarifa para una fecha puntual.
 */
export async function addPriceRule(ctx: TenantContext, courtId: string, input: z.input<typeof priceRuleSchema>, actor: Actor) {
  parseOrThrow(z.uuid(), courtId);
  const r = parseOrThrow(priceRuleSchema, input);
  return withTenant(ctx, async (tx) => {
    await assertCourt(tx, ctx.tenantId, courtId);
    const existing = await tx.courtPriceRule.count({ where: { tenantId: ctx.tenantId, courtId } });
    const days: (number | null)[] = r.specialDate || r.weekdays.length === 0 ? [null] : [...new Set(r.weekdays)];
    if (existing + days.length > MAX_PRICE_RULES) throw new AppError("LIMIT_REACHED");
    await tx.courtPriceRule.createMany({
      data: days.map((weekday) => ({
        tenantId: ctx.tenantId,
        courtId,
        durationMinutes: r.durationMinutes,
        weekday,
        startMinute: r.startMinute,
        endMinute: r.endMinute,
        specialDate: r.specialDate ? stringToDbDate(r.specialDate) : null,
        amount: r.amount,
      })),
    });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "court.price_rule.created", entityType: "court", entityId: courtId, metadata: { ...r } });
  });
}

export async function deletePriceRule(ctx: TenantContext, ruleId: string, actor: Actor) {
  parseOrThrow(z.uuid(), ruleId);
  return withTenant(ctx, async (tx) => {
    const rule = await tx.courtPriceRule.findFirst({ where: { id: ruleId, tenantId: ctx.tenantId }, select: { courtId: true, amount: true } });
    if (!rule) throw new AppError("NOT_FOUND");
    await tx.courtPriceRule.deleteMany({ where: { id: ruleId, tenantId: ctx.tenantId } });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "court.price_rule.deleted", entityType: "court", entityId: rule.courtId, metadata: { ruleId, amount: rule.amount } });
  });
}

// ---------------------------------------------------------------------- Imágenes

/** Detecta el tipo por la FIRMA de bytes (no se confía en el nombre ni en el MIME del navegador). */
export function sniffImageType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function addCourtImage(ctx: TenantContext, courtId: string, bytes: Uint8Array, actor: Actor) {
  parseOrThrow(z.uuid(), courtId);
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new AppError("IMAGE_INVALID");
  const contentType = sniffImageType(bytes);
  if (!contentType) throw new AppError("IMAGE_INVALID");
  return withTenant(ctx, async (tx) => {
    await assertCourt(tx, ctx.tenantId, courtId);
    const count = await tx.courtImage.count({ where: { tenantId: ctx.tenantId, courtId } });
    if (count >= MAX_IMAGES) throw new AppError("LIMIT_REACHED");
    const img = await tx.courtImage.create({
      data: { tenantId: ctx.tenantId, courtId, contentType, data: Buffer.from(bytes), sizeBytes: bytes.length, sortOrder: count },
      select: { id: true },
    });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "court.image.added", entityType: "court", entityId: courtId, metadata: { imageId: img.id, bytes: bytes.length, contentType } });
    return img;
  });
}

export async function deleteCourtImage(ctx: TenantContext, imageId: string, actor: Actor) {
  parseOrThrow(z.uuid(), imageId);
  return withTenant(ctx, async (tx) => {
    const img = await tx.courtImage.findFirst({ where: { id: imageId, tenantId: ctx.tenantId }, select: { courtId: true } });
    if (!img) throw new AppError("NOT_FOUND");
    await tx.courtImage.deleteMany({ where: { id: imageId, tenantId: ctx.tenantId } });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "court.image.deleted", entityType: "court", entityId: img.courtId, metadata: { imageId } });
  });
}

/** Lectura de una imagen para servirla (contexto público o de panel). */
export async function getCourtImage(ctx: TenantContext, courtId: string, imageId: string) {
  return withTenant(ctx, (tx) =>
    tx.courtImage.findFirst({
      where: { id: imageId, courtId, tenantId: ctx.tenantId },
      select: { contentType: true, data: true },
    }),
  );
}
