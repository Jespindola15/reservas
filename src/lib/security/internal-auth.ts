import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/** Autenticación de endpoints internos (jobs, salud detallada): Bearer CRON_SECRET, tiempo constante. */
export function hasCronSecret(req: Request): boolean {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
