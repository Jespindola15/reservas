import { z } from "zod";
import type { PaymentKind } from "@/generated/prisma/client";
import { audit, type Actor } from "@/lib/audit";
import { withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";

/**
 * Pagos y señas registrados A MANO (efectivo, transferencia, posnet...). No hay cobro
 * online ni se guardan datos de tarjetas. Los registros no se editan: se anulan (borrado
 * auditado) y se cargan de nuevo, para que la historia sea trazable.
 */
export const PAYMENT_METHODS = ["CASH", "TRANSFER", "CARD", "MERCADOPAGO_MANUAL", "OTHER"] as const;
export const METHOD_LABEL: Record<(typeof PAYMENT_METHODS)[number], string> = {
  CASH: "Efectivo", TRANSFER: "Transferencia", CARD: "Tarjeta (posnet)", MERCADOPAGO_MANUAL: "Mercado Pago (manual)", OTHER: "Otro",
};
export const KIND_LABEL: Record<PaymentKind, string> = { DEPOSIT: "Seña", PAYMENT: "Pago", REFUND: "Devolución" };

export const paymentSchema = z.object({
  bookingId: z.uuid(),
  kind: z.enum(["DEPOSIT", "PAYMENT", "REFUND"]),
  method: z.enum(PAYMENT_METHODS),
  /** En pesos (con hasta 2 decimales); se guarda en centavos. */
  amount: z.coerce.number().positive().max(1_000_000).transform((v) => Math.round(v * 100)),
  note: z.string().trim().max(300).optional().transform((v) => v || null),
});

export type Balance = { total: number | null; paid: number; due: number | null };

export function computeBalance(priceAmount: number | null, payments: { kind: PaymentKind; amount: number }[]): Balance {
  const paid = payments.reduce((a, p) => a + (p.kind === "REFUND" ? -p.amount : p.amount), 0);
  return { total: priceAmount, paid, due: priceAmount === null ? null : Math.max(0, priceAmount - paid) };
}

export async function getBookingPayments(ctx: TenantContext, bookingId: string) {
  parseOrThrow(z.uuid(), bookingId);
  return withTenant(ctx, async (tx) => {
    const booking = await tx.booking.findFirst({ where: { id: bookingId, tenantId: ctx.tenantId }, select: { priceAmount: true, currency: true } });
    if (!booking) throw new AppError("BOOKING_NOT_FOUND");
    const payments = await tx.bookingPayment.findMany({
      where: { tenantId: ctx.tenantId, bookingId },
      orderBy: { paidAt: "asc" },
      select: { id: true, kind: true, method: true, amount: true, note: true, paidAt: true },
    });
    return { payments, currency: booking.currency, balance: computeBalance(booking.priceAmount, payments) };
  });
}

export async function recordPayment(ctx: TenantContext, raw: z.input<typeof paymentSchema>, actor: Actor) {
  const data = parseOrThrow(paymentSchema, raw);
  return withTenant(ctx, async (tx) => {
    const booking = await tx.booking.findFirst({ where: { id: data.bookingId, tenantId: ctx.tenantId }, select: { id: true, priceAmount: true, status: true } });
    if (!booking) throw new AppError("BOOKING_NOT_FOUND");
    const previous = await tx.bookingPayment.findMany({ where: { tenantId: ctx.tenantId, bookingId: booking.id }, select: { kind: true, amount: true } });
    const before = computeBalance(booking.priceAmount, previous);
    if (data.kind === "REFUND" && data.amount > before.paid) throw new AppError("VALIDATION_ERROR", { field: "amount", reason: "refund_exceeds_paid" });
    if (data.kind !== "REFUND" && ["REJECTED", "EXPIRED"].includes(booking.status)) throw new AppError("VALIDATION_ERROR", { reason: "booking_not_active" });
    const p = await tx.bookingPayment.create({
      data: { tenantId: ctx.tenantId, bookingId: booking.id, kind: data.kind, method: data.method, amount: data.amount, note: data.note, recordedByUserId: actor.type === "USER" ? actor.userId : null },
      select: { id: true },
    });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "booking.payment.recorded", entityType: "booking", entityId: booking.id, metadata: { paymentId: p.id, kind: data.kind, method: data.method, amount: data.amount } });
    return { id: p.id, balance: computeBalance(booking.priceAmount, [...previous, { kind: data.kind, amount: data.amount }]) };
  });
}

/** Anula un pago cargado por error (solo dueño/administrador). Queda en la auditoría con su importe. */
export async function voidPayment(ctx: TenantContext, paymentId: string, actor: Actor) {
  parseOrThrow(z.uuid(), paymentId);
  return withTenant(ctx, async (tx) => {
    const p = await tx.bookingPayment.findFirst({ where: { id: paymentId, tenantId: ctx.tenantId }, select: { id: true, bookingId: true, kind: true, method: true, amount: true } });
    if (!p) throw new AppError("NOT_FOUND");
    await tx.bookingPayment.delete({ where: { id: p.id } });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "booking.payment.voided", entityType: "booking", entityId: p.bookingId, metadata: { paymentId: p.id, kind: p.kind, method: p.method, amount: p.amount } });
  });
}

/** Historial de una reserva a partir de la auditoría (quién hizo qué y cuándo). */
export async function getBookingHistory(ctx: TenantContext, bookingId: string) {
  parseOrThrow(z.uuid(), bookingId);
  return withTenant(ctx, async (tx) => {
    const rows = await tx.auditLog.findMany({
      where: { tenantId: ctx.tenantId, entityId: bookingId },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { id: true, action: true, actorType: true, actorUserId: true, createdAt: true, metadata: true },
    });
    const ids = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => Boolean(x)))];
    const users = ids.length ? await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({ ...r, actorName: r.actorUserId ? (nameOf.get(r.actorUserId) ?? "Usuario") : r.actorType === "PUBLIC" ? "Jugador (online)" : "Sistema" }));
  });
}
