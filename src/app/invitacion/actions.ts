"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "@/lib/actions";
import { getCurrentUser } from "@/lib/auth/dal";
import { enforceIpRateLimit } from "@/lib/http";
import { getClientIp } from "@/lib/security/client-ip";
import { acceptInvitation } from "@/modules/team/service";

export async function acceptInvitationAction(token: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  let slug: string | null = null;
  let created = false;
  const res = await runAction("team.invitation.accept", async () => {
    await enforceIpRateLimit(getClientIp(await headers()), "invite_accept", { window: 600, max: 10 });
    const user = await getCurrentUser();
    const r = await acceptInvitation(token, {
      currentUser: user ? { id: user.id, email: user.email } : null,
      newAccount: fd.get("password") ? { name: String(fd.get("name") ?? ""), password: String(fd.get("password") ?? "") } : undefined,
    });
    slug = r.slug;
    created = r.createdAccount;
    return "Invitación aceptada.";
  });
  if (slug) redirect(created ? `/login?next=${encodeURIComponent(`/panel/${slug}`)}&bienvenida=1` : `/panel/${slug}`);
  return res;
}
