import { unstable_cache } from "next/cache";
import { logger } from "@/lib/logger";
import { loadAnnouncements, loadCatalog, type Announcement, type CatalogEntry } from "./catalog";

/**
 * Catálogo y novedades en caché 5 minutos (se invalidan con el tag "public-directory" cuando
 * un complejo cambia su página). Solo datos públicos, iguales para todos: no hay riesgo de
 * mezclar información privada entre visitantes.
 */
const catalog = unstable_cache(() => loadCatalog(300), ["marketplace-catalog"], { revalidate: 300, tags: ["public-directory"] });
const news = unstable_cache(() => loadAnnouncements(10), ["marketplace-news"], { revalidate: 300, tags: ["public-directory"] });

export async function cachedCatalog(): Promise<CatalogEntry[]> {
  try {
    return await catalog();
  } catch (e) {
    logger.warn("marketplace.catalog.unavailable", { err: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

export async function cachedAnnouncements(): Promise<Announcement[]> {
  try {
    return await news();
  } catch (e) {
    logger.warn("marketplace.news.unavailable", { err: e instanceof Error ? e.message : String(e) });
    return [];
  }
}
