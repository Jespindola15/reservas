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
