"use server";

import { revalidatePath } from "next/cache";
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
    await replaceWeeklySchedule(ctx, targets, days, actorOf(user.id));
    revalidatePath(`/panel/${slug}/canchas`, "layout");
    return targets.length > 1 ? `Horario aplicado a ${targets.length} canchas.` : "Horario guardado.";
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
    await createScheduleException(
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
    return kind === "CLOSED" ? "Cierre registrado. Ese día no se ofrecen turnos." : "Horario especial registrado.";
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
      },
      actorOf(user.id),
    );
    revalidatePath(`/panel/${slug}`, "layout");
    return "Ajustes guardados.";
  });
}
