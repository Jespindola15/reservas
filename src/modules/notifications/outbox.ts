import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/tenant-context";

/** Tipos de aviso. Los "player_*" van al jugador; los "owner_*" al complejo. */
export const PLAYER_KINDS = [
  "booking_requested",
  "booking_confirmed",
  "booking_cancelled",
  "booking_rescheduled",
  "booking_reminder",
  "booking_expired",
] as const;
export const OWNER_KINDS = ["owner_new_request", "owner_booking_cancelled", "owner_digest"] as const;
export const ACCOUNT_KINDS = ["password_reset", "team_invitation", "tenant_welcome"] as const;
export type NotificationKind = (typeof PLAYER_KINDS)[number] | (typeof OWNER_KINDS)[number] | (typeof ACCOUNT_KINDS)[number];

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
  if (!recipient.includes("@")) return;
  await tx.notification.createMany({
    data: [
      {
        tenantId: n.tenantId,
        kind: n.kind,
        recipient,
        dedupeKey: n.dedupeKey,
        bookingId: n.bookingId ?? null,
        payload: n.payload,
      },
    ],
    skipDuplicates: true,
  });
}

export type BookingEvent =
  | { type: "created" }
  | { type: "confirmed" }
  | { type: "cancelled"; by: "complex" | "player"; reason?: string | null }
  | { type: "rejected"; reason?: string | null }
  | { type: "rescheduled"; fromStartsAt: string; fromCourtName: string };

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
          kind: b.status === "PENDING" ? "booking_requested" : "booking_confirmed",
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
      if (player) await enqueue(tx, { tenantId, kind: "booking_confirmed", recipient: player, dedupeKey: key(`confirmed:v${b.version}`), bookingId: b.id });
      return;
    case "cancelled":
    case "rejected":
      if (player) {
        await enqueue(tx, {
          tenantId,
          kind: "booking_cancelled",
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
