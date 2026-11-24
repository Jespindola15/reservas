import type { BookingSource, BookingStatus } from "@/generated/prisma/client";
import { audit, type Actor } from "@/lib/audit";
import { isExclusionViolation, isRaised, isUniqueViolation } from "@/lib/db/errors";
import { withTenant, type TenantContext, type Tx } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { enqueueBookingEvent } from "@/modules/notifications/outbox";
import { customerContactKey, fingerprint, generateBookingCode } from "./code";
import { resolvePrice } from "./pricing";
import { dbDateToString, findSlot, stringToDbDate, type ScheduleExceptionInput, type Slot } from "./time";

/**
 * MOTOR DE RESERVAS
 * =================
 * Capas de defensa contra reservas superpuestas (de afuera hacia adentro):
 *  1. Validación de entrada (Zod) y de reglas de negocio en el servidor:
 *     cancha del complejo, duración permitida, turno en grilla y dentro del
 *     horario, anticipación mínima/máxima.
 *  2. Transacción con contexto de tenant (RLS) para todas las lecturas/escrituras.
 *  3. ÚLTIMA BARRERA: restricción EXCLUDE en court_allocations. Aunque 100
 *     solicitudes pasen las validaciones a la vez, PostgreSQL deja confirmar
 *     solo una; el resto recibe 23P01 y se traduce a SLOT_UNAVAILABLE.
 *
 * Reservas ONLINE y MANUALES usan exactamente el mismo camino (`createBooking`).
 * Solo cambian: estado inicial y anticipación mínima.
 */

export const OCCUPYING_STATUSES: readonly BookingStatus[] = ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"];
export const CLOSED_STATUSES: readonly BookingStatus[] = ["CANCELLED", "REJECTED", "EXPIRED"];

/** Traduce rechazos de la base (triggers/restricciones) a errores de dominio. */
export function mapDbError(e: unknown, overlapCode: "SLOT_UNAVAILABLE" | "BLOCK_CONFLICT" = "SLOT_UNAVAILABLE"): unknown {
  if (isExclusionViolation(e)) return new AppError(overlapCode);
  if (isRaised(e, "booking_expired")) return new AppError("BOOKING_EXPIRED");
  if (isRaised(e, "booking_final_state")) return new AppError("BOOKING_CLOSED");
  return e;
}

/**
 * Vence (en la misma transacción) las PENDING atrasadas del complejo, para que
 * un turno retenido por una solicitud vencida quede libre aunque el job no
 * haya corrido todavía. Usa la misma función que el job (SKIP LOCKED, idempotente).
 */
async function expireOverdueInTenant(tx: Tx, tenantId: string) {
  await tx.$queryRaw`SELECT booking_id FROM app_expire_pending_bookings(1000, ${tenantId}::uuid)`;
}
/** Máximo de reservas online activas (futuras, pendientes o confirmadas) por jugador y complejo. */
export const MAX_ACTIVE_ONLINE_PER_CUSTOMER = 4;
export const ACTIVE_STATUSES: readonly BookingStatus[] = ["PENDING", "CONFIRMED"];

const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  PENDING: ["CONFIRMED", "REJECTED", "CANCELLED", "EXPIRED"],
  CONFIRMED: ["CANCELLED", "COMPLETED", "NO_SHOW"],
  CANCELLED: [],
  REJECTED: [],
  COMPLETED: [],
  NO_SHOW: [],
  EXPIRED: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type CreateBookingInput = {
  courtId: string;
  startsAt: Date;
  durationMinutes: number;
  customer: { name: string; phone: string; email?: string | null };
  notes?: string | null;
  idempotencyKey: string;
  source: BookingSource;
};

export type BookingSummary = {
  id: string;
  code: string;
  status: BookingStatus;
  courtId: string;
  startsAt: Date;
  endsAt: Date;
  durationMinutes: number;
  priceAmount: number | null;
  currency: string;
  version: number;
  expiresAt: Date | null;
};

export type CreateBookingResult = { booking: BookingSummary; replayed: boolean };

type Options = { now?: Date };

const SUMMARY_SELECT = {
  id: true,
  code: true,
  status: true,
  courtId: true,
  startsAt: true,
  endsAt: true,
  durationMinutes: true,
  priceAmount: true,
  currency: true,
  version: true,
  expiresAt: true,
  requestFingerprint: true,
} as const;

function toSummary(b: BookingSummary & { requestFingerprint?: string | null }): BookingSummary {
  const { requestFingerprint: _ignored, ...rest } = b;
  void _ignored;
  return rest;
}

// -----------------------------------------------------------------------------
// Carga y validación compartida
// -----------------------------------------------------------------------------

async function loadTenantSettings(tx: Tx, tenantId: string) {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      status: true,
      timezone: true,
      currency: true,
      bookingRequiresApproval: true,
      minLeadMinutes: true,
      maxAdvanceDays: true,
      pendingExpirationMinutes: true,
    },
  });
  if (!tenant) throw new AppError("TENANT_NOT_FOUND");
  if (tenant.status !== "ACTIVE") throw new AppError("TENANT_SUSPENDED");
  return tenant;
}

export const PRICE_RULE_SELECT = {
  durationMinutes: true,
  weekday: true,
  startMinute: true,
  endMinute: true,
  specialDate: true,
  amount: true,
} as const;

export function toPriceRules(
  rules: { durationMinutes: number; weekday: number | null; startMinute: number | null; endMinute: number | null; specialDate: Date | null; amount: number }[],
) {
  return rules.map((r) => ({ ...r, specialDate: r.specialDate ? dbDateToString(r.specialDate) : null }));
}

/** Excepciones (feriados / días especiales) que aplican a una cancha en un rango de fechas. */
export async function loadExceptions(
  tx: Tx,
  tenantId: string,
  courtId: string,
  from: string,
  to: string,
): Promise<ScheduleExceptionInput[]> {
  const rows = await tx.scheduleException.findMany({
    where: {
      tenantId,
      OR: [{ courtId: null }, { courtId }],
      date: { gte: stringToDbDate(from), lte: stringToDbDate(to) },
    },
    select: { date: true, kind: true, openMinute: true, closeMinute: true },
  });
  return rows.map((r) => ({ ...r, date: dbDateToString(r.date) }));
}

async function loadCourt(tx: Tx, tenantId: string, courtId: string, around: Date) {
  // Filtro explícito por tenant ADEMÁS de RLS (defensa en profundidad).
  const court = await tx.court.findFirst({
    where: { id: courtId, tenantId, isActive: true },
    select: {
      id: true,
      slotStepMinutes: true,
      allowedDurations: true,
      basePrice: true,
      scheduleRules: { select: { weekday: true, openMinute: true, closeMinute: true } },
      priceRules: { select: PRICE_RULE_SELECT },
    },
  });
  if (!court) throw new AppError("COURT_NOT_FOUND");
  // Margen de ±2 días UTC: cubre el día operativo anterior y cualquier zona horaria.
  const from = new Date(around.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(around.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  const exceptions = Number.isNaN(around.getTime()) ? [] : await loadExceptions(tx, tenantId, court.id, from, to);
  return { ...court, priceRules: toPriceRules(court.priceRules), exceptions };
}

type LoadedCourt = Awaited<ReturnType<typeof loadCourt>>;
type LoadedTenant = Awaited<ReturnType<typeof loadTenantSettings>>;

function validateSlot(
  tenant: LoadedTenant,
  court: LoadedCourt,
  startsAt: Date,
  durationMinutes: number,
  minLeadMinutes: number,
  now: Date,
): Slot {
  if (!court.allowedDurations.includes(durationMinutes)) throw new AppError("INVALID_DURATION");
  if (Number.isNaN(startsAt.getTime())) throw new AppError("INVALID_SLOT");

  const slot = findSlot({
    startsAt,
    durationMinutes,
    tz: tenant.timezone,
    rules: court.scheduleRules,
    stepMinutes: court.slotStepMinutes,
    exceptions: court.exceptions,
  });
  if (!slot) throw new AppError("INVALID_SLOT");

  if (slot.startsAt.getTime() < now.getTime() + minLeadMinutes * 60_000) throw new AppError("SLOT_IN_PAST");
  const maxAhead = now.getTime() + tenant.maxAdvanceDays * 86_400_000;
  if (slot.startsAt.getTime() > maxAhead) throw new AppError("SLOT_TOO_FAR");
  return slot;
}

function priceFor(court: LoadedCourt, slot: Slot, durationMinutes: number) {
  return resolvePrice(court.priceRules, {
    durationMinutes,
    weekday: slot.weekday,
    localMinute: slot.localMinute,
    operatingDate: slot.operatingDate,
    basePrice: court.basePrice,
  });
}

// -----------------------------------------------------------------------------
// Crear reserva (online o manual)
// -----------------------------------------------------------------------------

export async function createBooking(
  ctx: TenantContext,
  input: CreateBookingInput,
  actor: Actor,
  opts: Options = {},
): Promise<CreateBookingResult> {
  const now = opts.now ?? new Date();
  const email = input.customer.email?.trim().toLowerCase() || null;
  const fp = fingerprint({
    courtId: input.courtId,
    startsAt: input.startsAt.getTime(),
    durationMinutes: input.durationMinutes,
    name: input.customer.name.trim(),
    phone: input.customer.phone.trim(),
    email,
    source: input.source,
  });

  // Reintenta solo ante colisión del código aleatorio (muy improbable).
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await withTenant(ctx, async (tx) => {
        const existing = await tx.booking.findUnique({
          where: { tenantId_idempotencyKey: { tenantId: ctx.tenantId, idempotencyKey: input.idempotencyKey } },
          select: SUMMARY_SELECT,
        });
        if (existing) return replay(existing, fp);

        const tenant = await loadTenantSettings(tx, ctx.tenantId);
        const court = await loadCourt(tx, ctx.tenantId, input.courtId, input.startsAt);
        const minLead = input.source === "ONLINE" ? tenant.minLeadMinutes : 0;
        const slot = validateSlot(tenant, court, input.startsAt, input.durationMinutes, minLead, now);

        await expireOverdueInTenant(tx, ctx.tenantId);

        const customerId = await upsertCustomer(tx, ctx.tenantId, {
          name: input.customer.name.trim(),
          phone: input.customer.phone.trim(),
          email,
        });

        // Anti reservas falsas: un mismo jugador (email o teléfono) no puede acaparar turnos online.
        if (input.source === "ONLINE") {
          const active = await tx.booking.count({
            where: { tenantId: ctx.tenantId, customerId, status: { in: ["PENDING", "CONFIRMED"] }, endsAt: { gt: now } },
          });
          if (active >= MAX_ACTIVE_ONLINE_PER_CUSTOMER) {
            throw new AppError("LIMIT_REACHED", { resource: "active_bookings", max: MAX_ACTIVE_ONLINE_PER_CUSTOMER });
          }
        }

        const status: BookingStatus =
          input.source === "ONLINE" && tenant.bookingRequiresApproval ? "PENDING" : "CONFIRMED";
        // Reglas explícitas: solo las solicitudes PENDING vencen; nunca después del inicio del turno.
        const expiresAt =
          status === "PENDING"
            ? new Date(Math.min(now.getTime() + tenant.pendingExpirationMinutes * 60_000, slot.startsAt.getTime()))
            : null;

        const booking = await tx.booking.create({
          data: {
            tenantId: ctx.tenantId,
            courtId: court.id,
            customerId,
            code: generateBookingCode(),
            status,
            source: input.source,
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            durationMinutes: input.durationMinutes,
            priceAmount: priceFor(court, slot, input.durationMinutes),
            currency: tenant.currency,
            customerName: input.customer.name.trim(),
            customerPhone: input.customer.phone.trim(),
            customerEmail: email,
            notes: input.notes?.trim() || null,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: fp,
            createdByUserId: actor.userId,
            confirmedAt: status === "CONFIRMED" ? now : null,
            expiresAt,
          },
          select: SUMMARY_SELECT,
        });

        await audit(tx, {
          tenantId: ctx.tenantId,
          actor,
          action: "booking.created",
          entityType: "booking",
          entityId: booking.id,
          metadata: {
            source: input.source,
            status,
            courtId: court.id,
            startsAt: slot.startsAt.toISOString(),
            expiresAt: expiresAt?.toISOString() ?? null,
          },
        });
        // Outbox: los avisos existen solo si esta transacción confirma.
        await enqueueBookingEvent(tx, ctx.tenantId, booking.id, { type: "created" });

        return { booking: toSummary(booking), replayed: false };
      });
    } catch (e) {
      if (isExclusionViolation(e)) throw new AppError("SLOT_UNAVAILABLE");
      if (isUniqueViolation(e, "bookings_tenant_id_idempotency_key_key")) {
        // Otra solicitud con la misma clave ganó la carrera: devolver su resultado.
        const winner = await withTenant(ctx, (tx) =>
          tx.booking.findUnique({
            where: { tenantId_idempotencyKey: { tenantId: ctx.tenantId, idempotencyKey: input.idempotencyKey } },
            select: SUMMARY_SELECT,
          }),
        );
        if (winner) return replay(winner, fp);
        throw e;
      }
      if (isUniqueViolation(e, "bookings_tenant_id_code_key")) continue;
      throw e;
    }
  }
  throw new AppError("INTERNAL");
}

function replay(existing: BookingSummary & { requestFingerprint: string | null }, fp: string): CreateBookingResult {
  if (existing.requestFingerprint !== fp) throw new AppError("IDEMPOTENCY_MISMATCH");
  return { booking: toSummary(existing), replayed: true };
}

async function upsertCustomer(
  tx: Tx,
  tenantId: string,
  c: { name: string; phone: string; email: string | null },
): Promise<string> {
  const key = customerContactKey(c.email, c.phone);
  // Atómico ante concurrencia. Datos existentes NO se sobrescriben desde una
  // solicitud (evita que alguien cambie el nombre/teléfono de otro cliente);
  // solo se completan campos vacíos.
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO customers (tenant_id, contact_key, name, phone, email)
    VALUES (${tenantId}::uuid, ${key}, ${c.name}, ${c.phone}, ${c.email})
    ON CONFLICT (tenant_id, contact_key) DO UPDATE SET
      phone = COALESCE(customers.phone, EXCLUDED.phone),
      email = COALESCE(customers.email, EXCLUDED.email),
      updated_at = now()
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) throw new AppError("INTERNAL");
  return id;
}

// -----------------------------------------------------------------------------
// Cambios de estado (confirmar, rechazar, cancelar, completar, ausente)
// -----------------------------------------------------------------------------

export async function changeBookingStatus(
  ctx: TenantContext,
  input: { bookingId: string; to: BookingStatus; expectedVersion: number; reason?: string | null },
  actor: Actor,
  opts: Options = {},
): Promise<BookingSummary> {
  const now = opts.now ?? new Date();
  try {
  return await withTenant(ctx, async (tx) => {
    const current = await tx.booking.findFirst({
      where: { id: input.bookingId, tenantId: ctx.tenantId },
      select: SUMMARY_SELECT,
    });
    if (!current) throw new AppError("BOOKING_NOT_FOUND");
    if (CLOSED_STATUSES.includes(current.status)) throw new AppError("BOOKING_CLOSED");
    if (current.version !== input.expectedVersion) throw new AppError("STALE_VERSION");
    if (
      current.status === "PENDING" &&
      input.to === "CONFIRMED" &&
      current.expiresAt &&
      current.expiresAt.getTime() <= now.getTime()
    ) {
      throw new AppError("BOOKING_EXPIRED");
    }
    if (!canTransition(current.status, input.to)) throw new AppError("INVALID_TRANSITION");
    if ((input.to === "COMPLETED" || input.to === "NO_SHOW") && current.startsAt > now) {
      throw new AppError("INVALID_TRANSITION");
    }

    // Actualización condicionada: si otro cambio se coló entre la lectura y la
    // escritura, count = 0 y no se pisa nada (optimistic locking).
    const res = await tx.booking.updateMany({
      where: {
        id: current.id,
        tenantId: ctx.tenantId,
        version: input.expectedVersion,
        status: current.status,
      },
      data: {
        status: input.to,
        version: { increment: 1 },
        ...(input.to === "CONFIRMED" ? { confirmedAt: now, expiresAt: null } : {}),
        ...(input.to === "CANCELLED" || input.to === "REJECTED"
          ? { cancelledAt: now, cancelReason: input.reason?.trim() || null }
          : {}),
      },
    });
    if (res.count !== 1) throw new AppError("STALE_VERSION");

    await audit(tx, {
      tenantId: ctx.tenantId,
      actor,
      action: `booking.status.${input.to.toLowerCase()}`,
      entityType: "booking",
      entityId: current.id,
      metadata: { from: current.status, to: input.to, reason: input.reason ?? null },
    });
    if (input.to === "CONFIRMED") await enqueueBookingEvent(tx, ctx.tenantId, current.id, { type: "confirmed" });
    if (input.to === "CANCELLED") await enqueueBookingEvent(tx, ctx.tenantId, current.id, { type: "cancelled", by: "complex", reason: input.reason });
    if (input.to === "REJECTED") await enqueueBookingEvent(tx, ctx.tenantId, current.id, { type: "rejected", reason: input.reason });

    const updated = await tx.booking.findFirstOrThrow({
      where: { id: current.id, tenantId: ctx.tenantId },
      select: SUMMARY_SELECT,
    });
    return toSummary(updated);
  });
  } catch (e) {
    throw mapDbError(e);
  }
}

// -----------------------------------------------------------------------------
// Reprogramación (atómica: o se mueve completa o no cambia nada)
// -----------------------------------------------------------------------------

export async function rescheduleBooking(
  ctx: TenantContext,
  input: { bookingId: string; startsAt: Date; durationMinutes: number; courtId?: string; expectedVersion: number },
  actor: Actor,
  opts: Options = {},
): Promise<BookingSummary> {
  const now = opts.now ?? new Date();
  try {
    return await withTenant(ctx, async (tx) => {
      const current = await tx.booking.findFirst({
        where: { id: input.bookingId, tenantId: ctx.tenantId },
        select: SUMMARY_SELECT,
      });
      if (!current) throw new AppError("BOOKING_NOT_FOUND");
      if (CLOSED_STATUSES.includes(current.status)) throw new AppError("BOOKING_CLOSED");
      if (current.version !== input.expectedVersion) throw new AppError("STALE_VERSION");
      if (!ACTIVE_STATUSES.includes(current.status)) throw new AppError("INVALID_TRANSITION");
      if (current.status === "PENDING" && current.expiresAt && current.expiresAt.getTime() <= now.getTime()) {
        throw new AppError("BOOKING_EXPIRED");
      }

      const tenant = await loadTenantSettings(tx, ctx.tenantId);
      await expireOverdueInTenant(tx, ctx.tenantId);
      const court = await loadCourt(tx, ctx.tenantId, input.courtId ?? current.courtId, input.startsAt);
      const slot = validateSlot(tenant, court, input.startsAt, input.durationMinutes, 0, now);

      const res = await tx.booking.updateMany({
        where: {
          id: current.id,
          tenantId: ctx.tenantId,
          version: input.expectedVersion,
          status: { in: [...ACTIVE_STATUSES] },
        },
        data: {
          courtId: court.id,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          durationMinutes: input.durationMinutes,
          priceAmount: priceFor(court, slot, input.durationMinutes),
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw new AppError("STALE_VERSION");

      await audit(tx, {
        tenantId: ctx.tenantId,
        actor,
        action: "booking.rescheduled",
        entityType: "booking",
        entityId: current.id,
        metadata: {
          from: { courtId: current.courtId, startsAt: current.startsAt.toISOString(), duration: current.durationMinutes },
          to: { courtId: court.id, startsAt: slot.startsAt.toISOString(), duration: input.durationMinutes },
        },
      });
      const fromCourt = await tx.court.findFirst({ where: { id: current.courtId, tenantId: ctx.tenantId }, select: { name: true } });
      await enqueueBookingEvent(tx, ctx.tenantId, current.id, {
        type: "rescheduled",
        fromStartsAt: current.startsAt.toISOString(),
        fromCourtName: fromCourt?.name ?? "",
      });

      const updated = await tx.booking.findFirstOrThrow({
        where: { id: current.id, tenantId: ctx.tenantId },
        select: SUMMARY_SELECT,
      });
      return toSummary(updated);
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

/** Observaciones internas del complejo sobre una reserva (auditado, sin mostrar al jugador). */
export async function setBookingInternalNotes(
  ctx: TenantContext,
  input: { bookingId: string; notes: string },
  actor: Actor,
) {
  return withTenant(ctx, async (tx) => {
    const res = await tx.booking.updateMany({
      where: { id: input.bookingId, tenantId: ctx.tenantId },
      data: { internalNotes: input.notes.trim() || null },
    });
    if (res.count !== 1) throw new AppError("BOOKING_NOT_FOUND");
    await audit(tx, {
      tenantId: ctx.tenantId,
      actor,
      action: "booking.internal_notes.updated",
      entityType: "booking",
      entityId: input.bookingId,
      metadata: { length: input.notes.trim().length },
    });
  });
}

// -----------------------------------------------------------------------------
// Bloqueos administrativos (mantenimiento, eventos)
// -----------------------------------------------------------------------------

export async function createBlock(
  ctx: TenantContext,
  input: { courtId: string; startsAt: Date; endsAt: Date; reason: string },
  actor: Actor,
  opts: Options = {},
) {
  const now = opts.now ?? new Date();
  if (!(input.endsAt > input.startsAt)) throw new AppError("VALIDATION_ERROR");
  if (input.endsAt <= now) throw new AppError("SLOT_IN_PAST");
  if (input.endsAt.getTime() - input.startsAt.getTime() > 31 * 86_400_000) throw new AppError("VALIDATION_ERROR");
  try {
    return await withTenant(ctx, async (tx) => {
      const court = await tx.court.findFirst({
        where: { id: input.courtId, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!court) throw new AppError("COURT_NOT_FOUND");
      const block = await tx.availabilityBlock.create({
        data: {
          tenantId: ctx.tenantId,
          courtId: court.id,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          reason: input.reason.trim(),
          createdByUserId: actor.userId,
        },
        select: { id: true, courtId: true, startsAt: true, endsAt: true, reason: true },
      });
      await audit(tx, {
        tenantId: ctx.tenantId,
        actor,
        action: "block.created",
        entityType: "availability_block",
        entityId: block.id,
        metadata: { courtId: court.id, startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString() },
      });
      return block;
    });
  } catch (e) {
    throw mapDbError(e, "BLOCK_CONFLICT");
  }
}

export async function deleteBlock(ctx: TenantContext, blockId: string, actor: Actor) {
  return withTenant(ctx, async (tx) => {
    const res = await tx.availabilityBlock.deleteMany({ where: { id: blockId, tenantId: ctx.tenantId } });
    if (res.count !== 1) throw new AppError("NOT_FOUND");
    await audit(tx, {
      tenantId: ctx.tenantId,
      actor,
      action: "block.deleted",
      entityType: "availability_block",
      entityId: blockId,
    });
  });
}
