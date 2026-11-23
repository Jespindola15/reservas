/**
 * Función programada de Netlify: cada minuto llama al job de vencimiento de
 * solicitudes PENDING (POST /api/internal/jobs/expire-pending con CRON_SECRET).
 * El job es idempotente y seguro ante ejecuciones simultáneas.
 * Requiere la variable CRON_SECRET (mín. 32 caracteres) en Netlify.
 */
import type { Config } from "@netlify/functions";

const handler = async () => {
  const secret = process.env.CRON_SECRET;
  const base = process.env.URL;
  if (!secret || !base) {
    console.error("expire-pending: falta CRON_SECRET o URL");
    return new Response("misconfigured", { status: 500 });
  }
  const res = await fetch(`${base}/api/internal/jobs/expire-pending`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`expire-pending: ${res.status} ${body}`);
  return new Response(body, { status: res.status });
};

export default handler;
export const config: Config = { schedule: "* * * * *" };
