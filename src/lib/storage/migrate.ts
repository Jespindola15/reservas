import { createHash } from "node:crypto";
import { withSystem } from "@/lib/db/tenant-context";
import { getObjectStore } from "@/lib/storage/images";

/**
 * (Lógica del script scripts/migrate-images-to-object.ts; acá para poder probarla.)
 * Migra imágenes de COMPLEJOS (logo, portada, galería) y de CANCHAS guardadas en PostgreSQL al
 * almacenamiento de objetos (Supabase Storage u otro compatible con S3).
 *
 *   npm run images:migrate                      -> SIMULACIÓN: cuenta, mide y lista; no escribe nada.
 *   npm run images:migrate -- --execute         -> sube cada imagen, la descarga y compara SHA-256,
 *                                                  y recién entonces marca la fila storage=OBJECT.
 *   npm run images:migrate -- --free-db         -> SOLO para filas ya en OBJECT: vuelve a verificar que
 *                                                  el objeto exista y coincida con los bytes, y entonces
 *                                                  vacía la columna `data` (libera espacio en la base).
 *
 * Garantías:
 *  - --execute NUNCA borra bytes de la base (quedan como respaldo hasta --free-db).
 *  - --free-db no borra nada si el objeto falta o no coincide (lo informa y sigue).
 *  - Idempotente y reanudable. Separación por complejo: tenants/<tenantId>/...
 *  - Requiere IMAGE_STORAGE=object y S3_* (credenciales solo en el servidor / .env local, nunca en el repo).
 *  - Antes de --free-db en producción: respaldo verificado (docs/RESPALDOS.md). Nunca sin autorización.
 *  - Fotos de jugadores: ya no existen (Fase 5); no se migran.
 */
type Row = { id: string; tenantId: string; contentType: string; sizeBytes: number; objectKey: string | null; key: string };

const ext = (ct: string) => (ct === "image/webp" ? "webp" : ct === "image/png" ? "png" : "jpg");

export async function migrateImages(opts: { execute: boolean; freeDb: boolean; log?: (line: string) => void }) {
  const { execute, freeDb } = opts;
  const log = opts.log ?? ((l: string) => console.log(l));
  const store = getObjectStore();
  if ((execute || freeDb) && !store) throw new Error("Falta configurar IMAGE_STORAGE=object y S3_* para --execute / --free-db");
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  try {
    const sizes = await withSystem((tx) =>
      tx.$queryRaw<{ table: string; bytes: bigint }[]>`SELECT relname::text AS table, pg_total_relation_size(c.oid) AS bytes FROM pg_class c WHERE relname IN ('tenant_assets', 'court_images')`,
    );
    const report = Object.fromEntries(sizes.map((s) => [s.table, Number(s.bytes)]));

    const assets: Row[] = (await withSystem((tx) => tx.tenantAsset.findMany({ where: { storage: freeDb ? "OBJECT" : "DATABASE", ...(freeDb ? { data: { not: null } } : {}) }, select: { id: true, tenantId: true, kind: true, contentType: true, sizeBytes: true, objectKey: true }, orderBy: { createdAt: "asc" } })))
      .map((r) => ({ ...r, key: r.objectKey ?? `tenants/${r.tenantId}/brand/${r.kind.toLowerCase()}/${r.id}.${ext(r.contentType)}` }));
    const courts: Row[] = (await withSystem((tx) => tx.courtImage.findMany({ where: { storage: freeDb ? "OBJECT" : "DATABASE", ...(freeDb ? { data: { not: null } } : {}) }, select: { id: true, tenantId: true, courtId: true, contentType: true, sizeBytes: true, objectKey: true }, orderBy: { createdAt: "asc" } })))
      .map((r) => ({ ...r, key: r.objectKey ?? `tenants/${r.tenantId}/courts/${r.courtId}/${r.id}.${ext(r.contentType)}` }));

    log(JSON.stringify({
      mode: freeDb ? "free-db" : execute ? "execute" : "dry-run",
      tenantAssets: assets.length, courtImages: courts.length,
      bytes: [...assets, ...courts].reduce((a, r) => a + r.sizeBytes, 0),
      tableSizes: report,
    }));
    if (!execute && !freeDb) return { processed: 0, failed: [] as string[] };

    let ok = 0;
    const failed: string[] = [];
    for (const [table, rows] of [["tenant_assets", assets], ["court_images", courts]] as const) {
      for (const row of rows) {
        const img = table === "tenant_assets"
          ? await withSystem((tx) => tx.tenantAsset.findUnique({ where: { id: row.id }, select: { data: true } }))
          : await withSystem((tx) => tx.courtImage.findUnique({ where: { id: row.id }, select: { data: true } }));
        if (!img?.data) continue;
        const bytes = new Uint8Array(img.data);
        if (!freeDb) await store!.put(row.key, bytes, row.contentType);
        const back = await store!.get(row.key);
        if (!back || sha(back.data) !== sha(bytes)) {
          failed.push(row.id);
          continue; // no se toca la fila
        }
        const data = freeDb ? { data: null } : { storage: "OBJECT" as const, objectKey: row.key };
        const where = freeDb ? { id: row.id, storage: "OBJECT" as const, objectKey: row.key } : { id: row.id, storage: "DATABASE" as const };
        if (table === "tenant_assets") await withSystem((tx) => tx.tenantAsset.updateMany({ where, data }));
        else await withSystem((tx) => tx.courtImage.updateMany({ where, data }));
        ok++;
      }
    }
    log(JSON.stringify({
      processed: ok, failed,
      note: freeDb
        ? "Bytes vaciados en la base. PostgreSQL reutiliza ese espacio tras el autovacuum; para devolverlo al almacenamiento de Neon hace falta VACUUM FULL (bloquea la tabla unos segundos), ver docs/IMAGENES.md."
        : "Copiadas y verificadas. Los bytes siguen en la base como respaldo hasta correr --free-db.",
    }));
    return { processed: ok, failed };
  } finally {
    // la conexión la cierra quien llama
  }
}

