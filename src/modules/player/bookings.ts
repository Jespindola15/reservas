import { withPlayer } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { cancelBookingAsPlayer } from "@/modules/booking/public-access";

export type PlayerBooking = {
  id: string;
  tenantId: string;
  code: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  durationMinutes: number;
  priceAmount: number | null;
  currency: string;
  tenantSlug: string;
  tenantName: string;
  tenantAddress: string | null;
  tenantTimezone: string;
  cancellationMinutes: number;
  courtName: string;
  sport: string;
  reviewRating: number | null;
  paymentStatus: string | null;
  amountDue: number | null;
  expiresAt: Date | null;
  transferReportedAt: Date | null;
  canCancel: boolean;
  canReview: boolean;
};

export const REVIEW_WINDOW_DAYS = 90;

/** Reservas del jugador en todos los complejos (solo las propias, vía app.player_id). */
export async function listPlayerBookings(userId: string, now: Date = new Date()): Promise<PlayerBooking[]> {
  const rows = await withPlayer(userId, (tx) =>
    tx.$queryRaw<
      {
        id: string; tenant_id: string; code: string; status: string; starts_at: Date; ends_at: Date; duration_minutes: number;
        price_amount: number | null; currency: string; tenant_slug: string; tenant_name: string; tenant_address: string | null;
        tenant_timezone: string; cancellation_minutes: number; court_name: string; sport: string; review_rating: number | null;
        payment_status: string | null; amount_due: number | null; expires_at: Date | null; transfer_reported_at: Date | null;
      }[]
    >`SELECT * FROM app_player_bookings(200)`,
  );
  return rows.map((r) => {
    const lapsed = r.status === "PENDING" && r.expires_at !== null && r.expires_at <= now;
    if (lapsed) r.status = "EXPIRED";
    const active = r.status === "CONFIRMED" || r.status === "PENDING";
    const played = r.status === "COMPLETED" || (r.status === "CONFIRMED" && r.ends_at <= now);
    return {
      id: r.id,
      tenantId: r.tenant_id,
      code: r.code,
      status: r.status,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      durationMinutes: r.duration_minutes,
      priceAmount: r.price_amount,
      currency: r.currency.trim(),
      tenantSlug: r.tenant_slug,
      tenantName: r.tenant_name,
      tenantAddress: r.tenant_address,
      tenantTimezone: r.tenant_timezone,
      cancellationMinutes: r.cancellation_minutes,
      courtName: r.court_name,
      sport: r.sport,
      reviewRating: r.review_rating,
      paymentStatus: r.payment_status,
      amountDue: r.amount_due,
      expiresAt: r.expires_at,
      transferReportedAt: r.transfer_reported_at,
      canCancel: active && now.getTime() < r.starts_at.getTime() - r.cancellation_minutes * 60_000,
      canReview: played && r.review_rating === null && now.getTime() - r.ends_at.getTime() < REVIEW_WINDOW_DAYS * 86_400_000,
    };
  });
}

export async function findPlayerBooking(userId: string, bookingId: string, now: Date = new Date()) {
  const b = (await listPlayerBookings(userId, now)).find((x) => x.id === bookingId);
  if (!b) throw new AppError("BOOKING_NOT_FOUND");
  return b;
}

export async function cancelPlayerBooking(userId: string, bookingId: string, now: Date = new Date()) {
  const b = await findPlayerBooking(userId, bookingId, now);
  await cancelBookingAsPlayer(b.tenantId, b.id, userId, now);
}

/** Informar la transferencia desde "Mis turnos" (reserva propia, verificada por app.player_id). */
export async function reportPlayerTransfer(userId: string, bookingId: string, reference: string | null, now: Date = new Date()) {
  const b = await findPlayerBooking(userId, bookingId, now);
  const { withTenant } = await import("@/lib/db/tenant-context");
  const { reportTransferInTx } = await import("@/modules/payments/transfers");
  return withTenant({ tenantId: b.tenantId, userId }, (tx) => reportTransferInTx(tx, b.tenantId, b.id, reference, { type: "USER", userId }, now));
}

/**
 * Datos de cobro para las reservas del jugador que esperan transferencia (por complejo).
 * Solo se consultan complejos donde el jugador tiene una reserva pendiente de transferencia.
 */
export async function playerTransferInfos(userId: string, bookings: PlayerBooking[]) {
  const { withTenant } = await import("@/lib/db/tenant-context");
  const { loadTransferSettings } = await import("@/modules/payments/transfers");
  const tenantIds = [...new Set(bookings.filter((b) => b.status === "PENDING" && b.paymentStatus === "AWAITING_TRANSFER").map((b) => b.tenantId))];
  const entries = await Promise.all(
    tenantIds.map(async (tenantId) => [tenantId, await withTenant({ tenantId, userId }, (tx) => loadTransferSettings(tx, tenantId))] as const),
  );
  return new Map(entries);
}
