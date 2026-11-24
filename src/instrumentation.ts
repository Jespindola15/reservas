/**
 * Arranque del servidor. Inicia el programador INTERNO de vencimientos, que corre
 * en el proceso de Node.js (no en el navegador): las solicitudes vencen aunque el
 * jugador cierre la página. Con varias instancias no hay doble procesamiento
 * (SKIP LOCKED en la base). Se puede desactivar con EXPIRATION_SCHEDULER=off si
 * se usa un cron externo (POST /api/internal/jobs/expire-pending, `npm run job:expire`
 * o la función programada de Netlify).
 *
 * Nunca debe tirar abajo el servidor: si la configuración está incompleta, se
 * registra el problema y las páginas que no dependen de la base siguen respondiendo.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // En serverless (Netlify/AWS Lambda) no hay proceso persistente: un setInterval correría en cada
  // instancia "tibia" y multiplicaría la carga. Ahí el ÚNICO scheduler es la función programada.
  const serverless = Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
  if (serverless) return;
  try {
    const { startExpirationScheduler } = await import("./modules/jobs/scheduler");
    startExpirationScheduler();
  } catch (e) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "startup.config_invalid",
        hint: "Revisá las variables de entorno (README → Deploy en Netlify). El programador de vencimientos NO está activo.",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }
}
