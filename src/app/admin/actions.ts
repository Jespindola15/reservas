"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireSuperadmin } from "@/lib/auth/dal";
import { AppError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";
import { assignTenantAdmin, createTenant, setTenantStatus } from "@/modules/platform/service";

// Todas re-verifican SUPERADMIN en el servidor y quedan auditadas en el servicio.

export async function createTenantAction(_p: ActionResult, fd: FormData) {
  return runAction("platform.createTenant", async () => {
    const user = await requireSuperadmin();
    const t = await createTenant(user, {
      slug: String(fd.get("slug") ?? ""),
      name: String(fd.get("name") ?? ""),
      timezone: String(fd.get("timezone") ?? "") || undefined,
    });
    revalidatePath("/admin");
    return `Complejo creado: /${t.slug}`;
  });
}

export async function assignAdminAction(_p: ActionResult, fd: FormData) {
  return runAction("platform.assignAdmin", async () => {
    const user = await requireSuperadmin();
    const res = await assignTenantAdmin(user, {
      tenantId: String(fd.get("tenantId") ?? ""),
      email: String(fd.get("email") ?? ""),
      name: String(fd.get("name") ?? ""),
      role: String(fd.get("role") ?? "OWNER") as "OWNER" | "ADMIN" | "STAFF",
      initialPassword: String(fd.get("initialPassword") ?? "") || undefined,
    });
    revalidatePath("/admin");
    return res.created ? "Usuario creado y asignado." : "Usuario existente asignado al complejo.";
  });
}

const statusForm = z.object({
  tenantId: z.uuid(),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  reason: z.string().trim().max(300).default(""),
});

export async function setTenantStatusAction(_p: ActionResult, fd: FormData) {
  return runAction("platform.setTenantStatus", async () => {
    const user = await requireSuperadmin();
    const input = parseOrThrow(statusForm, Object.fromEntries(fd));
    if (input.status === "SUSPENDED" && input.reason.length < 5) throw new AppError("VALIDATION_ERROR", { fields: ["reason"] });
    await setTenantStatus(user, input.tenantId, input.status, input.reason || "reactivado");
    revalidatePath("/admin/complejos", "layout");
    revalidatePath("/admin");
    return input.status === "ACTIVE" ? "Complejo activado." : "Complejo suspendido.";
  });
}

// ---------------------------------------------------------------- Planes

const limitField = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function savePlanAction(planId: string | null, _p: ActionResult, fd: FormData) {
  return runAction("platform.savePlan", async () => {
    const user = await requireSuperadmin();
    const { savePlan } = await import("@/modules/platform/plans");
    await savePlan(user, planId, {
      code: String(fd.get("code") ?? ""),
      name: String(fd.get("name") ?? ""),
      priceAmount: String(fd.get("priceAmount") ?? "0"),
      currency: String(fd.get("currency") ?? "ARS") || "ARS",
      maxCourts: limitField(fd, "maxCourts"),
      maxMembers: limitField(fd, "maxMembers"),
      description: String(fd.get("description") ?? ""),
      isActive: fd.get("isActive") === "on",
    });
    revalidatePath("/admin/planes");
    return planId ? "Plan actualizado." : "Plan creado.";
  });
}

export async function assignSubscriptionAction(_p: ActionResult, fd: FormData) {
  return runAction("platform.assignSubscription", async () => {
    const user = await requireSuperadmin();
    const { assignSubscription } = await import("@/modules/platform/plans");
    const res = await assignSubscription(user, {
      tenantId: String(fd.get("tenantId") ?? ""),
      planId: String(fd.get("planId") ?? ""),
      status: String(fd.get("status") ?? "ACTIVE") as "ACTIVE",
      currentPeriodStart: String(fd.get("currentPeriodStart") ?? ""),
      currentPeriodEnd: String(fd.get("currentPeriodEnd") ?? ""),
      notes: String(fd.get("notes") ?? ""),
    });
    revalidatePath("/admin");
    revalidatePath("/admin/planes");
    return res.warnings.length ? `Plan asignado. Atención: el complejo ${res.warnings.join(" y ")}; no podrá crear más hasta ajustarse.` : "Plan asignado.";
  });
}

export async function recordSubscriptionPaymentAction(_p: ActionResult, fd: FormData) {
  return runAction("platform.subscriptionPayment", async () => {
    const user = await requireSuperadmin();
    const { recordSubscriptionPayment } = await import("@/modules/platform/billing");
    const res = await recordSubscriptionPayment(user, {
      tenantId: String(fd.get("tenantId") ?? ""),
      amount: String(fd.get("amount") ?? ""),
      method: String(fd.get("method") ?? "TRANSFER") as "TRANSFER",
      paidAt: String(fd.get("paidAt") ?? ""),
      periodStart: String(fd.get("periodStart") ?? ""),
      periodEnd: String(fd.get("periodEnd") ?? ""),
      note: String(fd.get("note") ?? ""),
      extend: fd.get("extend") === "on",
    });
    revalidatePath("/admin");
    return res.extendedTo
      ? `Pago registrado. Suscripción activa hasta el ${res.extendedTo.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}.`
      : res.subscriptionId
        ? "Pago registrado."
        : "Pago registrado (el complejo no tiene una suscripción vigente: asignale un plan).";
  });
}

export async function moderateReviewAction(reviewId: string, decision: "HIDE" | "KEEP" | "RESTORE", _p: ActionResult, fd: FormData) {
  return runAction("platform.moderateReview", async () => {
    const user = await requireSuperadmin();
    const { moderateReview } = await import("@/modules/player/reviews");
    await moderateReview(user, reviewId, decision, String(fd.get("note") ?? ""));
    revalidatePath("/admin/moderacion");
    return decision === "HIDE" ? "Opinión ocultada." : decision === "RESTORE" ? "Opinión restaurada." : "Denuncia descartada: la opinión sigue publicada.";
  });
}

// ---------------------------------------------------------------- Usuarios
// Suspender cierra todas las sesiones. Anonimizar es irreversible y exige escribir el email.

export async function suspendUserAction(userId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("platform.user.suspend", async () => {
    const user = await requireSuperadmin();
    const { suspendUser } = await import("@/modules/platform/users");
    const r = await suspendUser(user, userId, String(fd.get("reason") ?? ""));
    revalidatePath("/admin/usuarios", "layout");
    return `Usuario suspendido. Se cerraron ${r.sessionsRevoked} sesión(es).`;
  });
}

export async function reactivateUserAction(userId: string, _p: ActionResult, _fd: FormData): Promise<ActionResult> {
  return runAction("platform.user.reactivate", async () => {
    const user = await requireSuperadmin();
    const { reactivateUser } = await import("@/modules/platform/users");
    await reactivateUser(user, userId);
    revalidatePath("/admin/usuarios", "layout");
    return "Usuario reactivado.";
  });
}

export async function revokeSessionsAction(userId: string, _p: ActionResult, _fd: FormData): Promise<ActionResult> {
  return runAction("platform.user.revoke", async () => {
    const user = await requireSuperadmin();
    const { revokeUserSessions } = await import("@/modules/platform/users");
    const n = await revokeUserSessions(user, userId);
    revalidatePath("/admin/usuarios", "layout");
    return `Se cerraron ${n} sesión(es).`;
  });
}

export async function passwordRecoveryAction(userId: string, _p: ActionResult, _fd: FormData): Promise<ActionResult> {
  return runAction("platform.user.recovery", async () => {
    const user = await requireSuperadmin();
    const { sendPasswordRecovery } = await import("@/modules/platform/users");
    await sendPasswordRecovery(user, userId);
    return "Se encoló el correo de recuperación (se envía cuando el proveedor de email está configurado).";
  });
}

export async function anonymizeUserAction(userId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("platform.user.anonymize", async () => {
    const user = await requireSuperadmin();
    const { anonymizeUser } = await import("@/modules/platform/users");
    await anonymizeUser(user, userId, String(fd.get("confirmEmail") ?? ""));
    revalidatePath("/admin/usuarios", "layout");
    return "Cuenta eliminada (datos personales anonimizados). El historial de reservas de los complejos se conservó.";
  });
}

export async function renameUserAction(userId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("platform.user.rename", async () => {
    const user = await requireSuperadmin();
    const { updateUserName } = await import("@/modules/platform/users");
    await updateUserName(user, userId, String(fd.get("name") ?? ""));
    revalidatePath("/admin/usuarios", "layout");
    return "Nombre actualizado.";
  });
}

// ---------------------------------------------------------------- Complejos (ficha)

export async function updateTenantBasicsAction(tenantId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("platform.tenant.update", async () => {
    const user = await requireSuperadmin();
    const { updateTenantBasics } = await import("@/modules/platform/tenants");
    const v = (k: string) => String(fd.get(k) ?? "");
    await updateTenantBasics(user, tenantId, { name: v("name"), address: v("address"), city: v("city"), province: v("province"), contactPhone: v("contactPhone"), contactEmail: v("contactEmail") });
    revalidatePath("/admin", "layout");
    return "Datos del complejo actualizados.";
  });
}

export async function archiveTenantAction(tenantId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("platform.tenant.archive", async () => {
    const user = await requireSuperadmin();
    const { archiveTenant } = await import("@/modules/platform/tenants");
    const r = await archiveTenant(user, tenantId, String(fd.get("confirmSlug") ?? ""));
    revalidatePath("/admin", "layout");
    return r.futureBookings ? `Complejo archivado. Atención: tenía ${r.futureBookings} reserva(s) futura(s); avisá a esos jugadores.` : "Complejo archivado.";
  });
}

export async function unarchiveTenantAction(tenantId: string, _p: ActionResult, _fd: FormData): Promise<ActionResult> {
  return runAction("platform.tenant.unarchive", async () => {
    const user = await requireSuperadmin();
    const { unarchiveTenant } = await import("@/modules/platform/tenants");
    await unarchiveTenant(user, tenantId);
    revalidatePath("/admin", "layout");
    return "Complejo desarchivado (sigue suspendido hasta que lo reactives).";
  });
}

export async function extendTrialAction(tenantId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("platform.tenant.trial", async () => {
    const user = await requireSuperadmin();
    const { extendTrial } = await import("@/modules/platform/tenants");
    const end = await extendTrial(user, tenantId, Number(fd.get("days") ?? 0));
    revalidatePath("/admin", "layout");
    return `Prueba extendida hasta el ${end.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}.`;
  });
}

export async function changeOwnerAction(tenantId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("platform.tenant.owner", async () => {
    const user = await requireSuperadmin();
    const { changeTenantOwner } = await import("@/modules/platform/tenants");
    await changeTenantOwner(user, tenantId, String(fd.get("email") ?? ""));
    revalidatePath("/admin", "layout");
    return "Dueño actualizado. Los dueños anteriores quedaron como administradores.";
  });
}
