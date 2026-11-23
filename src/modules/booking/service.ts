import type { BookingSource, BookingStatus } from "@/generated/prisma/client";
import { audit, type Actor } from "@/lib/audit";
import { isExclusionViolation, isUniqueViolation } from "@/lib/db/errors";
import { withTenant, type TenantContext, type Tx } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { customerContactKey, fingerprint, generateBookingCode } from "./code";
import { resolvePrice } from "./pricing";
import { findSlot, type Slot } from "./time";

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
export const ACTIVE_STATUSES: readonly BookingStatus[] = ["PENDING", "CONFIRMED"];

const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  PENDING: ["CONFIRMED", "REJECTED", "CANCELLED"],
  CONFIRMED: ["CANCELLED", "COMPLETED", "NO_SHOW"],
  CANCELLED: [],
  REJECTED: [],
  COMPLETED: [],
  NO_SHOW: [],
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
    },
  });
  if (!tenant) throw new AppError("TENANT_NOT_FOUND");
  if (tenant.status !== "ACTIVE") throw new AppError("TENANT_SUSPENDED");
  return tenant;
}

async function loadCourt(tx: Tx, tenantId: string, courtId: string) {
  // Filtro explícito por tenant ADEMÁS de RLS (defensa en profundidad).
  const court = await tx.court.findFirst({
    where: { id: courtId, tenantId, isActive: true },
    select: {
      id: true,
      slotStepMinutes: true,
      allowedDurations: true,
      scheduleRules: { select: { weekday: true, openMinute: true, closeMinute: true } },
      priceRules: {
        select: { durationMinutes: true, weekday: true, startMinute: true, endMinute: true, amount: true },
      },
    },
  });
  if (!court) throw new AppError("COURT_NOT_FOUND");
  return court;
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
        const court = await loadCourt(tx, ctx.tenantId, input.courtId);
        const minLead = input.source === "ONLINE" ? tenant.minLeadMinutes : 0;
        const slot = validateSlot(tenant, court, input.startsAt, input.durationMinutes, minLead, now);

        const customerId = await upsertCustomer(tx, ctx.tenantId, {
          name: input.customer.name.trim(),
          phone: input.customer.phone.trim(),
          email,
        });

        const status: BookingStatus =
          input.source === "ONLINE" && tenant.bookingRequiresApproval ? "PENDING" : "CONFIRMED";

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
          },
          select: SUMMARY_SELECT,
        });

        await audit(tx, {
          tenantId: ctx.tenantId,
          actor,
          action: "booking.created",
          entityType: "booking",
          entityId: booking.id,
          metadata: { source: input.source, status, courtId: court.id, startsAt: slot.startsAt.toISOString() },
        });

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
  return withTenant(ctx, async (tx) => {
    const current = await tx.booking.findFirst({
      where: { id: input.bookingId, tenantId: ctx.tenantId },
      select: SUMMARY_SELECT,
    });
    if (!current) throw new AppError("BOOKING_NOT_FOUND");
    if (current.version !== input.expectedVersion) throw new AppError("STALE_VERSION");
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
        ...(input.to === "CONFIRMED" ? { confirmedAt: now } : {}),
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

    const updated = await tx.booking.findFirstOrThrow({
      where: { id: current.id, tenantId: ctx.tenantId },
      select: SUMMARY_SELECT,
    });
    return toSummary(updated);
  });
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
      if (current.version !== input.expectedVersion) throw new AppError("STALE_VERSION");
      if (!ACTIVE_STATUSES.includes(current.status)) throw new AppError("INVALID_TRANSITION");

      const tenant = await loadTenantSettings(tx, ctx.tenantId);
      const court = await loadCourt(tx, ctx.tenantId, input.courtId ?? current.courtId);
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

      const updated = await tx.booking.findFirstOrThrow({
        where: { id: current.id, tenantId: ctx.tenantId },
        select: SUMMARY_SELECT,
      });
      return toSummary(updated);
    });
  } catch (e) {
    if (isExclusionViolation(e)) throw new AppError("SLOT_UNAVAILABLE");
    throw e;
  }
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
    if (isExclusionViolation(e)) throw new AppError("BLOCK_CONFLICT");
    throw e;
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
