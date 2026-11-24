import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { tick as runTick } from "./runner";

const g = globalThis as unknown as { __turnupExpirationTimer?: NodeJS.Timeout; __turnupExpirationRunning?: boolean };

/**
 * Programador INTERNO (solo para servidores persistentes: `next start`, VPS, Docker).
 * En Netlify/serverless debe estar apagado (EXPIRATION_SCHEDULER=off): ahí corre la
 * función programada. Un solo temporizador por proceso y sin ejecuciones solapadas.
 */
export function startExpirationScheduler() {
  const env = getEnv();
  if (env.EXPIRATION_SCHEDULER === "off" || env.NODE_ENV === "test" || g.__turnupExpirationTimer) return;

  const tick = async () => {
    if (g.__turnupExpirationRunning) return; // la ejecución anterior sigue en curso
    g.__turnupExpirationRunning = true;
    try {
      await runTick();
    } catch (e) {
      logger.error("job.expire_pending.failed", e);
    } finally {
      g.__turnupExpirationRunning = false;
    }
  };

  g.__turnupExpirationTimer = setInterval(() => void tick(), env.EXPIRATION_INTERVAL_SECONDS * 1000);
  g.__turnupExpirationTimer.unref?.();
  void tick();
  logger.info("job.expire_pending.scheduler_started", { intervalSeconds: env.EXPIRATION_INTERVAL_SECONDS });
}
