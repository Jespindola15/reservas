import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { enforceRateLimit, jsonError } from "@/lib/http";
import { getClientIp } from "@/lib/security/client-ip";
import { expirePendingBookings } from "@/modules/jobs/expire-pending";

/**
 * Disparo externo del job de vencimiento (cron del hosting, systemd, etc.).
 * Requiere `Authorization: Bearer <CRON_SECRET>`. Sin CRON_SECRET configurado,
 * el endpoint responde 404 (no existe). Ejecutarlo de más es inocuo: el job es idempotente.
 */
function authorized(req: Request, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(req: Request) {
  try {
    const secret = getEnv().CRON_SECRET;
    if (!secret) return new NextResponse(null, { status: 404 });
    await enforceRateLimit(`job:expire:${getClientIp(req.headers)}`, { window: 60, max: 30 });
    if (!authorized(req, secret)) return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    const result = await expirePendingBookings();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e, { route: "internal.jobs.expirePending" });
  }
}
