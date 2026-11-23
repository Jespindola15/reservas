import { getEnv } from "@/lib/env";

const IP_RE = /^[0-9a-fA-F:.]{2,64}$/;

/**
 * IP del cliente para rate limiting y auditoría. ÚNICA fuente de verdad (la usan
 * también las reglas de login de Better Auth vía AUTH_CLIENT_IP_HEADER).
 *
 * Orden:
 *  1. AUTH_CLIENT_IP_HEADER: cabecera que el proxy SOBRESCRIBE (x-real-ip,
 *     cf-connecting-ip…). Es la opción recomendada.
 *  2. TRUST_PROXY_HOPS > 0: N-ésima entrada desde el final de X-Forwarded-For.
 *  3. Sin proxy configurado: "unknown" (contador compartido: no se puede evadir,
 *     pero un abusador puede agotar el cupo de todos → configurar en producción).
 */
export function getClientIp(headers: Headers): string {
  const env = getEnv();
  if (env.AUTH_CLIENT_IP_HEADER) {
    const v = headers.get(env.AUTH_CLIENT_IP_HEADER)?.trim();
    return v && IP_RE.test(v) ? v : "unknown";
  }
  const hops = env.TRUST_PROXY_HOPS;
  if (hops === 0) return "unknown";
  const xff = headers.get("x-forwarded-for");
  if (!xff) return "unknown";
  const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
  const candidate = parts[parts.length - hops];
  return candidate && IP_RE.test(candidate) ? candidate : "unknown";
}
