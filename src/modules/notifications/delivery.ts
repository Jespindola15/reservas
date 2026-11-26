import { timingSafeEqual } from "node:crypto";
import { withSystem } from "@/lib/db/tenant-context";

/**
 * Eventos de entrega del proveedor (webhook transaccional de Brevo). "Aceptado" (SENT) no es
 * "entregado": acá se registra lo que informa el proveedor después.
 * Cada evento solo puede AVANZAR el estado (un "deferred" tardío no pisa un "delivered").
 */
const EVENT_MAP: Record<string, string> = {
  delivered: "delivered",
  deferred: "deferred",
  soft_bounce: "soft_bounce",
  hard_bounce: "hard_bounce",
  blocked: "blocked",
  invalid_email: "invalid",
  invalid: "invalid",
  spam: "spam",
  error: "error",
  unsubscribed: "unsubscribed",
  opened: "opened",
  unique_opened: "opened",
  proxy_open: "opened",
  click: "clicked",
};
export const DELIVERY_RANK: Record<string, number> = {
  deferred: 1, soft_bounce: 2, delivered: 3, opened: 4, clicked: 5,
  hard_bounce: 6, blocked: 6, invalid: 6, error: 6, spam: 7, unsubscribed: 7,
};

export const DELIVERY_LABEL: Record<string, string> = {
  delivered: "Entregado",
  deferred: "Demorado",
  soft_bounce: "Rebote temporal",
  hard_bounce: "Rebotó (dirección inexistente)",
  blocked: "Bloqueado por el proveedor",
  invalid: "Dirección inválida",
  spam: "Marcado como spam",
  error: "Error de entrega",
  unsubscribed: "Se dio de baja",
  opened: "Abierto",
  clicked: "Abierto (clic en un enlace)",
};

/** Bearer <secreto> o Basic (cualquier usuario, contraseña = secreto). Comparación en tiempo constante. */
export function webhookAuthorized(header: string | null, secret: string): boolean {
  if (!secret || !header) return false;
  let given = "";
  if (header.startsWith("Bearer ")) given = header.slice(7).trim();
  else if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
    given = decoded.slice(decoded.indexOf(":") + 1);
  }
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

type BrevoEvent = { event?: unknown; "message-id"?: unknown; messageId?: unknown };

/** Aplica eventos; devuelve cuántas filas cambiaron. Ignora eventos desconocidos o de otros mensajes. */
export async function applyDeliveryEvents(events: BrevoEvent[]): Promise<number> {
  let updated = 0;
  for (const e of events.slice(0, 100)) {
    const status = EVENT_MAP[String(e.event ?? "").toLowerCase()];
    const messageId = String(e["message-id"] ?? e.messageId ?? "").trim().slice(0, 300);
    if (!status || !messageId) continue;
    const rank = DELIVERY_RANK[status]!;
    updated += await withSystem((tx) =>
      tx.$executeRaw`UPDATE notifications SET delivery_status = ${status}, delivery_updated_at = now()
        WHERE provider_message_id = ${messageId}
          AND (delivery_status IS NULL OR ${rank} >= CASE delivery_status
            WHEN 'deferred' THEN 1 WHEN 'soft_bounce' THEN 2 WHEN 'delivered' THEN 3 WHEN 'opened' THEN 4 WHEN 'clicked' THEN 5
            WHEN 'spam' THEN 7 WHEN 'unsubscribed' THEN 7 ELSE 6 END)`,
    );
  }
  return updated;
}
