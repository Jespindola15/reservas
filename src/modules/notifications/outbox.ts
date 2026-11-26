import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/tenant-context";

/** Tipos de aviso: al jugador (reserva), al complejo, de cuenta y al superadministrador. */
export const PLAYER_KINDS = [
  "booking_requested",
  "booking_confirmed",
  "booking_cancelled",
  "booking_rejected",
  "booking_rescheduled",
  "booking_reminder", // anterior a la Fase 6 (se siguen enviando los que estén en cola)
  "booking_reminder_24h",
  "booking_reminder_2h",
  "booking_expired",
  "booking_awaiting_transfer",
  "booking_transfer_reported",
  "payment_approved",
  "payment_rejected",
] as const;
export const OWNER_KINDS = [
  "owner_new_request",
  "owner_booking_cancelled",
  "owner_digest",
  "owner_transfer_reported",
  "owner_transfer_expiring",
  "owner_payment_incident",
  "owner_subscription_notice",
] as const;
export const ACCOUNT_KINDS = ["password_reset", "email_verification", "player_welcome", "team_invitation", "tenant_welcome"] as const;
export const ADMIN_KINDS = ["admin_tenant_created", "admin_quota_warning", "admin_email_failures", "admin_test"] as const;
export type NotificationKind =
  | (typeof PLAYER_KINDS)[number]
  | (typeof OWNER_KINDS)[number]
  | (typeof ACCOUNT_KINDS)[number]
  | (typeof ADMIN_KINDS)[number];

/** Avisos al complejo que cada complejo puede apagar (Ajustes → Avisos por email). */
export const OWNER_MUTABLE_KINDS = [
  "owner_new_request",
  "owner_transfer_reported",
  "owner_transfer_expiring",
  "owner_booking_cancelled",
  "owner_payment_incident",
  "owner_subscription_notice",
] as const;

/**
 * Prioridad para el cupo diario del proveedor (1 = más importante). Lo crítico usa la reserva
 * de cupo; lo prescindible deja de salir antes de que se agote.
 */
export const KIND_PRIORITY: Record<NotificationKind, 1 | 2 | 3 | 4 | 5> = {
  password_reset: 1,
  email_verification: 1,
  admin_quota_warning: 1,
  admin_email_failures: 1,
  admin_test: 1,
  booking_confirmed: 2,
  booking_cancelled: 2,
  booking_rejected: 2,
  booking_rescheduled: 2,
  booking_expired: 2,
  booking_requested: 3,
  booking_awaiting_transfer: 3,
  booking_transfer_reported: 3,
  payment_approved: 3,
  payment_rejected: 3,
  owner_transfer_reported: 3,
  owner_transfer_expiring: 3,
  owner_payment_incident: 3,
  owner_new_request: 4,
  owner_booking_cancelled: 4,
  owner_digest: 4,
  owner_subscription_notice: 4,
  team_invitation: 4,
  admin_tenant_created: 4,
  booking_reminder: 5,
  booking_reminder_24h: 5,
  booking_reminder_2h: 5,
  player_welcome: 5,
  tenant_welcome: 5,
};

export function kindPriority(kind: string): number {
  return (KIND_PRIORITY as Record<string, number>)[kind] ?? 3;
}

/**
 * Encola un aviso DENTRO de la transacción del evento (outbox). Si la clave de
 * deduplicación ya existe, no hace nada: el mismo evento nunca genera dos avisos.
 */
export async function enqueue(
  tx: Tx,
  n: {
    tenantId: string | null;
    kind: NotificationKind;
    recipient: string;
    dedupeKey: string;
    bookingId?: string | null;
    payload?: Prisma.InputJsonValue;
  },
) {
  const recipient = n.recipient.trim().toLowerCase();
  if (!recipient.includes("@")) return 0;
  const res = await tx.notification.createMany({
    data: [
      {
        tenantId: n.tenantId,
        kind: n.kind,
        recipient,
        dedupeKey: n.dedupeKey,
        bookingId: n.bookingId ?? null,
        payload: n.payload,
        priority: kindPriority(n.kind),
      },
    ],
    skipDuplicates: true,
  });
  return res.count;
}

export type BookingEvent =
  | { type: "created" }
  /** via "transfer": el complejo verificó la transferencia (un solo email: pago aprobado y reserva confirmada). */
  | { type: "confirmed"; via?: "transfer" }
  | { type: "cancelled"; by: "complex" | "player"; reason?: string | null }
  /** via "transfer": el complejo rechazó la transferencia informada (un solo email: pago rechazado). */
  | { type: "rejected"; reason?: string | null; via?: "transfer" }
  | { type: "rescheduled"; fromStartsAt: string; fromCourtName: string }
  | { type: "transfer_reported" }
  | { type: "payment_incident"; incidentId: string; kind: string };

/**
 * Traduce un evento de reserva en los avisos correspondientes (jugador y/o
 * complejo). Lee los datos dentro de la misma transacción. No consulta los
 * ajustes de avisos: eso se decide al enviar (así un cambio de ajuste aplica
 * también a lo que ya estaba en cola).
 */
export async function enqueueBookingEvent(tx: Tx, tenantId: string, bookingId: string, event: BookingEvent) {
  const b = await tx.booking.findFirst({
    where: { id: bookingId, tenantId },
    select: {
      id: true,
      status: true,
      source: true,
      version: true,
      paymentStatus: true,
      customerEmail: true,
      tenant: { select: { ownerNotificationEmail: true, contactEmail: true } },
    },
  });
  if (!b) return;
  const owner = b.tenant.ownerNotificationEmail ?? b.tenant.contactEmail;
  const player = b.customerEmail;
  const key = (suffix: string) => `booking:${b.id}:${suffix}`;

  switch (event.type) {
    case "created":
      if (player) {
        await enqueue(tx, {
          tenantId,
          kind: b.paymentStatus === "AWAITING_TRANSFER" ? "booking_awaiting_transfer" : b.status === "PENDING" ? "booking_requested" : "booking_confirmed",
          recipient: player,
          dedupeKey: key(b.status === "PENDING" ? "requested" : `confirmed:v${b.version}`),
          bookingId: b.id,
        });
      }
      if (owner && b.source === "ONLINE") {
        await enqueue(tx, { tenantId, kind: "owner_new_request", recipient: owner, dedupeKey: key("owner_new"), bookingId: b.id });
      }
      return;
    case "confirmed":
      // Misma clave que "confirmada": nunca salen los dos emails para la misma confirmación.
      if (player) await enqueue(tx, { tenantId, kind: event.via === "transfer" ? "payment_approved" : "booking_confirmed", recipient: player, dedupeKey: key(`confirmed:v${b.version}`), bookingId: b.id });
      return;
    case "cancelled":
    case "rejected":
      if (player) {
        await enqueue(tx, {
          tenantId,
          kind: event.type === "cancelled" ? "booking_cancelled" : event.via === "transfer" ? "payment_rejected" : "booking_rejected",
          recipient: player,
          dedupeKey: key("cancelled"),
          bookingId: b.id,
          payload: { by: event.type === "rejected" ? "rejected" : event.by, reason: event.reason ?? null },
        });
      }
      if (owner && event.type === "cancelled" && event.by === "player") {
        await enqueue(tx, { tenantId, kind: "owner_booking_cancelled", recipient: owner, dedupeKey: key("owner_cancelled"), bookingId: b.id });
      }
      return;
    case "transfer_reported":
      if (player) await enqueue(tx, { tenantId, kind: "booking_transfer_reported", recipient: player, dedupeKey: key("transfer_reported"), bookingId: b.id });
      if (owner) await enqueue(tx, { tenantId, kind: "owner_transfer_reported", recipient: owner, dedupeKey: key("owner_transfer_reported"), bookingId: b.id });
      return;
    case "payment_incident":
      if (owner) await enqueue(tx, { tenantId, kind: "owner_payment_incident", recipient: owner, dedupeKey: `incident:${event.incidentId}`, bookingId: b.id, payload: { kind: event.kind } });
      return;
    case "rescheduled":
      if (player) {
        await enqueue(tx, {
          tenantId,
          kind: "booking_rescheduled",
          recipient: player,
          dedupeKey: key(`rescheduled:v${b.version}`),
          bookingId: b.id,
          payload: { fromStartsAt: event.fromStartsAt, fromCourtName: event.fromCourtName },
        });
      }
      return;
  }
}
