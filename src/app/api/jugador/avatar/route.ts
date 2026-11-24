import { getCurrentUser } from "@/lib/auth/dal";
import { AppError } from "@/lib/errors";
import { jsonError } from "@/lib/http";
import { getPlayerAvatar } from "@/modules/player/account";

/** Foto de perfil del jugador con sesión (solo la propia; nunca cacheada por intermediarios). */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AppError("UNAUTHENTICATED");
    const img = await getPlayerAvatar(user.id);
    if (!img) throw new AppError("NOT_FOUND");
    return new Response(new Uint8Array(img), {
      headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
    });
  } catch (e) {
    return jsonError(e, { route: "player.avatar" });
  }
}
