import { z } from "zod";
import { audit, type Actor } from "@/lib/audit";
import type { Tx } from "@/lib/db/tenant-context";
import { withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";
import { notifyBookingPlayer, notifyTenant } from "@/modules/inbox/service";
import { enqueueBookingEvent } from "@/modules/notifications/outbox";

/**
 * Reservas con TRANSFERENCIA DIRECTA al complejo.
 *
 * TURNUP no recibe, retiene ni intermedia dinero: muestra los datos de cobro del complejo,
 * bloquea el turno un tiempo limitado y registra lo que el complejo verifica a mano.
 * "Transferencia informada" (lo dice el jugador) ≠ "pago verificado" (lo confirma el complejo).
 *
 * Estados: la reserva sigue usando su estado (PENDING → CONFIRMED / REJECTED / EXPIRED / CANCELLED…)
 * y el estado FINANCIERO va aparte en payment_status:
 *   AWAITING_TRANSFER  → pendiente de transferencia (turno bloqueado hasta expires_at)
 *   TRANSFER_REPORTED  → transferencia informada (bloqueado durante el plazo de revisión)
 *   VERIFIED           → el complejo verificó el pago (reserva confirmada)
 *   NOT_REQUIRED       → reserva sin seña
 */

export const DEPOSIT_TYPES = ["NONE", "FIXED", "PERCENT", "FULL"] as const;
export type DepositType = (typeof DEPOSIT_TYPES)[number];

/** Máximo de turnos bloqueados sin pagar por persona (email/teléfono o cuenta). */
export const MAX_UNPAID_HOLDS = 2;

/** Valida el dígito verificador de un CBU/CVU (22 dígitos, dos bloques). */
export function isValidCbu(v: string): boolean {
  if (!/^\d{22}$/.test(v)) return false;
  const d = v.split("").map(Number);
  const w1 = [7, 1, 3, 9, 7, 1, 3];
  const s1 = w1.reduce((a, w, i) => a + w * d[i]!, 0);
  if ((10 - (s1 % 10)) % 10 !== d[7]) return false;
  const w2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];
  const s2 = w2.reduce((a, w, i) => a + w * d[8 + i]!, 0);
  return (10 - (s2 % 10)) % 10 === d[21];
}

const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export const paymentSettingsSchema = z
  .object({
    alias: z.string().trim().max(20).optional().transform(blank)
      .refine((v) => v === null || /^[A-Za-z0-9.-]{6,20}$/.test(v), "El alias tiene entre 6 y 20 caracteres: letras, números, puntos o guiones."),
    cbuCvu: z.string().trim().max(30).optional().transform((v) => blank(v?.replace(/[\s-]/g, "")))
      .refine((v) => v === null || isValidCbu(v), "El CBU/CVU debe tener 22 números y ser válido."),
    holderName: z.string().trim().max(80).optional().transform(blank)
      .refine((v) => v === null || v.length >= 3, "Ingresá el nombre del titular."),
    bankName: z.string().trim().max(60).optional().transform(blank),
    transferWindowMinutes: z.coerce.number().int().min(10).max(1440),
    reviewWindowMinutes: z.coerce.number().int().min(15).max(2880),
    instructions: z.string().trim().max(500).optional().transform(blank),
    depositType: z.enum(DEPOSIT_TYPES),
    /** FIXED: pesos; PERCENT: 1–100. */
    depositValue: z.coerce.number().min(0).max(1_000_000).default(0),
  })
  .superRefine((d, ctx) => {
    if (d.depositType !== "NONE" && !d.alias && !d.cbuCvu) ctx.addIssue({ code: "custom", path: ["alias"], message: "Para pedir transferencias cargá un alias o un CBU/CVU." });
    if (d.depositType !== "NONE" && !d.holderName) ctx.addIssue({ code: "custom", path: ["holderName"], message: "Ingresá el titular de la cuenta." });
    if (d.depositType === "PERCENT" && (d.depositValue < 1 || d.depositValue > 100)) ctx.addIssue({ code: "custom", path: ["depositValue"], message: "El porcentaje va de 1 a 100." });
    if (d.depositType === "FIXED" && d.depositValue <= 0) ctx.addIssue({ code: "custom", path: ["depositValue"], message: "Ingresá el importe de la seña." });
  });
export type PaymentSettingsInput = z.input<typeof paymentSettingsSchema>;

export type TransferInfo = {
  alias: string | null;
  cbuCvu: string | null;
  holderName: string | null;
  bankName: string | null;
  instructions: string | null;
  transferWindowMinutes: number;
  reviewWindowMinutes: number;
};

export function transferConfigured(depositType: string, s: TransferInfo | null): boolean {
  if (depositType === "NONE") return true;
  return Boolean(s && (s.alias || s.cbuCvu) && s.holderName);
}

/** Importe a transferir, calculado SIEMPRE en el servidor a partir del precio congelado. */
export function amountDueFor(price: number | null, depositType: string, depositValue: number): number | null {
  if (depositType === "NONE") return 0;
  if (depositType === "FIXED") return price === null ? depositValue : Math.min(depositValue, price);
  if (price === null) return null;
  if (depositType === "FULL") return price;
  return Math.round((price * Math.min(100, Math.max(1, depositValue))) / 100);
}

const SETTINGS_SELECT = { alias: true, cbuCvu: true, holderName: true, bankName: true, instructions: true, transferWindowMinutes: true, reviewWindowMinutes: true } as const;

export async function loadTransferSettings(tx: Tx, tenantId: string): Promise<TransferInfo | null> {
  return tx.tenantPaymentSettings.findUnique({ where: { tenantId }, select: SETTINGS_SELECT });
}

export async function getPaymentSettings(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => {
    const [settings, tenant] = await Promise.all([
      loadTransferSettings(tx, ctx.tenantId),
      tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { depositType: true, depositValue: true, cancellationPolicy: true, publicCancellationMinutes: true, name: true, currency: true } }),
    ]);
    return { settings, tenant, configured: transferConfigured(tenant.depositType, settings) };
  });
}

/** Cambia los datos de cobro. Auditado SIN guardar el alias/CBU en el log (solo qué campos cambiaron). */
export async function updatePaymentSettings(ctx: TenantContext, input: PaymentSettingsInput, actor: Actor & { userId: string }) {
  const d = parseOrThrow(paymentSettingsSchema, input);
  const depositValue = d.depositType === "FIXED" ? Math.round(d.depositValue * 100) : d.depositType === "PERCENT" ? Math.round(d.depositValue) : 0;
  await withTenant(ctx, async (tx) => {
    const before = await loadTransferSettings(tx, ctx.tenantId);
    const data = {
      alias: d.alias, cbuCvu: d.cbuCvu, holderName: d.holderName, bankName: d.bankName, instructions: d.instructions,
      transferWindowMinutes: d.transferWindowMinutes, reviewWindowMinutes: d.reviewWindowMinutes, updatedByUserId: actor.userId,
    };
    await tx.tenantPaymentSettings.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, ...data }, update: data });
    await tx.tenant.update({ where: { id: ctx.tenantId }, data: { depositType: d.depositType, depositValue } });
    const changed = (["alias", "cbuCvu", "holderName", "bankName", "instructions", "transferWindowMinutes", "reviewWindowMinutes"] as const).filter(
      (k) => (before?.[k] ?? null) !== (data[k] ?? null),
    );
    await audit(tx, {
      tenantId: ctx.tenantId,
      actor,
      action: "tenant.payment_settings.updated",
      entityType: "tenant",
      entityId: ctx.tenantId,
      // Nunca el alias, CBU ni titular en el log: solo qué cambió.
      metadata: { changed, depositType: d.depositType, bankDataChanged: changed.some((k) => k === "alias" || k === "cbuCvu" || k === "holderName") },
    });
  });
}

// ---------------------------------------------------------------- Jugador: informar transferencia

export const reportSchema = z.object({ reference: z.string().trim().max(60).optional().transform(blank) });

type ReportResult = { status: "reported"; reviewUntil: Date } | { status: "late" };

/**
 * El jugador informa que transfirió. NO confirma nada: pasa a "transferencia informada" y el turno
 * queda bloqueado durante el plazo de revisión del complejo (una sola vez: no se puede extender).
 * Si el plazo ya venció, se registra una incidencia para revisión manual y se avisa al complejo.
 */
export async function reportTransferInTx(tx: Tx, tenantId: string, bookingId: string, reference: string | null, actor: Actor, now: Date): Promise<ReportResult> {
  const b = await tx.booking.findFirst({
    where: { id: bookingId, tenantId },
    select: { id: true, code: true, status: true, paymentStatus: true, expiresAt: true, customerName: true, amountDue: true, transferReportedAt: true },
  });
  if (!b) throw new AppError("BOOKING_NOT_FOUND");
  if (b.paymentStatus === "TRANSFER_REPORTED") throw new AppError("ALREADY_PROCESSED");
  const expired = b.status === "EXPIRED" || (b.status === "PENDING" && b.expiresAt !== null && b.expiresAt <= now);
  if (expired && b.paymentStatus === "AWAITING_TRANSFER") {
    // Tarde: nunca se reconfirma solo (el turno pudo asignarse a otra persona).
    const open = await tx.paymentIncident.count({ where: { tenantId, bookingId: b.id, kind: "LATE_TRANSFER", status: "OPEN" } });
    if (!open) {
      await tx.paymentIncident.create({
        data: { tenantId, bookingId: b.id, kind: "LATE_TRANSFER", amount: b.amountDue, notes: reference ? `Referencia informada: ${reference}` : null },
      });
      await notifyTenant(tx, tenantId, {
        kind: "payment_incident",
        title: `Transferencia informada fuera de plazo · ${b.code}`,
        body: `${b.customerName} dice que transfirió después del vencimiento. Revisá si recibiste el dinero y gestioná la devolución o una reprogramación.`,
        link: `/transferencias?estado=incidencias`,
        bookingId: b.id,
      });
      await audit(tx, { tenantId, actor, action: "booking.transfer.reported_late", entityType: "booking", entityId: b.id, metadata: { hasReference: Boolean(reference) } });
    }
    return { status: "late" };
  }
  if (b.status !== "PENDING" || b.paymentStatus !== "AWAITING_TRANSFER") throw new AppError("TRANSFER_NOT_PENDING");
  const settings = await loadTransferSettings(tx, tenantId);
  const reviewUntil = new Date(now.getTime() + (settings?.reviewWindowMinutes ?? 180) * 60_000);
  const res = await tx.booking.updateMany({
    where: { id: b.id, tenantId, status: "PENDING", paymentStatus: "AWAITING_TRANSFER", expiresAt: { gt: now } },
    data: { paymentStatus: "TRANSFER_REPORTED", transferReportedAt: now, transferReference: reference, expiresAt: reviewUntil, version: { increment: 1 } },
  });
  if (res.count !== 1) throw new AppError("ALREADY_PROCESSED");
  await audit(tx, { tenantId, actor, action: "booking.transfer.reported", entityType: "booking", entityId: b.id, metadata: { hasReference: Boolean(reference), reviewUntil: reviewUntil.toISOString() } });
  await notifyTenant(tx, tenantId, {
    kind: "transfer_reported",
    title: `Transferencia informada · ${b.code}`,
    body: `${b.customerName} informó una transferencia. Verificala en tu cuenta y confirmá o rechazá la reserva.`,
    link: `/transferencias`,
    bookingId: b.id,
  });
  await notifyBookingPlayer(tx, b.id, {
    kind: "transfer_pending_review",
    title: "Transferencia pendiente de revisión",
    body: `El complejo va a verificar tu transferencia de la reserva ${b.code}. Te avisamos cuando la confirme.`,
    link: "/mis-turnos",
  });
  return { status: "reported", reviewUntil };
}

// ---------------------------------------------------------------- Complejo: verificar

export const confirmSchema = z.object({
  bookingId: z.uuid(),
  expectedVersion: z.coerce.number().int().min(1),
  /** Importe efectivamente recibido (pesos). */
  receivedAmount: z.string().trim().regex(/^\d{1,9}([.,]\d{1,2})?$/, "Importe inválido").transform((v) => Math.round(Number(v.replace(",", ".")) * 100)),
  note: z.string().trim().max(300).optional().transform(blank),
});

/**
 * El complejo confirma que RECIBIÓ la transferencia: la reserva pasa a confirmada, queda registrado
 * quién verificó, cuándo y cuánto. Doble confirmación imposible (versión + estado en el WHERE).
 */
export async function confirmTransfer(ctx: TenantContext, input: z.input<typeof confirmSchema>, actor: Actor & { userId: string }, now: Date = new Date()) {
  const d = parseOrThrow(confirmSchema, input);
  return withTenant(ctx, async (tx) => {
    const b = await tx.booking.findFirst({
      where: { id: d.bookingId, tenantId: ctx.tenantId },
      select: { id: true, code: true, status: true, paymentStatus: true, version: true, expiresAt: true, priceAmount: true, amountDue: true },
    });
    if (!b) throw new AppError("BOOKING_NOT_FOUND");
    if (b.status !== "PENDING" || (b.paymentStatus !== "AWAITING_TRANSFER" && b.paymentStatus !== "TRANSFER_REPORTED")) throw new AppError("ALREADY_PROCESSED");
    if (b.version !== d.expectedVersion) throw new AppError("ALREADY_PROCESSED");
    if (b.expiresAt && b.expiresAt <= now) throw new AppError("BOOKING_EXPIRED");
    const res = await tx.booking.updateMany({
      where: { id: b.id, tenantId: ctx.tenantId, status: "PENDING", version: d.expectedVersion },
      data: { status: "CONFIRMED", confirmedAt: now, expiresAt: null, paymentStatus: "VERIFIED", paymentVerifiedAt: now, paymentVerifiedBy: actor.userId, version: { increment: 1 } },
    });
    if (res.count !== 1) throw new AppError("ALREADY_PROCESSED");
    if (d.receivedAmount > 0) {
      await tx.bookingPayment.create({
        data: {
          tenantId: ctx.tenantId,
          bookingId: b.id,
          kind: b.priceAmount !== null && d.receivedAmount >= b.priceAmount ? "PAYMENT" : "DEPOSIT",
          method: "TRANSFER",
          amount: d.receivedAmount,
          note: d.note ?? "Transferencia verificada",
          recordedByUserId: actor.userId,
          paidAt: now,
        },
      });
    }
    await audit(tx, {
      tenantId: ctx.tenantId, actor, action: "booking.transfer.verified", entityType: "booking", entityId: b.id,
      metadata: { receivedAmount: d.receivedAmount, expectedAmount: b.amountDue },
    });
    await enqueueBookingEvent(tx, ctx.tenantId, b.id, { type: "confirmed" });
    await notifyBookingPlayer(tx, b.id, { kind: "booking_confirmed", title: "¡Reserva confirmada!", body: `El complejo verificó tu pago. Reserva ${b.code}.`, link: "/mis-turnos" });
    return { code: b.code };
  });
}

export const rejectSchema = z.object({
  bookingId: z.uuid(),
  expectedVersion: z.coerce.number().int().min(1),
  reason: z.string().trim().min(3).max(300),
  /** El complejo recibió dinero igual (p. ej. importe incorrecto): queda una incidencia para devolver. */
  moneyReceived: z.boolean().default(false),
  receivedAmount: z.string().trim().optional().transform((v) => (v && /^\d{1,9}([.,]\d{1,2})?$/.test(v) ? Math.round(Number(v.replace(",", ".")) * 100) : null)),
});

export async function rejectTransfer(ctx: TenantContext, input: z.input<typeof rejectSchema>, actor: Actor & { userId: string }, now: Date = new Date()) {
  const d = parseOrThrow(rejectSchema, input);
  return withTenant(ctx, async (tx) => {
    const b = await tx.booking.findFirst({ where: { id: d.bookingId, tenantId: ctx.tenantId }, select: { id: true, code: true, status: true, version: true, paymentStatus: true } });
    if (!b) throw new AppError("BOOKING_NOT_FOUND");
    if (b.status !== "PENDING" || b.version !== d.expectedVersion) throw new AppError("ALREADY_PROCESSED");
    const res = await tx.booking.updateMany({
      where: { id: b.id, tenantId: ctx.tenantId, status: "PENDING", version: d.expectedVersion },
      data: { status: "REJECTED", cancelledAt: now, cancelReason: d.reason, expiresAt: null, version: { increment: 1 } },
    });
    if (res.count !== 1) throw new AppError("ALREADY_PROCESSED");
    if (d.moneyReceived) {
      await tx.paymentIncident.create({
        data: { tenantId: ctx.tenantId, bookingId: b.id, kind: "PAID_BUT_REJECTED", amount: d.receivedAmount, notes: d.reason, createdByUserId: actor.userId },
      });
    }
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "booking.transfer.rejected", entityType: "booking", entityId: b.id, metadata: { moneyReceived: d.moneyReceived } });
    await enqueueBookingEvent(tx, ctx.tenantId, b.id, { type: "rejected", reason: d.reason });
    await notifyBookingPlayer(tx, b.id, { kind: "booking_rejected", title: "Reserva rechazada", body: `El complejo rechazó la reserva ${b.code}: ${d.reason}`, link: "/mis-turnos" });
    return { code: b.code };
  });
}

// ---------------------------------------------------------------- Incidencias de pago

export const INCIDENT_KINDS = ["LATE_TRANSFER", "PAID_BUT_EXPIRED", "PAID_BUT_REJECTED", "REFUND", "OTHER"] as const;
export const INCIDENT_LABEL: Record<(typeof INCIDENT_KINDS)[number], string> = {
  LATE_TRANSFER: "Transferencia fuera de plazo",
  PAID_BUT_EXPIRED: "Pago recibido de una reserva vencida",
  PAID_BUT_REJECTED: "Pago recibido de una reserva rechazada",
  REFUND: "Devolución",
  OTHER: "Otra",
};
export const RESOLUTIONS = ["REFUNDED_EXTERNALLY", "RESCHEDULED", "NO_PAYMENT_RECEIVED", "OTHER"] as const;
export const RESOLUTION_LABEL: Record<(typeof RESOLUTIONS)[number], string> = {
  REFUNDED_EXTERNALLY: "Devuelto por el complejo (fuera de TURNUP)",
  RESCHEDULED: "Reprogramado",
  NO_PAYMENT_RECEIVED: "No se recibió dinero",
  OTHER: "Otra",
};

const amountPesos = z.string().trim().optional().transform((v) => (v && /^\d{1,9}([.,]\d{1,2})?$/.test(v) ? Math.round(Number(v.replace(",", ".")) * 100) : null));

export async function openIncident(ctx: TenantContext, input: { bookingId: string; kind: string; amount?: string; notes?: string }, actor: Actor & { userId: string }) {
  const d = parseOrThrow(z.object({ bookingId: z.uuid(), kind: z.enum(INCIDENT_KINDS), amount: amountPesos, notes: z.string().trim().max(500).optional().transform(blank) }), input);
  return withTenant(ctx, async (tx) => {
    const b = await tx.booking.findFirst({ where: { id: d.bookingId, tenantId: ctx.tenantId }, select: { id: true, code: true } });
    if (!b) throw new AppError("BOOKING_NOT_FOUND");
    const i = await tx.paymentIncident.create({ data: { tenantId: ctx.tenantId, bookingId: b.id, kind: d.kind, amount: d.amount, notes: d.notes, createdByUserId: actor.userId }, select: { id: true } });
    await notifyTenant(tx, ctx.tenantId, { kind: "payment_incident", title: `Incidencia de pago · ${b.code}`, body: INCIDENT_LABEL[d.kind], link: "/transferencias?estado=incidencias", bookingId: b.id });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "payment.incident.opened", entityType: "payment_incident", entityId: i.id, metadata: { kind: d.kind, amount: d.amount } });
    return i;
  });
}

/**
 * Cierra una incidencia. "Devuelto" registra una devolución hecha por el COMPLEJO fuera de TURNUP
 * (TURNUP no devuelve dinero: no lo tiene).
 */
export async function resolveIncident(ctx: TenantContext, input: { incidentId: string; resolution: string; notes?: string }, actor: Actor & { userId: string }) {
  const d = parseOrThrow(z.object({ incidentId: z.uuid(), resolution: z.enum(RESOLUTIONS), notes: z.string().trim().max(500).optional().transform(blank) }), input);
  await withTenant(ctx, async (tx) => {
    const res = await tx.paymentIncident.updateMany({
      where: { id: d.incidentId, tenantId: ctx.tenantId, status: "OPEN" },
      data: { status: "RESOLVED", resolution: d.resolution, resolvedAt: new Date(), resolvedByUserId: actor.userId, ...(d.notes ? { notes: d.notes } : {}) },
    });
    if (res.count !== 1) throw new AppError("ALREADY_PROCESSED");
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "payment.incident.resolved", entityType: "payment_incident", entityId: d.incidentId, metadata: { resolution: d.resolution } });
  });
}

// ---------------------------------------------------------------- Cola del panel

export const QUEUE_FILTERS = ["pendientes", "informadas", "incidencias", "todas"] as const;

export async function listTransferQueue(ctx: TenantContext, f: { estado?: string; q?: string; cancha?: string; fecha?: string }, now: Date = new Date()) {
  const estado = (QUEUE_FILTERS as readonly string[]).includes(f.estado ?? "") ? f.estado! : "informadas";
  const q = f.q?.trim().slice(0, 80);
  return withTenant(ctx, async (tx) => {
    // Vencimiento en el momento (no depender de la tarea programada).
    await tx.$queryRaw`SELECT booking_id FROM app_expire_pending_bookings(1000, ${ctx.tenantId}::uuid)`;
    const amount = q && /^\d+([.,]\d{1,2})?$/.test(q) ? Math.round(Number(q.replace(",", ".")) * 100) : null;
    const text = q && amount === null ? q : null;
    const bookings =
      estado === "incidencias"
        ? []
        : await tx.booking.findMany({
            where: {
              tenantId: ctx.tenantId,
              ...(estado === "todas"
                ? { paymentStatus: { in: ["AWAITING_TRANSFER", "TRANSFER_REPORTED", "VERIFIED"] } }
                : { status: "PENDING", paymentStatus: estado === "pendientes" ? "AWAITING_TRANSFER" : "TRANSFER_REPORTED" }),
              ...(f.cancha ? { courtId: f.cancha } : {}),
              ...(f.fecha && /^\d{4}-\d{2}-\d{2}$/.test(f.fecha)
                ? { startsAt: { gte: new Date(`${f.fecha}T00:00:00-03:00`), lt: new Date(new Date(`${f.fecha}T00:00:00-03:00`).getTime() + 86_400_000) } }
                : {}),
              ...(amount !== null ? { amountDue: amount } : {}),
              ...(text
                ? { OR: [{ customerName: { contains: text, mode: "insensitive" as const } }, { transferPayerName: { contains: text, mode: "insensitive" as const } }, { code: { contains: text.toUpperCase() } }] }
                : {}),
            },
            orderBy: [{ transferReportedAt: "asc" }, { createdAt: "asc" }],
            take: 100,
            select: {
              id: true, code: true, status: true, version: true, paymentStatus: true, startsAt: true, endsAt: true, durationMinutes: true,
              priceAmount: true, amountDue: true, currency: true, customerName: true, customerPhone: true, transferPayerName: true,
              transferReference: true, transferReportedAt: true, createdAt: true, expiresAt: true, paymentVerifiedAt: true,
              court: { select: { name: true } },
            },
          });
    const incidents = await tx.paymentIncident.findMany({
      where: { tenantId: ctx.tenantId, ...(estado === "incidencias" ? {} : { status: "OPEN" }) },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, kind: true, status: true, amount: true, notes: true, resolution: true, createdAt: true, resolvedAt: true, booking: { select: { id: true, code: true, customerName: true, customerPhone: true, startsAt: true, status: true } } },
    });
    const counts = await tx.booking.groupBy({ by: ["paymentStatus"], where: { tenantId: ctx.tenantId, status: "PENDING", paymentStatus: { in: ["AWAITING_TRANSFER", "TRANSFER_REPORTED"] } }, _count: { _all: true } });
    const courts = await tx.court.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } });
    return {
      estado,
      bookings,
      incidents,
      courts,
      counts: {
        pendientes: counts.find((c) => c.paymentStatus === "AWAITING_TRANSFER")?._count._all ?? 0,
        informadas: counts.find((c) => c.paymentStatus === "TRANSFER_REPORTED")?._count._all ?? 0,
        incidencias: await tx.paymentIncident.count({ where: { tenantId: ctx.tenantId, status: "OPEN" } }),
      },
      now,
    };
  });
}
