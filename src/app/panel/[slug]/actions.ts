"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { BookingStatus } from "@/generated/prisma/client";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireTenant } from "@/lib/auth/dal";
import { AppError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";
import { idempotencyKeySchema, uuidSchema } from "@/modules/booking/schemas";
import { changeBookingStatus, createBlock, createBooking, deleteBlock } from "@/modules/booking/service";
import { localDateTimeToInstant } from "@/modules/booking/time";

/**
 * Server Actions del panel. Cada una:
 *  - re-autentica y re-autoriza (requireTenant) aunque la UI ya lo haya hecho;
 *  - resuelve el tenant desde el slug + membresía, no desde datos del form;
 *  - valida con Zod; los servicios vuelven a filtrar por tenant (y RLS debajo).
 * Next.js además rechaza Server Actions con Origin distinto al Host (CSRF).
 */

const statusForm = z.object({
  bookingId: uuidSchema,
  version: z.coerce.number().int().min(1),
  reason: z.string().trim().max(300).optional(),
});

async function setStatus(slug: string, formData: FormData, to: BookingStatus, okMessage: string) {
  return runAction(`booking.${to}`, async () => {
    const { ctx, user } = await requireTenant(slug, "booking.manage");
    const input = parseOrThrow(statusForm, Object.fromEntries(formData));
    await changeBookingStatus(
      ctx,
      { bookingId: input.bookingId, to, expectedVersion: input.version, reason: input.reason },
      { type: "USER", userId: user.id },
    );
    revalidatePath(`/panel/${slug}`);
    return okMessage;
  });
}

export async function confirmBookingAction(slug: string, _p: ActionResult, fd: FormData) {
  return setStatus(slug, fd, "CONFIRMED", "Reserva confirmada.");
}
export async function rejectBookingAction(slug: string, _p: ActionResult, fd: FormData) {
  return setStatus(slug, fd, "REJECTED", "Solicitud rechazada.");
}
export async function cancelBookingAction(slug: string, _p: ActionResult, fd: FormData) {
  return setStatus(slug, fd, "CANCELLED", "Reserva cancelada. El turno quedó libre.");
}

const manualForm = z.object({
  courtId: uuidSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  durationMinutes: z.coerce.number().int().min(15).max(720),
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(6).max(30).regex(/^[0-9+()\s.-]+$/),
  email: z.union([z.literal(""), z.email().max(254)]).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: idempotencyKeySchema,
});

export async function createManualBookingAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction("booking.manual", async () => {
    const { ctx, user, tenant } = await requireTenant(slug, "booking.manage");
    const input = parseOrThrow(manualForm, Object.fromEntries(fd));
    const startsAt = localDateTimeToInstant(input.date, input.time, tenant.timezone);
    if (!startsAt) throw new AppError("INVALID_SLOT");
    const { booking, replayed } = await createBooking(
      ctx,
      {
        courtId: input.courtId,
        startsAt,
        durationMinutes: input.durationMinutes,
        customer: { name: input.name, phone: input.phone, email: input.email || null },
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
        source: "MANUAL",
      },
      { type: "USER", userId: user.id },
    );
    revalidatePath(`/panel/${slug}`);
    return replayed ? `La reserva ya estaba registrada (código ${booking.code}).` : `Reserva registrada. Código ${booking.code}.`;
  });
}

const blockForm = z.object({
  courtId: uuidSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  from: z.string().regex(/^\d{2}:\d{2}$/),
  to: z.string().regex(/^\d{2}:\d{2}$/),
  reason: z.string().trim().min(2).max(200),
});

export async function createBlockAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction("block.create", async () => {
    const { ctx, user, tenant } = await requireTenant(slug, "block.manage");
    const input = parseOrThrow(blockForm, Object.fromEntries(fd));
    const startsAt = localDateTimeToInstant(input.date, input.from, tenant.timezone);
    let endsAt = localDateTimeToInstant(input.date, input.to, tenant.timezone);
    if (!startsAt || !endsAt) throw new AppError("VALIDATION_ERROR");
    // "Hasta" menor o igual que "desde" = termina al día siguiente (p. ej. 22:00 a 02:00).
    if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 86_400_000);
    await createBlock(ctx, { courtId: input.courtId, startsAt, endsAt, reason: input.reason }, { type: "USER", userId: user.id });
    revalidatePath(`/panel/${slug}`);
    return "Horario bloqueado.";
  });
}

export async function deleteBlockAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction("block.delete", async () => {
    const { ctx, user } = await requireTenant(slug, "block.manage");
    const { blockId } = parseOrThrow(z.object({ blockId: uuidSchema }), Object.fromEntries(fd));
    await deleteBlock(ctx, blockId, { type: "USER", userId: user.id });
    revalidatePath(`/panel/${slug}`);
    return "Bloqueo eliminado.";
  });
}
