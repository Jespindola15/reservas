import "server-only";
import { isAppError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export type ActionResult = { ok: boolean; message: string } | null;

/** Ejecuta una Server Action y convierte errores en mensajes seguros. */
export async function runAction(name: string, fn: () => Promise<string>): Promise<ActionResult> {
  try {
    return { ok: true, message: await fn() };
  } catch (e) {
    if (!isAppError(e)) logger.error("action.unhandled_error", e, { action: name });
    return { ok: false, message: toPublicError(e).body.message };
  }
}
