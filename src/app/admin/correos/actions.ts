"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireSuperadmin } from "@/lib/auth/dal";
import { retryEmail, sendTestEmail } from "@/modules/platform/emails";
import { AppError } from "@/lib/errors";
import { reasonLabel } from "@/modules/notifications/labels";

export async function retryEmailAction(id: string, _p: ActionResult, _fd: FormData): Promise<ActionResult> {
  return runAction("platform.email.retry", async () => {
    const user = await requireSuperadmin();
    await retryEmail(user, id);
    revalidatePath("/admin/correos");
    return "Vuelve a la cola: se envía en el próximo ciclo si todavía corresponde.";
  });
}

export async function sendTestEmailAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("platform.email.test", async () => {
    const user = await requireSuperadmin();
    const r = await sendTestEmail(user, String(fd.get("recipient") ?? ""));
    revalidatePath("/admin/correos");
    if (r.status === "SENT") return "El proveedor ACEPTÓ el correo de prueba. Revisá la bandeja (y Spam/Promociones): aceptado no garantiza entregado.";
    if (r.status === "FAILED") throw new AppError("EMAIL_TEST_FAILED");
    return `Quedó en cola${r.error ? ` (${reasonLabel(r.error)})` : ""}. Se reintenta solo.`;
  });
}
