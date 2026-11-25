import { createHmac, timingSafeEqual } from "node:crypto";
import { audit, type Actor } from "@/lib/audit";
import { withTenant } from "@/lib/db/tenant-context";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { readTransferSnapshot } from "@/modules/payments/transfers";
import { publicTransferInfo } from "@/modules/payments/public";
import { reportTransferInTx } from "@/modules/payments/transfers";
import { publicTenantContext } from "@/modules/tenant/public";
import { enqueueBookingEvent } from "@/modules/notifications/outbox";
import { mapDbError } from "./service";

/**
 * Acceso del JUGADOR a su reserva sin cuenta.
 *
 *  - El código (8 caracteres) es un identificador público, NO una credencial.
 *  - Para ver o cancelar se exige además un token de 256 bits:
 *      token = HMAC-SHA256(secreto del servidor, "turnup:booking-link:v1:" + bookingId)
 *    No se guarda en la base (no hay tabla de tokens que robar) y se puede
 *    regenerar ante un reintento idempotente. Rotar el secreto invalida los enlaces.
 *  - Código inexistente y token inválido dan el MISMO error (no revela qué existe).
 *  - La vista pública muestra solo el nombre de pila; nunca teléfono ni email.
 */

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

export function bookingAccessToken(bookingId: string): string {
  return createHmac("sha256", getEnv().BETTER_AUTH_SECRET).update(`turnup:booking-link:v1:${bookingId}`).digest("base64url");
}

function tokenMatches(bookingId: string, token: string): boolean {
  if (!TOKEN_RE.test(token)) return false;
  const a = Buffer.from(bookingAccessToken(bookingId));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function trackingPath(slug: string, code: string, bookingId: string) {
  return `/${slug}/reserva/${code}?t=${bookingAccessToken(bookingId)}`;
}

async function loadByCode(slug: string, code: string, token: string) {
  const normalized = code.trim().toUpperCase();
  if (!CODE_RE.test(normalized) || !TOKEN_RE.test(token)) throw new AppError("INVALID_LINK");
  const ctx = await publicTenantContext(slug).catch(() => {
    throw new AppError("INVALID_LINK");
  });
  const found = await withTenant(ctx, (tx) =>
    tx.booking.findUnique({
      where: { tenantId_code: { tenantId: ctx.tenantId, code: normalized } },
      select: {
        id: true,
        code: true,
        status: true,
        startsAt: true,
        endsAt: true,
        durationMinutes: true,
        priceAmount: true,
        currency: true,
        customerName: true,
        expiresAt: true,
        version: true,
        paymentStatus: true,
        amountDue: true,
        transferReportedAt: true,
        transferSnapshot: true,
        court: { select: { name: true, sport: true } },
        tenant: { select: { name: true, timezone: true, contactPhone: true, address: true, publicCancellationMinutes: true } },
      },
    }),
  );
  if (!found || !tokenMatches(found.id, token)) throw new AppError("INVALID_LINK");
  return { ctx, booking: found };
}

export type PublicBookingView = Awaited<ReturnType<typeof getPublicBooking>>;

export async function getPublicBooking(slug: string, code: string, token: string, now: Date = new Date()) {
  const { ctx, booking: b } = await loadByCode(slug, code, token);
  const expired = b.status === "EXPIRED" || (b.status === "PENDING" && b.expiresAt !== null && b.expiresAt <= now);
  const deadline = new Date(b.startsAt.getTime() - b.tenant.publicCancellationMinutes * 60_000);
  const active = !expired && (b.status === "PENDING" || b.status === "CONFIRMED");
  return {
    code: b.code,
    status: expired ? ("EXPIRED" as const) : b.status,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    durationMinutes: b.durationMinutes,
    priceAmount: b.priceAmount,
    currency: b.currency,
    firstName: b.customerName.trim().split(/\s+/)[0] ?? "",
    court: b.court,
    tenant: { name: b.tenant.name, timezone: b.tenant.timezone, contactPhone: b.tenant.contactPhone, address: b.tenant.address },
    expiresAt: b.status === "PENDING" ? b.expiresAt : null,
    cancellationDeadline: deadline,
    canCancel: active && now < deadline,
    paymentStatus: b.paymentStatus,
    amountDue: b.amountDue,
    transferReportedAt: b.transferReportedAt,
    /** Hora del servidor al armar la vista: el contador del jugador no depende de su reloj. */
    serverNow: now,
    // Datos para transferir: solo mientras la reserva espera la transferencia o su revisión.
    transfer: !expired && b.status === "PENDING" && (b.paymentStatus === "AWAITING_TRANSFER" || b.paymentStatus === "TRANSFER_REPORTED")
      ? (readTransferSnapshot(b.transferSnapshot) ?? (await publicTransferInfo(ctx)))
      : null,
  };
}

/** El jugador (invitado o con cuenta) informa su transferencia con el enlace privado. */
export async function reportTransferByLink(slug: string, code: string, token: string, reference: string | null, actor: Actor, now: Date = new Date()) {
  const { ctx, booking } = await loadByCode(slug, code, token);
  return withTenant(ctx, (tx) => reportTransferInTx(tx, ctx.tenantId, booking.id, reference, actor, now));
}

/** Cancelación por el jugador con su enlace privado, dentro del plazo del complejo. */
export async function cancelBookingPublic(slug: string, code: string, token: string, actor: Actor, now: Date = new Date()) {
  const { ctx, booking: b } = await loadByCode(slug, code, token);
  if (b.status !== "PENDING" && b.status !== "CONFIRMED") throw new AppError("BOOKING_CLOSED");
  if (b.status === "PENDING" && b.expiresAt && b.expiresAt <= now) throw new AppError("BOOKING_EXPIRED");
  if (now >= new Date(b.startsAt.getTime() - b.tenant.publicCancellationMinutes * 60_000)) {
    throw new AppError("CANCELLATION_WINDOW_CLOSED");
  }
  try {
    await withTenant(ctx, async (tx) => {
      const res = await tx.booking.updateMany({
        where: { id: b.id, tenantId: ctx.tenantId, status: { in: ["PENDING", "CONFIRMED"] } },
        data: { status: "CANCELLED", cancelledAt: now, cancelReason: "Cancelada por el jugador", version: { increment: 1 } },
      });
      if (res.count !== 1) throw new AppError("BOOKING_CLOSED");
      await audit(tx, { tenantId: ctx.tenantId, actor, action: "booking.public_cancelled", entityType: "booking", entityId: b.id, metadata: { from: b.status } });
      await enqueueBookingEvent(tx, ctx.tenantId, b.id, { type: "cancelled", by: "player" });
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

/**
 * Vincula una reserva hecha como invitado a la cuenta del jugador. La titularidad se prueba
 * con el ENLACE PRIVADO (código + token HMAC) que solo recibió quien reservó. Nunca se
 * vincula por coincidencia de email o teléfono.
 */
export async function claimBookingByLink(userId: string, slug: string, code: string, token: string) {
  const { ctx, booking: b } = await loadByCode(slug, code, token);
  await withTenant(ctx, async (tx) => {
    const current = await tx.booking.findUnique({ where: { id: b.id }, select: { playerUserId: true } });
    if (current?.playerUserId && current.playerUserId !== userId) throw new AppError("BOOKING_OWNED");
    if (current?.playerUserId === userId) return;
    const res = await tx.booking.updateMany({ where: { id: b.id, tenantId: ctx.tenantId, playerUserId: null }, data: { playerUserId: userId } });
    if (res.count !== 1) throw new AppError("BOOKING_OWNED");
    await audit(tx, { tenantId: ctx.tenantId, actor: { type: "USER", userId }, action: "booking.claimed_by_player", entityType: "booking", entityId: b.id, metadata: {} });
  });
  return { code: b.code };
}

/**
 * Cancelación desde "Mis turnos". La propiedad ya la verificó el llamador (la reserva
 * salió de app_player_bookings con app.player_id = el usuario de la sesión); acá se
 * vuelve a comprobar dentro del complejo y se aplican las MISMAS reglas que con el enlace.
 */
export async function cancelBookingAsPlayer(tenantId: string, bookingId: string, userId: string, now: Date = new Date()) {
  const ctx = { tenantId, userId: null };
  try {
    await withTenant(ctx, async (tx) => {
      const b = await tx.booking.findFirst({
        where: { id: bookingId, tenantId, playerUserId: userId },
        select: { id: true, status: true, startsAt: true, expiresAt: true, tenant: { select: { publicCancellationMinutes: true, status: true } } },
      });
      if (!b) throw new AppError("BOOKING_NOT_FOUND");
      if (b.tenant.status !== "ACTIVE") throw new AppError("TENANT_SUSPENDED");
      if (b.status !== "PENDING" && b.status !== "CONFIRMED") throw new AppError("BOOKING_CLOSED");
      if (b.status === "PENDING" && b.expiresAt && b.expiresAt <= now) throw new AppError("BOOKING_EXPIRED");
      if (now >= new Date(b.startsAt.getTime() - b.tenant.publicCancellationMinutes * 60_000)) throw new AppError("CANCELLATION_WINDOW_CLOSED");
      const res = await tx.booking.updateMany({
        where: { id: b.id, tenantId, status: { in: ["PENDING", "CONFIRMED"] } },
        data: { status: "CANCELLED", cancelledAt: now, cancelReason: "Cancelada por el jugador", version: { increment: 1 } },
      });
      if (res.count !== 1) throw new AppError("BOOKING_CLOSED");
      await audit(tx, { tenantId, actor: { type: "USER", userId }, action: "booking.player_cancelled", entityType: "booking", entityId: b.id, metadata: { from: b.status } });
      await enqueueBookingEvent(tx, tenantId, b.id, { type: "cancelled", by: "player" });
    });
  } catch (e) {
    throw mapDbError(e);
  }
}
