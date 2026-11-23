/**
 * Arranque del servidor. Inicia el programador INTERNO de vencimientos, que corre
 * en el proceso de Node.js (no en el navegador): las solicitudes vencen aunque el
 * jugador cierre la página. Con varias instancias no hay doble procesamiento
 * (SKIP LOCKED en la base). Se puede desactivar con EXPIRATION_SCHEDULER=off si
 * se usa un cron externo (POST /api/internal/jobs/expire-pending o `npm run job:expire`).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startExpirationScheduler } = await import("./modules/jobs/scheduler");
  startExpirationScheduler();
}
