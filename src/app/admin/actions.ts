"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireSuperadmin } from "@/lib/auth/dal";
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
    await setTenantStatus(user, input.tenantId, input.status, input.reason || "sin motivo");
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
