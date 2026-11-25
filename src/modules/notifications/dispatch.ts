import "server-only";
import { after } from "next/server";
import { logger } from "@/lib/logger";
import { getEmailProvider } from "./providers";

/**
 * Envía los emails pendientes apenas termina la respuesta (sin hacer esperar al usuario).
 * La tarea programada de Netlify corre cada 30 minutos: sin esto, el email con los datos para
 * transferir podía llegar después de vencido el plazo de 30 minutos. Solo actúa si hay un proveedor
 * de email configurado; si no, no hace nada (los avisos internos ya quedaron guardados).
 * Los envíos son idempotentes (bloqueo por fila y clave de deduplicación), así que no se duplican
 * si coincide con la tarea programada.
 */
export function dispatchEmailsSoon() {
  if (!getEmailProvider()) return;
  try {
    after(async () => {
      const { processNotifications } = await import("./processor");
      await processNotifications({ batchSize: 10 }).catch((e: unknown) => logger.error("notifications.dispatch_failed", e));
    });
  } catch {
    // Fuera de un request (scripts o pruebas): lo envía la tarea programada.
  }
}
