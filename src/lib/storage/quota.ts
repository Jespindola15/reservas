import type { Tx } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";

/**
 * Cupo de imágenes por complejo (todas: logo, portada, galería y canchas). Con imágenes de
 * ~100–200 KB, 25 MB y 60 imágenes alcanzan de sobra para un complejo y permiten que el plan
 * gratuito de almacenamiento (1 GB) aloje decenas de complejos.
 */
export const TENANT_IMAGE_MAX_COUNT = 60;
export const TENANT_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

export async function tenantImageUsage(tx: Tx, tenantId: string) {
  const [a, c] = await Promise.all([
    tx.tenantAsset.aggregate({ where: { tenantId }, _count: { _all: true }, _sum: { sizeBytes: true } }),
    tx.courtImage.aggregate({ where: { tenantId }, _count: { _all: true }, _sum: { sizeBytes: true } }),
  ]);
  return { count: a._count._all + c._count._all, bytes: (a._sum.sizeBytes ?? 0) + (c._sum.sizeBytes ?? 0) };
}

/** Se valida en el servidor ANTES de subir al proveedor. `replacingBytes`: lo que se libera al reemplazar. */
export async function assertTenantImageQuota(tx: Tx, tenantId: string, addBytes: number, replacing: { count: number; bytes: number } = { count: 0, bytes: 0 }) {
  const u = await tenantImageUsage(tx, tenantId);
  if (u.count - replacing.count + 1 > TENANT_IMAGE_MAX_COUNT) throw new AppError("LIMIT_REACHED", { resource: "images", max: TENANT_IMAGE_MAX_COUNT });
  if (u.bytes - replacing.bytes + addBytes > TENANT_IMAGE_MAX_BYTES) throw new AppError("LIMIT_REACHED", { resource: "image_bytes", maxMb: TENANT_IMAGE_MAX_BYTES / 1024 / 1024 });
}
