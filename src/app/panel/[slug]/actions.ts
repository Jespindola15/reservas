"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { BookingStatus } from "@/generated/prisma/client";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireTenant } from "@/lib/auth/dal";
import { AppError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";
import { idempotencyKeySchema, uuidSchema } from "@/modules/booking/schemas";
import { changeBookingStatus, createBlock, createBooking, deleteBlock, rescheduleBooking, setBookingInternalNotes } from "@/modules/booking/service";
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

async function setStatus(slug: string, formData: FormData, to: BookingStatus, okMessage: string): Promise<ActionResult> {
  let done: string | null = null;
  const res = await runAction(`booking.${to}`, async () => {
    const { ctx, user } = await requireTenant(slug, "booking.manage");
    const input = parseOrThrow(statusForm, Object.fromEntries(formData));
    await changeBookingStatus(
      ctx,
      { bookingId: input.bookingId, to, expectedVersion: input.version, reason: input.reason },
      { type: "USER", userId: user.id },
    );
    revalidatePath(`/panel/${slug}`, "layout");
    done = input.bookingId;
    return okMessage;
  });
  // El aviso viaja en la URL (lista blanca de claves) para que sobreviva al refresco de la página.
  if (done) redirect(`/panel/${slug}/reservas/${done}?ok=${to.toLowerCase()}`);
  return res;
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
export async function completeBookingAction(slug: string, _p: ActionResult, fd: FormData) {
  return setStatus(slug, fd, "COMPLETED", "Marcada como jugada.");
}
export async function noShowBookingAction(slug: string, _p: ActionResult, fd: FormData) {
  return setStatus(slug, fd, "NO_SHOW", "Marcada como ausente.");
}

const rescheduleForm = z.object({
  bookingId: uuidSchema,
  version: z.coerce.number().int().min(1),
  courtId: uuidSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  durationMinutes: z.coerce.number().int().min(15).max(720),
});

/** Reprogramación: misma validación de horarios y misma restricción antisolapamiento de PostgreSQL. */
export async function rescheduleBookingAction(slug: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  let done: string | null = null;
  const res = await runAction("booking.reschedule", async () => {
    const { ctx, user, tenant } = await requireTenant(slug, "booking.manage");
    const input = parseOrThrow(rescheduleForm, Object.fromEntries(fd));
    const startsAt = localDateTimeToInstant(input.date, input.time, tenant.timezone);
    if (!startsAt) throw new AppError("INVALID_SLOT");
    await rescheduleBooking(
      ctx,
      { bookingId: input.bookingId, startsAt, durationMinutes: input.durationMinutes, courtId: input.courtId, expectedVersion: input.version },
      { type: "USER", userId: user.id },
    );
    revalidatePath(`/panel/${slug}`, "layout");
    done = input.bookingId;
    return "Reserva reprogramada.";
  });
  if (done) redirect(`/panel/${slug}/reservas/${done}?ok=rescheduled`);
  return res;
}

export async function saveInternalNotesAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction("booking.notes", async () => {
    const { ctx, user } = await requireTenant(slug, "booking.manage");
    const input = parseOrThrow(z.object({ bookingId: uuidSchema, notes: z.string().max(2000) }), Object.fromEntries(fd));
    await setBookingInternalNotes(ctx, input, { type: "USER", userId: user.id });
    revalidatePath(`/panel/${slug}`, "layout");
    return "Observaciones guardadas.";
  });
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
    revalidatePath(`/panel/${slug}`, "layout");
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
    revalidatePath(`/panel/${slug}`, "layout");
    return "Horario bloqueado.";
  });
}

export async function deleteBlockAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction("block.delete", async () => {
    const { ctx, user } = await requireTenant(slug, "block.manage");
    const { blockId } = parseOrThrow(z.object({ blockId: uuidSchema }), Object.fromEntries(fd));
    await deleteBlock(ctx, blockId, { type: "USER", userId: user.id });
    revalidatePath(`/panel/${slug}`, "layout");
    return "Bloqueo eliminado.";
  });
}

export async function saveCustomerNotesAction(slug: string, customerId: string, _p: ActionResult, fd: FormData) {
  return runAction("customer.notes", async () => {
    const { ctx, user } = await requireTenant(slug, "booking.manage");
    const { updateCustomerNotes } = await import("@/modules/customers/service");
    await updateCustomerNotes(ctx, customerId, String(fd.get("notes") ?? ""), { type: "USER", userId: user.id });
    revalidatePath(`/panel/${slug}/clientes/${customerId}`);
    return "Observaciones guardadas.";
  });
}

// ------------------------------------------------------------- Pagos y señas

export async function recordPaymentAction(slug: string, bookingId: string, _p: ActionResult, fd: FormData) {
  return runAction("booking.payment.record", async () => {
    const { ctx, user } = await requireTenant(slug, "payment.record");
    const { recordPayment } = await import("@/modules/booking/payments");
    const r = await recordPayment(ctx, { bookingId, kind: String(fd.get("kind") ?? "PAYMENT") as "PAYMENT", method: String(fd.get("method") ?? "CASH") as "CASH", amount: String(fd.get("amount") ?? ""), note: String(fd.get("note") ?? "") }, { type: "USER", userId: user.id });
    revalidatePath(`/panel/${slug}/reservas/${bookingId}`);
    return r.balance.due === 0 ? "Pago registrado. La reserva quedó saldada." : "Pago registrado.";
  });
}

export async function voidPaymentAction(slug: string, bookingId: string, paymentId: string, _p: ActionResult, _fd: FormData) {
  return runAction("booking.payment.void", async () => {
    const { ctx, user } = await requireTenant(slug, "payment.void");
    const { voidPayment } = await import("@/modules/booking/payments");
    await voidPayment(ctx, paymentId, { type: "USER", userId: user.id });
    revalidatePath(`/panel/${slug}/reservas/${bookingId}`);
    return "Pago anulado (queda registrado en el historial).";
  });
}

// --------------------------------------------------------------- Turnos fijos

export type SeriesPreviewResult =
  | { ok: true; occurrences: { date: string; startsAt: string; status: "ok" | "taken" | "closed" | "past" }[] }
  | { ok: false; message: string };

function seriesFromForm(fd: FormData) {
  return {
    courtId: String(fd.get("courtId") ?? ""),
    startsOn: String(fd.get("startsOn") ?? ""),
    endsOn: String(fd.get("endsOn") ?? ""),
    startTime: String(fd.get("startTime") ?? ""),
    durationMinutes: String(fd.get("durationMinutes") ?? ""),
    customer: { name: String(fd.get("name") ?? ""), phone: String(fd.get("phone") ?? ""), email: String(fd.get("email") ?? "") },
    notes: String(fd.get("notes") ?? ""),
  };
}

export async function previewSeriesAction(slug: string, fd: FormData): Promise<SeriesPreviewResult> {
  try {
    const { ctx } = await requireTenant(slug, "booking.manage");
    const { previewSeries } = await import("@/modules/booking/series");
    const p = await previewSeries(ctx, seriesFromForm(fd) as never);
    return { ok: true, occurrences: p.occurrences };
  } catch (e) {
    const { toPublicError } = await import("@/lib/errors");
    return { ok: false, message: toPublicError(e).body.message };
  }
}

export async function createSeriesAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction("booking.series.create", async () => {
    const { ctx, user } = await requireTenant(slug, "booking.manage");
    const { createSeries } = await import("@/modules/booking/series");
    const skipDates = fd.getAll("skip").map(String);
    const r = await createSeries(ctx, { ...seriesFromForm(fd), skipDates } as never, { type: "USER", userId: user.id });
    revalidatePath(`/panel/${slug}/reservas/fijos`);
    revalidatePath(`/panel/${slug}/calendario`);
    const extra = r.failed.length ? ` ${r.failed.length} fecha(s) no se pudieron reservar porque se ocuparon mientras tanto: ${r.failed.map((f) => f.date).join(", ")}.` : "";
    return `Turno fijo creado: ${r.created.length} reserva(s).${extra}`;
  });
}

export async function cancelSeriesAction(slug: string, seriesId: string, _p: ActionResult, fd: FormData) {
  return runAction("booking.series.cancel", async () => {
    const { ctx, user } = await requireTenant(slug, "booking.manage");
    const { cancelSeries } = await import("@/modules/booking/series");
    const from = String(fd.get("fromDate") ?? "") || null;
    const r = await cancelSeries(ctx, seriesId, from, { type: "USER", userId: user.id });
    revalidatePath(`/panel/${slug}/reservas/fijos`);
    revalidatePath(`/panel/${slug}/calendario`);
    return r.cancelled ? `Se cancelaron ${r.cancelled} reserva(s) del turno fijo.` : "No había reservas futuras para cancelar.";
  });
}
