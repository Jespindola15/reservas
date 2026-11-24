import { z } from "zod";
import { AppError } from "@/lib/errors";
import { enforceIpRateLimit, jsonError } from "@/lib/http";
import { getClientIp } from "@/lib/security/client-ip";
import { parseOrThrow } from "@/lib/validation";
import { getTenantAsset } from "@/modules/tenant/branding";
import { publicTenantContext } from "@/modules/tenant/public";

/**
 * Logo, portada y galería del complejo. Mismas defensas que las fotos de canchas:
 * tipo verificado por firma al subir (y reconvertido a WebP), nosniff y CSP sandbox.
 * Son imágenes públicas por diseño (se muestran en la página del complejo).
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string; assetId: string }> }) {
  try {
    const { slug, assetId } = await params;
    parseOrThrow(z.uuid(), assetId);
    await enforceIpRateLimit(getClientIp(req.headers), "img", { window: 60, max: 600 });
    const ctx = await publicTenantContext(slug);
    const img = await getTenantAsset(ctx, assetId);
    if (!img) throw new AppError("NOT_FOUND");
    return new Response(new Uint8Array(img.data), {
      headers: {
        "Content-Type": img.contentType,
        // El id cambia al reemplazar la imagen: se puede cachear sin riesgo de ver una vieja.
        "Cache-Control": "public, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": "inline",
      },
    });
  } catch (e) {
    return jsonError(e, { route: "public.tenantAsset" });
  }
}
