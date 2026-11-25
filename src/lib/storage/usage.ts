import { getEnv } from "@/lib/env";
import type { Tx } from "@/lib/db/tenant-context";
import { getObjectStore } from "./images";

/**
 * Consumo del almacenamiento de imágenes, calculado desde PostgreSQL (tamaño guardado de cada imagen),
 * sin llamadas pagas ni constantes al proveedor. La transferencia (egress) la mide el proveedor: con
 * caché de un año y carga diferida, cada visitante descarga cada imagen una sola vez.
 */
export async function imageStorageUsage(tx: Tx) {
  const [a, c] = await Promise.all([
    tx.tenantAsset.aggregate({ where: { storage: "OBJECT" }, _sum: { sizeBytes: true }, _count: { _all: true } }),
    tx.courtImage.aggregate({ where: { storage: "OBJECT" }, _sum: { sizeBytes: true }, _count: { _all: true } }),
  ]);
  const bytes = (a._sum.sizeBytes ?? 0) + (c._sum.sizeBytes ?? 0);
  const quotaBytes = getEnv().IMAGE_STORAGE_QUOTA_MB * 1024 * 1024;
  const pct = Math.round((bytes / quotaBytes) * 100);
  return { bytes, count: a._count._all + c._count._all, quotaBytes, pct, level: pct >= 90 ? ("critical" as const) : pct >= 70 ? ("warn" as const) : ("ok" as const) };
}

/** ¿El almacenamiento responde? Un proyecto gratuito de Supabase se pausa tras una semana sin actividad. */
export async function imageStorageReachable(): Promise<boolean | null> {
  const store = getObjectStore();
  if (!store?.ping) return null;
  return store.ping();
}
