"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { dispatchEmailsSoon } from "@/modules/notifications/dispatch";
import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "@/lib/actions";
import { PUBLIC_ACTOR } from "@/lib/audit";
import { enforceIpRateLimit } from "@/lib/http";
import { getClientIp } from "@/lib/security/client-ip";
import { cancelBookingPublic, reportTransferByLink } from "@/modules/booking/public-access";

/** Cancelación por el jugador: requiere código + token del enlace privado. Rate limited. */
export async function cancelOwnBookingAction(slug: string, code: string, token: string, _p: ActionResult, _fd: FormData): Promise<ActionResult> {
  let done = false;
  const res = await runAction("booking.public_cancel", async () => {
    const ip = getClientIp(await headers());
    await enforceIpRateLimit(ip, "pubcancel", { window: 600, max: 10 });
    await cancelBookingPublic(slug, code, token, PUBLIC_ACTOR(ip === "unknown" ? null : ip));
    dispatchEmailsSoon();
    revalidatePath(`/${slug}/reserva/${code}`);
    done = true;
    return "Tu reserva fue cancelada. El turno quedó libre.";
  });
  if (done) redirect(`/${slug}/reserva/${code}?t=${encodeURIComponent(token)}&cancelada=1`);
  return res;
}

/**
 * "Ya realicé la transferencia": el jugador INFORMA el pago (no es un pago verificado).
 * Número de operación opcional; no se piden comprobantes ni datos bancarios del jugador.
 */
export async function reportTransferAction(slug: string, code: string, token: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("booking.transfer_report", async () => {
    const ip = getClientIp(await headers());
    await enforceIpRateLimit(ip, "pubtransfer", { window: 600, max: 10 });
    const raw = String(fd.get("reference") ?? "").trim();
    const reference = raw ? raw.replace(/[^0-9A-Za-z-]/g, "").slice(0, 40) || null : null;
    const res = await reportTransferByLink(slug, code, token, reference, PUBLIC_ACTOR(ip === "unknown" ? null : ip));
    revalidatePath(`/${slug}/reserva/${code}`);
    dispatchEmailsSoon();
    return res.status === "late"
      ? "El plazo para transferir ya había vencido. Avisamos al complejo para que revise tu caso manualmente: comunicate con el complejo."
      : "Listo, avisamos al complejo. Tu turno se confirma cuando el complejo verifique la transferencia.";
  });
}
