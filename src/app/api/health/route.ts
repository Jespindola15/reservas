import { NextResponse } from "next/server";
import { emailProviderName, getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { hasCronSecret } from "@/lib/security/internal-auth";
import { healthSnapshot } from "@/modules/jobs/runner";

/**
 * Salud del servicio para monitores externos (UptimeRobot, Better Stack, etc.).
 *  - Sin credenciales: solo { status } (ok | degraded | down). Nada interno.
 *  - Con Bearer CRON_SECRET: detalle (latencia de BD, jobs, cola de emails, avisos de configuración).
 * 200 = ok/degraded, 503 = down.
 */
export async function GET(req: Request) {
  const headers = { "Cache-Control": "no-store" };
  let snap: Awaited<ReturnType<typeof healthSnapshot>>;
  let configOk = true;
  try {
    getEnv();
  } catch {
    configOk = false;
  }
  try {
    if (!configOk) throw new Error("config");
    snap = await healthSnapshot();
  } catch (e) {
    logger.error("health.down", e);
    return NextResponse.json({ status: "down" }, { status: 503, headers });
  }
  const tickRun = snap.jobs.find((j) => j.name === "tick");
  const jobsStale = !tickRun?.lastSuccessAt || Date.now() - tickRun.lastSuccessAt.getTime() > 5 * 60_000;
  const failingJobs = snap.jobs.filter((j) => j.consecutiveFailures > 0).map((j) => j.name);
  const warnings: string[] = [];
  const env = getEnv();
  if (!env.AUTH_CLIENT_IP_HEADER) warnings.push("AUTH_CLIENT_IP_HEADER sin configurar (rate limiting por IP inactivo)");
  if (emailProviderName() === "disabled") warnings.push("Emails desactivados (EMAIL_PROVIDER)");
  if (!env.CRON_SECRET) warnings.push("CRON_SECRET vacío: la tarea programada no puede ejecutarse");
  if (jobsStale) warnings.push("La tarea programada no corrió en los últimos 5 minutos");
  const status = jobsStale || failingJobs.length || snap.backlog > 0 || snap.dbMs > 2000 ? "degraded" : "ok";
  if (!hasCronSecret(req)) return NextResponse.json({ status }, { headers });
  return NextResponse.json(
    {
      status,
      db: { latencyMs: snap.dbMs },
      jobs: snap.jobs.map((j) => ({ name: j.name, lastSuccessAt: j.lastSuccessAt, lastStatus: j.lastStatus, consecutiveFailures: j.consecutiveFailures })),
      notifications: { backlogOlderThan15m: snap.backlog, failedLast24h: snap.failed24h, provider: emailProviderName() },
      warnings,
    },
    { headers },
  );
}
