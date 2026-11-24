import { getEnv } from "@/lib/env";

/** URL pública canónica de un complejo (para compartir, QR y emails). */
export function publicTenantUrl(slug: string): string {
  return `${getEnv().BETTER_AUTH_URL.replace(/\/$/, "")}/${encodeURIComponent(slug)}`;
}
