import { NextResponse, type NextRequest } from "next/server";

/**
 * Content-Security-Policy con NONCE por petición: los scripts solo corren si los
 * emitió el servidor en esta respuesta ('strict-dynamic' propaga la confianza a
 * los chunks que esos scripts cargan). Elimina 'unsafe-inline' de script-src.
 *
 * style-src mantiene 'unsafe-inline': la UI usa atributos style={...}, que los
 * nonces no cubren (riesgo bajo: CSS no ejecuta código). Ver PENDIENTES_Y_RIESGOS.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  // Origen del CDN de imágenes del catálogo (Supabase Storage público), si está configurado.
  let imageOrigin = "";
  try {
    imageOrigin = process.env.IMAGE_PUBLIC_BASE_URL ? new URL(process.env.IMAGE_PUBLIC_BASE_URL).origin : "";
  } catch {
    imageOrigin = "";
  }
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // Teselas de OpenStreetMap para los mapas (solo imágenes; sin scripts de terceros).
    `img-src 'self' data: blob: https://tile.openstreetmap.org${imageOrigin ? ` ${imageOrigin}` : ""}`,
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Páginas HTML. Se excluyen API, estáticos, el service worker y el manifest.
      source: "/((?!api|_next/static|_next/image|favicon.ico|icons/|sw.js|manifest.webmanifest|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
