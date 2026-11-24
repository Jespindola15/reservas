import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { enforceIpRateLimit, jsonError } from "@/lib/http";
import { getClientIp } from "@/lib/security/client-ip";
import { hasCronSecret } from "@/lib/security/internal-auth";
import { tick } from "@/modules/jobs/runner";

/**
 * Tarea programada única: vencimientos, avisos, envío de emails y limpieza.
 * La dispara la función programada de Netlify (cada minuto) o un cron externo.
 * Requiere Authorization: Bearer <CRON_SECRET>. Sin CRON_SECRET => 404.
 */
export async function POST(req: Request) {
  try {
    if (!getEnv().CRON_SECRET) return new NextResponse(null, { status: 404 });
    await enforceIpRateLimit(getClientIp(req.headers), "job:tick", { window: 60, max: 20 });
    if (!hasCronSecret(req)) return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    const result = await tick();
    const ok = Object.values(result).every((r) => r.ok);
    return NextResponse.json({ ok, result }, { status: ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e, { route: "internal.jobs.tick" });
  }
}
