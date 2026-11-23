import { getEnv } from "@/lib/env";

/**
 * Obtiene la IP del cliente SOLO a partir de cabeceras que agrega un proxy
 * confiable. X-Forwarded-For puede venir falsificada desde el navegador: con
 * N proxies confiables, la IP real es la N-ésima desde el final.
 * Sin proxy configurado (TRUST_PROXY_HOPS=0) devuelve "unknown" y el rate
 * limiting queda agrupado (ver riesgos residuales en el README).
 */
export function getClientIp(headers: Headers): string {
  const hops = getEnv().TRUST_PROXY_HOPS;
  if (hops === 0) return "unknown";
  const xff = headers.get("x-forwarded-for");
  if (!xff) return "unknown";
  const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
  const candidate = parts[parts.length - hops];
  if (!candidate || candidate.length > 64 || !/^[0-9a-fA-F:.]+$/.test(candidate)) return "unknown";
  return candidate;
}
