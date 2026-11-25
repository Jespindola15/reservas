import { z } from "zod";
import { enforceIpRateLimit, jsonError } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { getClientIp } from "@/lib/security/client-ip";
import { parseOrThrow } from "@/lib/validation";
import { getCourtImage } from "@/modules/courts/service";
import { publicTenantContext } from "@/modules/tenant/public";

/**
 * Sirve imágenes de canchas. El tipo se guardó tras verificar la firma de bytes
 * (solo JPEG/PNG/WebP), se fuerza nosniff y una CSP que impide ejecutar nada.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string; courtId: string; imageId: string }> }) {
  try {
    const { slug, courtId, imageId } = await params;
    parseOrThrow(z.uuid(), courtId);
    parseOrThrow(z.uuid(), imageId);
    await enforceIpRateLimit(getClientIp(req.headers), "img", { window: 60, max: 600 });
    const ctx = await publicTenantContext(slug);
    const img = await getCourtImage(ctx, courtId, imageId);
    if (!img) throw new AppError("NOT_FOUND");
    if ("redirect" in img) {
      // Imagen en el CDN del proveedor: redirección cacheable (la URL de destino nunca cambia de contenido).
      return new Response(null, { status: 301, headers: { Location: img.redirect, "Cache-Control": "public, max-age=31536000, immutable" } });
    }
    return new Response(new Uint8Array(img.data), {
      headers: {
        "Content-Type": img.contentType,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": "inline",
      },
    });
  } catch (e) {
    return jsonError(e, { route: "public.courtImage" });
  }
}
