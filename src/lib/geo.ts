/** Utilidades de ubicación (sin servicios pagos). */

export const AR_PROVINCES = [
  "Buenos Aires", "Ciudad Autónoma de Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes",
  "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones", "Neuquén", "Río Negro",
  "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán",
] as const;

/** Distancia en km entre dos puntos (fórmula de haversine). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : km < 10 ? `${km.toFixed(1).replace(".", ",")} km` : `${Math.round(km)} km`;
}

/**
 * Enlace "Cómo llegar" (abre Google Maps o la app de mapas del teléfono; es un enlace, no una API).
 * Con coordenadas va al punto exacto; si no, busca la dirección.
 */
export function directionsUrl(t: { latitude: number | null; longitude: number | null; address: string | null; city?: string | null; province?: string | null }): string | null {
  if (t.latitude !== null && t.longitude !== null) return `https://www.google.com/maps/dir/?api=1&destination=${t.latitude},${t.longitude}`;
  const q = [t.address, t.city, t.province].filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

/** Teselas de mapa: OpenStreetMap por defecto (configurable para cambiar de proveedor sin tocar código). */
export const MAP_TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
