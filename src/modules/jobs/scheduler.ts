import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { expirePendingBookings } from "./expire-pending";

const g = globalThis as unknown as { __turnupExpirationTimer?: NodeJS.Timeout; __turnupExpirationRunning?: boolean };

/** Programador interno con un solo temporizador por proceso y sin ejecuciones solapadas. */
export function startExpirationScheduler() {
  const env = getEnv();
  if (env.EXPIRATION_SCHEDULER === "off" || env.NODE_ENV === "test" || g.__turnupExpirationTimer) return;

  const tick = async () => {
    if (g.__turnupExpirationRunning) return; // la ejecución anterior sigue en curso
    g.__turnupExpirationRunning = true;
    try {
      await expirePendingBookings();
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
