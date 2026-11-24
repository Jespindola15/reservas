/**
 * Función programada de Netlify (ÚNICO scheduler de TURNUP en este hosting): llama a
 * POST /api/internal/jobs/tick con CRON_SECRET. El tick es idempotente y seguro ante
 * ejecuciones simultáneas o repetidas; si una ejecución falla, la siguiente retoma lo pendiente.
 *
 * Frecuencia: cada 30 minutos. Cada llamada "despierta" la base de Neon, que queda activa
 * ~5 minutos; con un tick por minuto la base no se suspendería nunca y el plan Free
 * (100 CU-horas/mes) se agotaría a mitad de mes (≈182 CU-h a 0,25 CU). Cada 30 min ≈ 30 CU-h.
 * No afecta la disponibilidad: las solicitudes vencidas dejan de ocupar el turno en el
 * momento (lo resuelven la consulta de disponibilidad y la creación de reservas).
 * Con un plan pago de Neon se puede bajar a "* * * * *" (o cada 5 minutos).
 */
import type { Config } from "@netlify/functions";

const handler = async () => {
  const secret = process.env.CRON_SECRET;
  const base = process.env.URL;
  if (!secret || !base) {
    console.error("tick: falta CRON_SECRET o URL");
    return new Response("misconfigured", { status: 500 });
  }
  const res = await fetch(`${base}/api/internal/jobs/tick`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  // Solo contadores (sin datos personales). Un status ≠ 200 queda visible en los logs de Netlify.
  if (res.ok) console.log(`tick: ${res.status} ${body.slice(0, 500)}`);
  else console.error(`tick: FALLÓ ${res.status} ${body.slice(0, 500)}`);
  return new Response(body, { status: res.status });
};

export default handler;
export const config: Config = { schedule: "*/30 * * * *" };
