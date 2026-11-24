"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "@/lib/actions";
import { PUBLIC_ACTOR } from "@/lib/audit";
import { enforceIpRateLimit } from "@/lib/http";
import { getClientIp } from "@/lib/security/client-ip";
import { cancelBookingPublic } from "@/modules/booking/public-access";

/** Cancelación por el jugador: requiere código + token del enlace privado. Rate limited. */
export async function cancelOwnBookingAction(slug: string, code: string, token: string, _p: ActionResult, _fd: FormData): Promise<ActionResult> {
  let done = false;
  const res = await runAction("booking.public_cancel", async () => {
    const ip = getClientIp(await headers());
    await enforceIpRateLimit(ip, "pubcancel", { window: 600, max: 10 });
    await cancelBookingPublic(slug, code, token, PUBLIC_ACTOR(ip === "unknown" ? null : ip));
    revalidatePath(`/${slug}/reserva/${code}`);
    done = true;
    return "Tu reserva fue cancelada. El turno quedó libre.";
  });
  if (done) redirect(`/${slug}/reserva/${code}?t=${encodeURIComponent(token)}&cancelada=1`);
  return res;
}
