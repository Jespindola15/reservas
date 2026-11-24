import { unstable_cache } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/dal";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { enforceRateLimit, jsonError, jsonOk } from "@/lib/http";
import { listMyTenants } from "@/modules/access/authorize";

/**
 * Búsqueda de una dirección (geocodificación) con Nominatim de OpenStreetMap, gratuito y
 * respetando su política de uso: solo a pedido explícito (botón, nunca autocompletado),
 * máximo 1 consulta por segundo para TODA la plataforma, identificación de la aplicación y
 * resultados en caché 30 días. Solo para personas que administran un complejo.
 */
const query = z.string().trim().min(4).max(200);

async function nominatim(q: string) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=ar&accept-language=es&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": `TURNUP/1.0 (+${getEnv().BETTER_AUTH_URL})`, Referer: getEnv().BETTER_AUTH_URL },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new AppError("INTERNAL", { upstream: res.status });
  const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  return rows.slice(0, 5).map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), label: r.display_name.slice(0, 200) }));
}

const cached = (q: string) => unstable_cache(() => nominatim(q), ["geocode", q.toLowerCase()], { revalidate: 30 * 86_400 })();

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AppError("UNAUTHENTICATED");
    const tenants = await listMyTenants(user.id);
    if (!tenants.length && user.platformRole !== "SUPERADMIN") throw new AppError("FORBIDDEN");
    const q = query.safeParse(new URL(req.url).searchParams.get("q") ?? "");
    if (!q.success) throw new AppError("VALIDATION_ERROR");
    await enforceRateLimit(`geocode:user:${user.id}`, { window: 60, max: 10 });
    await enforceRateLimit("geocode:global", { window: 1, max: 1 });
    return jsonOk({ results: await cached(q.data), attribution: "Datos © OpenStreetMap (ODbL), búsqueda con Nominatim" });
  } catch (e) {
    return jsonError(e, { route: "panel.geocode" });
  }
}
