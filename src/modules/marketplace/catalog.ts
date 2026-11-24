import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getDayAvailability } from "@/modules/booking/availability";

/**
 * Catálogo público del marketplace. La consulta a la base es UNA función SECURITY DEFINER
 * que devuelve solo datos públicos de complejos activos y publicados; el filtrado se hace
 * en memoria (decenas/cientos de complejos), así la página puede cachear el resultado.
 */

export type CatalogEntry = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  address: string | null;
  sports: string[];
  courtCount: number;
  logoAssetId: string | null;
  coverAssetId: string | null;
  minHourPrice: number | null;
  currency: string;
  services: string[];
  ratingAvg: number | null;
  ratingCount: number;
  hasCovered: boolean;
  requiresDeposit: boolean;
};

export async function loadCatalog(limit = 300): Promise<CatalogEntry[]> {
  const rows = await prisma.$queryRaw<
    {
      id: string; slug: string; name: string; city: string | null; address: string | null; sports: string[]; court_count: number;
      logo_asset_id: string | null; cover_asset_id: string | null; min_hour_price: number | null; currency: string; services: string[];
      rating_avg: string | number | null; rating_count: number; has_covered: boolean; deposit_type: string;
    }[]
  >`SELECT * FROM app_public_catalog(${limit}::integer)`;
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    city: r.city,
    address: r.address,
    sports: r.sports,
    courtCount: r.court_count,
    logoAssetId: r.logo_asset_id,
    coverAssetId: r.cover_asset_id,
    minHourPrice: r.min_hour_price,
    currency: r.currency.trim(),
    services: r.services,
    ratingAvg: r.rating_avg === null ? null : Number(r.rating_avg),
    ratingCount: r.rating_count,
    hasCovered: r.has_covered,
    requiresDeposit: r.deposit_type !== "NONE",
  }));
}

export const SPORT_GROUPS: Record<string, string[]> = {
  futbol: ["FOOTBALL_5", "FOOTBALL_7", "FOOTBALL_8", "FOOTBALL_11"],
  padel: ["PADEL"],
  otros: ["OTHER"],
};
export const SPORT_GROUP_LABEL: Record<string, string> = { futbol: "Fútbol", padel: "Pádel", otros: "Otros" };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export const catalogFilterSchema = z.object({
  q: z.string().trim().max(80).optional().catch(undefined),
  ciudad: z.string().trim().max(80).optional().catch(undefined),
  deporte: z.enum(["futbol", "padel", "otros"]).optional().catch(undefined),
  precioMax: z.coerce.number().int().min(1).max(10_000_000).optional().catch(undefined),
  servicio: z.array(z.string().max(60)).max(12).optional().catch(undefined),
  techada: z.enum(["1"]).optional().catch(undefined),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  orden: z.enum(["nombre", "precio", "valoracion"]).optional().catch(undefined),
});
export type CatalogFilter = z.infer<typeof catalogFilterSchema>;

export function filterCatalog(all: CatalogEntry[], f: CatalogFilter): CatalogEntry[] {
  const q = f.q ? fold(f.q) : "";
  const city = f.ciudad ? fold(f.ciudad) : "";
  let out = all.filter((c) => {
    if (q && !fold(`${c.name} ${c.city ?? ""} ${c.address ?? ""}`).includes(q)) return false;
    if (city && !fold(`${c.city ?? ""} ${c.address ?? ""}`).includes(city)) return false;
    if (f.deporte && !c.sports.some((s) => SPORT_GROUPS[f.deporte!]!.includes(s))) return false;
    // precioMax en pesos por hora; los precios se guardan en centavos.
    if (f.precioMax && (c.minHourPrice === null || c.minHourPrice > f.precioMax * 100)) return false;
    if (f.servicio?.length && !f.servicio.every((s) => c.services.includes(s))) return false;
    if (f.techada && !c.hasCovered) return false;
    return true;
  });
  if (f.orden === "precio") out = [...out].sort((a, b) => (a.minHourPrice ?? Infinity) - (b.minHourPrice ?? Infinity));
  else if (f.orden === "valoracion") out = [...out].sort((a, b) => (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0) || b.ratingCount - a.ratingCount);
  return out;
}

/** Ciudades presentes en el catálogo (para el selector). */
export function catalogCities(all: CatalogEntry[]): string[] {
  return [...new Set(all.map((c) => c.city).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b, "es"));
}

/**
 * Disponibilidad para una fecha: cuenta turnos libres de 60/90 min por complejo usando la
 * MISMA lógica que la reserva. Se limita a los primeros `max` resultados para no cargar la base.
 */
export async function availabilityForDate(entries: CatalogEntry[], date: string, max = 24, now: Date = new Date()) {
  const result = new Map<string, number>();
  for (const e of entries.slice(0, max)) {
    let free = 0;
    for (const durationMinutes of [60, 90]) {
      try {
        const day = await getDayAvailability({ tenantId: e.id, userId: null }, { operatingDate: date, durationMinutes }, { now });
        free += day.courts.reduce((acc, c) => acc + c.slots.filter((s) => s.available).length, 0);
      } catch {
        // fecha fuera de rango o complejo sin esa duración: no suma
      }
    }
    result.set(e.id, free);
  }
  return result;
}

export type Announcement = { slug: string; name: string; city: string | null; text: string; until: Date | null; logoAssetId: string | null };

export async function loadAnnouncements(limit = 10): Promise<Announcement[]> {
  const rows = await prisma.$queryRaw<{ slug: string; name: string; city: string | null; announcement: string; announcement_until: Date | null; logo_asset_id: string | null }[]>`
    SELECT * FROM app_public_announcements(${limit}::integer)`;
  return rows.map((r) => ({ slug: r.slug, name: r.name, city: r.city, text: r.announcement, until: r.announcement_until, logoAssetId: r.logo_asset_id }));
}
