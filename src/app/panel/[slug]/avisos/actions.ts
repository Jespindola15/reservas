"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireTenant } from "@/lib/auth/dal";
import { markTenantInboxRead } from "@/modules/inbox/service";

export async function markInboxReadAction(slug: string, _p: ActionResult, _fd: FormData): Promise<ActionResult> {
  return runAction("inbox.read", async () => {
    const { ctx } = await requireTenant(slug, "booking.read");
    await markTenantInboxRead(ctx);
    revalidatePath(`/panel/${slug}`, "layout");
    return "Avisos marcados como leídos.";
  });
}
