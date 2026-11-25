"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { dispatchEmailsSoon } from "@/modules/notifications/dispatch";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/dal";
import { AppError } from "@/lib/errors";
import { getClientIp } from "@/lib/security/client-ip";
import { claimBookingByLink } from "@/modules/booking/public-access";
import { registerPlayer, updatePlayerProfile, PLAYER_SPORTS } from "@/modules/player/account";
import { cancelPlayerBooking, reportPlayerTransfer } from "@/modules/player/bookings";
import { toggleFavorite } from "@/modules/player/favorites";
import { createReview, reportReviewAsPlayer } from "@/modules/player/reviews";

/** Registro de jugador. El inicio de sesión lo hace el navegador después (Better Auth). */
export async function registerPlayerAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("player.register", async () => {
    const ip = getClientIp(await headers());
    await registerPlayer(
      {
        name: String(fd.get("name") ?? ""),
        email: String(fd.get("email") ?? ""),
        password: String(fd.get("password") ?? ""),
        phone: String(fd.get("phone") ?? ""),
        city: String(fd.get("city") ?? ""),
        acceptTerms: (fd.get("acceptTerms") === "on") as true,
        website: String(fd.get("website") ?? ""),
      },
      ip,
    );
    return "Cuenta creada.";
  });
}

export async function updateProfileAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("player.profile", async () => {
    const user = await requireUser();
    await updatePlayerProfile(user.id, {
      name: String(fd.get("name") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      city: String(fd.get("city") ?? ""),
      favoriteSports: fd.getAll("favoriteSports").map(String).filter((s): s is (typeof PLAYER_SPORTS)[number] => (PLAYER_SPORTS as readonly string[]).includes(s)),
      notifyEmail: fd.get("notifyEmail") === "on",
      notifyReminders: fd.get("notifyReminders") === "on",
    });
    revalidatePath("/perfil");
    revalidatePath("/");
    return "Perfil actualizado.";
  });
}

export async function toggleFavoriteAction(slug: string, _p: ActionResult, _fd: FormData): Promise<ActionResult> {
  return runAction("player.favorite", async () => {
    const user = await requireUser();
    const on = await toggleFavorite(user.id, slug);
    revalidatePath(`/${slug}`);
    revalidatePath("/");
    revalidatePath("/perfil");
    return on ? "Agregado a favoritos." : "Quitado de favoritos.";
  });
}

export async function markMyInboxReadAction(_p: ActionResult, _fd: FormData): Promise<ActionResult> {
  return runAction("player.inbox_read", async () => {
    const user = await requireUser();
    const { markPlayerInboxRead } = await import("@/modules/inbox/service");
    await markPlayerInboxRead(user.id);
    revalidatePath("/avisos");
    return "Listo.";
  });
}

/** "Ya realicé la transferencia" desde Mis turnos (jugador con cuenta). Informar ≠ pago verificado. */
export async function reportMyTransferAction(bookingId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("player.transfer_report", async () => {
    const user = await requireUser();
    const raw = String(fd.get("reference") ?? "").trim();
    const reference = raw ? raw.replace(/[^0-9A-Za-z-]/g, "").slice(0, 40) || null : null;
    const res = await reportPlayerTransfer(user.id, bookingId, reference);
    revalidatePath("/mis-turnos");
    dispatchEmailsSoon();
    return res.status === "late"
      ? "El plazo para transferir ya había vencido. Avisamos al complejo para que revise tu caso manualmente."
      : "Listo, avisamos al complejo. Tu turno se confirma cuando verifique la transferencia.";
  });
}

export async function cancelMyBookingAction(bookingId: string, _p: ActionResult, _fd: FormData): Promise<ActionResult> {
  return runAction("player.cancel", async () => {
    const user = await requireUser();
    await cancelPlayerBooking(user.id, bookingId);
    dispatchEmailsSoon();
    revalidatePath("/mis-turnos");
    revalidatePath("/");
    return "Reserva cancelada.";
  });
}

/**
 * Vincular una reserva hecha como invitado: se pega el enlace privado que se recibió al
 * reservar (/<complejo>/reserva/<código>?t=<token>). Solo quien tiene ese enlace puede hacerlo.
 */
export async function claimBookingAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("player.claim", async () => {
    const user = await requireUser();
    const raw = String(fd.get("link") ?? "").trim().slice(0, 500);
    let url: URL;
    try {
      url = new URL(raw, "https://x.invalid");
    } catch {
      throw new AppError("INVALID_LINK");
    }
    const m = url.pathname.match(/^\/([a-z0-9][a-z0-9-]{1,48}[a-z0-9])\/reserva\/([A-Za-z0-9]{8})$/);
    const token = url.searchParams.get("t") ?? "";
    if (!m) throw new AppError("INVALID_LINK");
    const res = await claimBookingByLink(user.id, m[1]!, m[2]!, token);
    revalidatePath("/mis-turnos");
    return `Reserva ${res.code} vinculada a tu cuenta.`;
  });
}

export async function reviewAction(bookingId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("player.review", async () => {
    const user = await requireUser();
    await createReview(user.id, { bookingId, rating: String(fd.get("rating") ?? ""), comment: String(fd.get("comment") ?? "") });
    revalidatePath("/mis-turnos");
    return "¡Gracias por tu opinión!";
  });
}

export async function reportReviewAction(slug: string, reviewId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("player.reportReview", async () => {
    const user = await requireUser();
    await reportReviewAsPlayer(user.id, slug, reviewId, String(fd.get("reason") ?? ""));
    return "Gracias: el equipo de TURNUP va a revisar la opinión.";
  });
}
