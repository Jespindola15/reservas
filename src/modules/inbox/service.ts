import type { Tx } from "@/lib/db/tenant-context";
import { withPlayer, withTenant, type TenantContext } from "@/lib/db/tenant-context";

/**
 * Notificaciones INTERNAS (bandeja dentro de TURNUP). Son reales: se guardan en la base y se
 * ven en el panel del complejo o en la cuenta del jugador. No se envía nada por WhatsApp ni
 * SMS; los emails salen por la cola existente cuando haya proveedor configurado.
 */
export type InboxInput = { kind: string; title: string; body?: string | null; link?: string | null; bookingId?: string | null };

/** Aviso para todo el equipo del complejo (dentro de una transacción con contexto del complejo). */
export async function notifyTenant(tx: Tx, tenantId: string, n: InboxInput) {
  await tx.inboxNotification.create({
    data: { tenantId, kind: n.kind, title: n.title.slice(0, 140), body: n.body?.slice(0, 500) ?? null, link: n.link ?? null, bookingId: n.bookingId ?? null },
  });
}

/** Aviso al jugador con cuenta vinculado a la reserva (si no tiene cuenta, no hace nada). */
export async function notifyBookingPlayer(tx: Tx, bookingId: string, n: Omit<InboxInput, "bookingId">) {
  await tx.$executeRaw`SELECT app_inbox_notify_booking_player(${bookingId}::uuid, ${n.kind}, ${n.title}, ${n.body ?? null}, ${n.link ?? null})`;
}

export async function listTenantInbox(ctx: TenantContext, limit = 30) {
  return withTenant(ctx, async (tx) => {
    const [rows, unread] = await Promise.all([
      tx.inboxNotification.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, kind: true, title: true, body: true, link: true, readAt: true, createdAt: true } }),
      tx.inboxNotification.count({ where: { tenantId: ctx.tenantId, readAt: null } }),
    ]);
    return { rows, unread };
  });
}

export async function markTenantInboxRead(ctx: TenantContext) {
  await withTenant(ctx, (tx) => tx.inboxNotification.updateMany({ where: { tenantId: ctx.tenantId, readAt: null }, data: { readAt: new Date() } }));
}

export async function listPlayerInbox(userId: string, limit = 30) {
  return withPlayer(userId, async (tx) => {
    const [rows, unread] = await Promise.all([
      tx.inboxNotification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, kind: true, title: true, body: true, link: true, readAt: true, createdAt: true } }),
      tx.inboxNotification.count({ where: { userId, readAt: null } }),
    ]);
    return { rows, unread };
  });
}

export async function markPlayerInboxRead(userId: string) {
  await withPlayer(userId, (tx) => tx.inboxNotification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } }));
}

/** Contadores livianos para la navegación del panel (avisos sin leer y transferencias por verificar). */
export async function panelBadges(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => {
    const [unread, transfers] = await Promise.all([
      tx.inboxNotification.count({ where: { tenantId: ctx.tenantId, readAt: null } }),
      tx.booking.count({ where: { tenantId: ctx.tenantId, status: "PENDING", paymentStatus: "TRANSFER_REPORTED" } }),
    ]);
    return { unread, transfers };
  });
}

/** Los avisos del complejo guardan rutas relativas al panel ("/transferencias"); se resuelven acá. */
export function panelLink(slug: string, link: string | null) {
  if (!link) return null;
  return link.startsWith("/panel/") ? link : `/panel/${slug}${link.startsWith("/") ? link : `/${link}`}`;
}
