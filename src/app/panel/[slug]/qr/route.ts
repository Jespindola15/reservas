import QRCode from "qrcode";
import { requireTenant } from "@/lib/auth/dal";
import { enforceRateLimit, jsonError } from "@/lib/http";
import { publicTenantUrl } from "@/lib/public-url";

/**
 * QR descargable de la página pública del complejo (PNG para imprimir o SVG).
 * Solo el equipo del complejo; el contenido es la URL pública (nada privado).
 * GET /panel/<slug>/qr?formato=png|svg
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const access = await requireTenant(slug, "booking.read");
    await enforceRateLimit(`qr:${access.user.id}`, { window: 60, max: 30 });
    const url = publicTenantUrl(access.tenant.slug);
    const svg = new URL(req.url).searchParams.get("formato") === "svg";
    const opts = { errorCorrectionLevel: "M" as const, margin: 2, color: { dark: "#0b0f0a", light: "#ffffff" } };
    const body = svg ? await QRCode.toString(url, { ...opts, type: "svg" }) : new Uint8Array(await QRCode.toBuffer(url, { ...opts, width: 1024 }));
    return new Response(body, {
      headers: {
        "Content-Type": svg ? "image/svg+xml" : "image/png",
        "Content-Disposition": `attachment; filename="turnup-${access.tenant.slug}-qr.${svg ? "svg" : "png"}"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) {
    return jsonError(e, { route: "panel.qr" });
  }
}
