"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireTenant } from "@/lib/auth/dal";
import { AppError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";
import {
  addCourtImage,
  addPriceRule,
  createCourt,
  createScheduleException,
  deleteCourt,
  deleteCourtImage,
  deletePriceRule,
  deleteScheduleException,
  replaceWeeklySchedule,
  setCourtActive,
  updateCourt,
} from "@/modules/courts/service";
import { updateTenantSettings } from "@/modules/tenant/settings";
import { markOnboardingStep } from "@/modules/tenant/onboarding";
import { replyToReview, reportReviewAsComplex } from "@/modules/player/reviews";
import { ASSET_KINDS, addTenantAsset, deleteTenantAsset, updateBranding, type AssetKind, type BrandingInput } from "@/modules/tenant/branding";

/**
 * Configuración del complejo (canchas, horarios, tarifas, feriados, ajustes).
 * Cada acción re-autoriza con `court.manage` / `tenant.settings` en el servidor.
 */

/** "HH:MM" -> minutos desde medianoche. */
function hhmm(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "");
  if (!/^\d{2}:\d{2}$/.test(s)) return null;
  const [h, m] = s.split(":").map(Number) as [number, number];
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** Franja local: si el cierre es <= apertura, termina al día siguiente (cruza medianoche). */
function range(open: number | null, close: number | null) {
  if (open === null || close === null) throw new AppError("VALIDATION_ERROR", { fields: ["horario"] });
  return { openMinute: open, closeMinute: close <= open ? close + 1440 : close };
}

const pesosToCents = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim().replace(/\./g, "").replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw new AppError("VALIDATION_ERROR", { fields: ["precio"] });
  return Math.round(n * 100);
};

function courtFromForm(fd: FormData) {
  const capacity = String(fd.get("capacity") ?? "").trim();
  return {
    name: String(fd.get("name") ?? ""),
    sport: String(fd.get("sport") ?? "") as "PADEL",
    description: String(fd.get("description") ?? ""),
    capacity: capacity ? Number(capacity) : null,
    allowedDurations: fd.getAll("allowedDurations").map(Number),
    slotStepMinutes: Number(fd.get("slotStepMinutes") ?? 30),
    basePrice: pesosToCents(fd.get("basePrice")),
    surface: (String(fd.get("surface") ?? "") || null) as "SINTETICO" | null,
    dimensions: String(fd.get("dimensions") ?? ""),
    covered: fd.get("covered") === "si" ? true : fd.get("covered") === "no" ? false : null,
    lighting: fd.get("lighting") === "on",
  };
}

const actorOf = (userId: string) => ({ type: "USER" as const, userId });

// ------------------------------------------------------------------- Canchas

export async function createCourtAction(slug: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  let createdId: string | null = null;
  const res = await runAction("court.create", async () => {
    const { ctx, user } = await requireTenant(slug, "court.manage");
    const court = await createCourt(ctx, courtFromForm(fd), actorOf(user.id));
    createdId = court.id;
    return "Cancha creada.";
  });
  if (createdId) redirect(`/panel/${slug}/canchas/${createdId}?nueva=1`);
  return res;
}

export async function updateCourtAction(slug: string, courtId: string, _p: ActionResult, fd: FormData) {
  return runAction("court.update", async () => {
    const { ctx, user } = await requireTenant(slug, "court.manage");
    await updateCourt(ctx, courtId, courtFromForm(fd), actorOf(user.id));
    revalidatePath(`/panel/${slug}/canchas`, "layout");
    return "Cambios guardados.";
  });
}

export async function setCourtActiveAction(slug: string, courtId: string, active: boolean, _p: ActionResult, _fd: FormData) {
  return runAction("court.setActive", async () => {
    const { ctx, user } = await requireTenant(slug, "court.manage");
    await setCourtActive(ctx, courtId, active, actorOf(user.id));
    revalidatePath(`/panel/${slug}/canchas`, "layout");
    return active ? "Cancha activada." : "Cancha desactivada. Ya no recibe reservas nuevas.";
  });
}

export async function deleteCourtAction(slug: string, courtId: string, _p: ActionResult, _fd: FormData): Promise<ActionResult> {
  let deleted = false;
  const res = await runAction("court.delete", async () => {
    const { ctx, user } = await requireTenant(slug, "court.manage");
    await deleteCourt(ctx, courtId, actorOf(user.id));
    deleted = true;
    return "Cancha eliminada.";
  });
  if (deleted) redirect(`/panel/${slug}/canchas`);
  return res;
}

// ------------------------------------------------------------- Horario semanal

export async function saveWeeklyScheduleAction(slug: string, courtId: string, _p: ActionResult, fd: FormData) {
  return runAction("court.schedule", async () => {
    const { ctx, user } = await requireTenant(slug, "court.manage");
    const days = [];
    for (let weekday = 1; weekday <= 7; weekday++) {
      if (fd.get(`open_${weekday}`) !== "on") continue;
      days.push({ weekday, ...range(hhmm(fd.get(`from_${weekday}`)), hhmm(fd.get(`to_${weekday}`))) });
    }
    let targets = [courtId];
    if (fd.get("applyAll") === "on") {
      const { listCourtsAdmin } = await import("@/modules/courts/service");
      targets = (await listCourtsAdmin(ctx)).map((c) => c.id);
    }
    const { conflicts } = await replaceWeeklySchedule(ctx, targets, days, actorOf(user.id));
    revalidatePath(`/panel/${slug}/canchas`, "layout");
    const base = targets.length > 1 ? `Horario aplicado a ${targets.length} canchas.` : "Horario guardado.";
    return base + conflictNote(conflicts);
  });
}

// ---------------------------------------------------------------------- Tarifas

export async function addPriceRuleAction(slug: string, courtId: string, _p: ActionResult, fd: FormData) {
  return runAction("court.price.add", async () => {
    const { ctx, user } = await requireTenant(slug, "court.manage");
    const scope = String(fd.get("days") ?? "all");
    const weekdays =
      scope === "weekend" ? [6, 7] : scope === "weekdays" ? [1, 2, 3, 4, 5] : /^[1-7]$/.test(scope) ? [Number(scope)] : [];
    const from = hhmm(fd.get("from"));
    const to = hhmm(fd.get("to"));
    const band = from !== null && to !== null ? range(from, to) : null;
    const amount = pesosToCents(fd.get("amount"));
    if (amount === null) throw new AppError("VALIDATION_ERROR", { fields: ["amount"] });
    const specialDate = String(fd.get("specialDate") ?? "") || null;
    await addPriceRule(
      ctx,
      courtId,
      {
        durationMinutes: Number(fd.get("durationMinutes")),
        weekdays: specialDate ? [] : weekdays,
        startMinute: band?.openMinute ?? null,
        endMinute: band?.closeMinute ?? null,
        specialDate,
        amount,
      },
      actorOf(user.id),
    );
    revalidatePath(`/panel/${slug}/canchas/${courtId}`);
    return "Tarifa agregada.";
  });
}

export async function deletePriceRuleAction(slug: string, courtId: string, _p: ActionResult, fd: FormData) {
  return runAction("court.price.delete", async () => {
    const { ctx, user } = await requireTenant(slug, "court.manage");
    await deletePriceRule(ctx, parseOrThrow(z.uuid(), fd.get("ruleId")), actorOf(user.id));
    revalidatePath(`/panel/${slug}/canchas/${courtId}`);
    return "Tarifa eliminada.";
  });
}

// ---------------------------------------------------------------------- Imágenes

export async function uploadCourtImageAction(slug: string, courtId: string, _p: ActionResult, fd: FormData) {
  return runAction("court.image.add", async () => {
    const { ctx, user } = await requireTenant(slug, "court.manage");
    const file = fd.get("image");
    if (!(file instanceof File) || file.size === 0) throw new AppError("IMAGE_INVALID");
    if (file.size > 1_572_864) throw new AppError("IMAGE_INVALID");
    await addCourtImage(ctx, courtId, new Uint8Array(await file.arrayBuffer()), actorOf(user.id));
    revalidatePath(`/panel/${slug}/canchas`, "layout");
    return "Imagen agregada.";
  });
}

export async function deleteCourtImageAction(slug: string, courtId: string, _p: ActionResult, fd: FormData) {
  return runAction("court.image.delete", async () => {
    const { ctx, user } = await requireTenant(slug, "court.manage");
    await deleteCourtImage(ctx, parseOrThrow(z.uuid(), fd.get("imageId")), actorOf(user.id));
    revalidatePath(`/panel/${slug}/canchas/${courtId}`);
    updateTag("public-directory");
    return "Imagen eliminada.";
  });
}

// ------------------------------------------------- Feriados, cierres, días especiales

export async function createExceptionAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction("schedule.exception.create", async () => {
    const { ctx, user } = await requireTenant(slug, "court.manage");
    const kind = fd.get("kind") === "SPECIAL_HOURS" ? "SPECIAL_HOURS" : "CLOSED";
    const hours = kind === "SPECIAL_HOURS" ? range(hhmm(fd.get("from")), hhmm(fd.get("to"))) : null;
    const courtId = String(fd.get("courtId") ?? "");
    const created = await createScheduleException(
      ctx,
      {
        courtId: courtId || null,
        date: String(fd.get("date") ?? ""),
        kind,
        openMinute: hours?.openMinute ?? null,
        closeMinute: hours?.closeMinute ?? null,
        reason: String(fd.get("reason") ?? ""),
      },
      actorOf(user.id),
    );
    revalidatePath(`/panel/${slug}/horarios`);
    return (kind === "CLOSED" ? "Cierre registrado. Ese día no se ofrecen turnos." : "Horario especial registrado.") + conflictNote(created.conflicts);
  });
}

export async function deleteExceptionAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction("schedule.exception.delete", async () => {
    const { ctx, user } = await requireTenant(slug, "court.manage");
    await deleteScheduleException(ctx, parseOrThrow(z.uuid(), fd.get("exceptionId")), actorOf(user.id));
    revalidatePath(`/panel/${slug}/horarios`);
    return "Excepción eliminada.";
  });
}

// ---------------------------------------------------------------------- Ajustes

export async function updateSettingsAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction("tenant.settings", async () => {
    const { ctx, user } = await requireTenant(slug, "tenant.settings");
    const num = (k: string) => Number(fd.get(k));
    await updateTenantSettings(
      ctx,
      {
        name: String(fd.get("name") ?? ""),
        description: String(fd.get("description") ?? ""),
        contactPhone: String(fd.get("contactPhone") ?? ""),
        contactEmail: String(fd.get("contactEmail") ?? ""),
        address: String(fd.get("address") ?? ""),
        bookingRequiresApproval: fd.get("bookingRequiresApproval") === "on",
        minLeadMinutes: num("minLeadMinutes"),
        maxAdvanceDays: num("maxAdvanceDays"),
        pendingExpirationMinutes: num("pendingExpirationMinutes"),
        publicCancellationMinutes: num("publicCancellationMinutes"),
        notificationsEnabled: fd.get("notificationsEnabled") === "on",
        notifyPlayers: fd.get("notifyPlayers") === "on",
        notifyOwner: fd.get("notifyOwner") === "on",
        ownerNotificationEmail: String(fd.get("ownerNotificationEmail") ?? ""),
        reminderHoursBefore: num("reminderHoursBefore"),
        digestEnabled: fd.get("digestEnabled") === "on",
        digestHour: num("digestHour"),
      },
      actorOf(user.id),
    );
    revalidatePath(`/panel/${slug}`, "layout");
    return "Ajustes guardados.";
  });
}

// ---------------------------------------------------------------------- Equipo

export async function inviteMemberAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction("team.invite", async () => {
    const { ctx, user, role } = await requireTenant(slug, "team.manage");
    const { inviteMember } = await import("@/modules/team/service");
    await inviteMember(ctx, role, { email: String(fd.get("email") ?? ""), role: String(fd.get("role") ?? "STAFF") as "STAFF" }, actorOf(user.id));
    revalidatePath(`/panel/${slug}/equipo`);
    return "Invitación enviada. Vence en 7 días.";
  });
}

export async function revokeInvitationAction(slug: string, invitationId: string, _p: ActionResult, _fd: FormData) {
  return runAction("team.revoke", async () => {
    const { ctx, user, role } = await requireTenant(slug, "team.manage");
    const { revokeInvitation } = await import("@/modules/team/service");
    await revokeInvitation(ctx, role, invitationId, actorOf(user.id));
    revalidatePath(`/panel/${slug}/equipo`);
    return "Invitación revocada.";
  });
}

export async function updateMemberAction(slug: string, membershipId: string, _p: ActionResult, fd: FormData) {
  return runAction("team.update", async () => {
    const { ctx, user, role } = await requireTenant(slug, "team.manage");
    const { updateMember } = await import("@/modules/team/service");
    const newRole = fd.get("role") ? (String(fd.get("role")) as "ADMIN" | "STAFF") : undefined;
    if (newRole && newRole !== "ADMIN" && newRole !== "STAFF") throw new AppError("VALIDATION_ERROR");
    const active = fd.get("isActive");
    await updateMember(ctx, role, { membershipId, role: newRole, isActive: active === null ? undefined : active === "true" }, actorOf(user.id));
    revalidatePath(`/panel/${slug}/equipo`);
    return "Permisos actualizados.";
  });
}

// ---------------------------------------------------------------------- Orden

export async function moveCourtAction(slug: string, courtId: string, direction: "up" | "down", _p: ActionResult, _fd: FormData) {
  return runAction("court.move", async () => {
    const { ctx, user } = await requireTenant(slug, "court.manage");
    const { moveCourt } = await import("@/modules/courts/service");
    await moveCourt(ctx, courtId, direction === "up" ? "up" : "down", actorOf(user.id));
    revalidatePath(`/panel/${slug}/canchas`);
    return "Orden actualizado.";
  });
}

export async function moveCourtImageAction(slug: string, courtId: string, imageId: string, direction: "up" | "down", _p: ActionResult, _fd: FormData) {
  return runAction("court.image.move", async () => {
    const { ctx, user } = await requireTenant(slug, "court.manage");
    const { moveCourtImage } = await import("@/modules/courts/service");
    await moveCourtImage(ctx, imageId, direction === "up" ? "up" : "down", actorOf(user.id));
    revalidatePath(`/panel/${slug}/canchas/${courtId}`);
    return "Orden actualizado.";
  });
}

/** Texto de advertencia cuando un cambio de horario deja reservas activas fuera del horario. */
function conflictNote(c: { count: number; sample: { code: string }[] }): string {
  if (c.count === 0) return "";
  const codes = c.sample.map((x) => x.code).join(", ");
  return ` Atención: ${c.count} ${c.count === 1 ? "reserva activa quedó" : "reservas activas quedaron"} fuera del nuevo horario (${codes}${c.count > c.sample.length ? "…" : ""}). No se modificaron: revisalas en Reservas para mantenerlas, reprogramarlas o cancelarlas.`;
}

// ---------------------------------------------------------------------- Página pública (marca)

export async function updateBrandingAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction("tenant.branding", async () => {
    const { ctx, user } = await requireTenant(slug, "tenant.settings");
    await updateBranding(
      ctx,
      {
        brandColor: String(fd.get("brandColor") ?? ""),
        whatsapp: String(fd.get("whatsapp") ?? ""),
        instagram: String(fd.get("instagram") ?? ""),
        facebook: String(fd.get("facebook") ?? ""),
        website: String(fd.get("website") ?? ""),
        services: fd.getAll("services").map(String) as BrandingInput["services"],
        cancellationPolicy: String(fd.get("cancellationPolicy") ?? ""),
        publicListed: fd.get("publicListed") === "on",
        city: String(fd.get("city") ?? ""),
        province: String(fd.get("province") ?? "") as "",
        latitude: String(fd.get("latitude") ?? ""),
        longitude: String(fd.get("longitude") ?? ""),
        depositNote: String(fd.get("depositNote") ?? ""),
        announcement: String(fd.get("announcement") ?? ""),
        announcementUntil: String(fd.get("announcementUntil") ?? ""),
      },
      actorOf(user.id),
    );
    revalidatePath(`/panel/${slug}`, "layout");
    revalidatePath(`/${slug}`);
    // Inmediato (no "stale-while-revalidate"): el dueño ve su cambio en el catálogo al instante.
    updateTag("public-directory");
    revalidatePath("/");
    return "Página pública actualizada.";
  });
}

export async function uploadTenantAssetAction(slug: string, kind: AssetKind, _p: ActionResult, fd: FormData) {
  return runAction("tenant.asset.add", async () => {
    const { ctx, user } = await requireTenant(slug, "tenant.settings");
    const file = fd.get("image");
    if (!(file instanceof File) || file.size === 0 || file.size > 1_572_864) throw new AppError("IMAGE_INVALID");
    await addTenantAsset(ctx, parseOrThrow(z.enum(ASSET_KINDS), kind), new Uint8Array(await file.arrayBuffer()), actorOf(user.id));
    revalidatePath(`/panel/${slug}`, "layout");
    revalidatePath(`/${slug}`);
    updateTag("public-directory");
    return kind === "LOGO" ? "Logo actualizado." : kind === "COVER" ? "Portada actualizada." : "Foto agregada a la galería.";
  });
}

export async function deleteTenantAssetAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction("tenant.asset.delete", async () => {
    const { ctx, user } = await requireTenant(slug, "tenant.settings");
    await deleteTenantAsset(ctx, parseOrThrow(z.uuid(), fd.get("assetId")), actorOf(user.id));
    revalidatePath(`/panel/${slug}`, "layout");
    revalidatePath(`/${slug}`);
    updateTag("public-directory");
    return "Imagen eliminada.";
  });
}

// ---------------------------------------------------------------------- Puesta en marcha

export async function markOnboardingStepAction(slug: string, step: number, _p: ActionResult, _fd: FormData) {
  return runAction("tenant.onboarding", async () => {
    const { ctx, user } = await requireTenant(slug, "tenant.settings");
    await markOnboardingStep(ctx, step, actorOf(user.id));
    revalidatePath(`/panel/${slug}`, "layout");
    return step === 7 ? "¡Listo! Tu complejo ya está en marcha." : "Paso marcado como hecho.";
  });
}

// ---------------------------------------------------------------------- Opiniones

export async function replyReviewAction(slug: string, reviewId: string, _p: ActionResult, fd: FormData) {
  return runAction("review.reply", async () => {
    const { ctx, user } = await requireTenant(slug, "tenant.settings");
    await replyToReview(ctx, reviewId, String(fd.get("reply") ?? ""), actorOf(user.id));
    revalidatePath(`/panel/${slug}/opiniones`);
    revalidatePath(`/${slug}`);
    return "Respuesta publicada.";
  });
}

export async function reportReviewComplexAction(slug: string, reviewId: string, _p: ActionResult, fd: FormData) {
  return runAction("review.report", async () => {
    const { ctx, user } = await requireTenant(slug, "tenant.settings");
    await reportReviewAsComplex(ctx, reviewId, String(fd.get("reason") ?? ""), actorOf(user.id));
    revalidatePath(`/panel/${slug}/opiniones`);
    return "Denuncia enviada: el equipo de TURNUP la revisará.";
  });
}
