import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// La Content-Security-Policy de las páginas la genera src/proxy.ts (nonce por petición).
// Para respuestas que no pasan por el proxy (API, estáticos) se aplica esta base estricta.
const fallbackCsp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

const securityHeaders = [

  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  // cacheComponents desactivado a propósito en la Fase 1: casi todo es dinámico
  // y por tenant/sesión; preferimos renderizado dinámico explícito antes que
  // arriesgar una caché compartida entre complejos. Ver docs/ARQUITECTURA.md.
  poweredByHeader: false,
  experimental: {
    // Subida de imágenes de canchas (máx. 1,5 MB validado en el servidor).
    serverActions: { bodySizeLimit: "2mb" },
  },
  serverExternalPackages: ["pg", "sharp"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: fallbackCsp }] },
      // El service worker nunca se cachea: así las actualizaciones llegan enseguida.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Content-Type", value: "application/javascript; charset=utf-8" }] },
    ];
  },
};

export default nextConfig;
