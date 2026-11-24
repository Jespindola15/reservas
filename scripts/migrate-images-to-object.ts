/**
 * Migra imágenes de canchas guardadas en PostgreSQL a almacenamiento S3/R2.
 *
 *   npm run images:migrate                 -> SIMULACIÓN (por defecto): solo cuenta y lista, no escribe nada.
 *   npm run images:migrate -- --execute    -> sube cada imagen, verifica la copia y marca storage=OBJECT.
 *
 * Garantías:
 *  - NUNCA borra los bytes de la base: la columna `data` queda como respaldo. Liberar ese espacio
 *    es un paso aparte, manual, después de un backup verificado (ver docs/INFRAESTRUCTURA.md).
 *  - Verifica cada objeto (descarga y compara SHA-256) antes de actualizar la fila.
 *  - Idempotente: las filas ya migradas se saltean; se puede cortar y reanudar.
 *  - Requiere IMAGE_STORAGE=object y las variables S3_*. No correr contra producción sin autorización.
 */
import "dotenv/config";
import { createHash } from "node:crypto";

async function main() {
  const execute = process.argv.includes("--execute");
  const { prisma } = await import("../src/lib/db/prisma");
  const { withSystem } = await import("../src/lib/db/tenant-context");
  const { getObjectStore } = await import("../src/lib/storage/images");
  const store = getObjectStore();
  if (execute && !store) throw new Error("Falta configurar IMAGE_STORAGE=object y S3_* para --execute");
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  try {
    const pending = await withSystem((tx) =>
      tx.courtImage.findMany({ where: { storage: "DATABASE" }, select: { id: true, tenantId: true, courtId: true, contentType: true, sizeBytes: true }, orderBy: { createdAt: "asc" } }),
    );
    const total = pending.reduce((a, r) => a + r.sizeBytes, 0);
    console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", images: pending.length, bytes: total }));
    if (!execute) return;
    let done = 0;
    for (const row of pending) {
      const img = await withSystem((tx) => tx.courtImage.findUnique({ where: { id: row.id }, select: { data: true, storage: true } }));
      if (!img || img.storage !== "DATABASE" || !img.data) continue;
      const bytes = new Uint8Array(img.data);
      const key = `tenants/${row.tenantId}/courts/${row.courtId}/${row.id}.${row.contentType === "image/webp" ? "webp" : row.contentType === "image/png" ? "png" : "jpg"}`;
      await store!.put(key, bytes, row.contentType);
      const back = await store!.get(key);
      if (!back || sha(back.data) !== sha(bytes)) throw new Error(`Verificación fallida para la imagen ${row.id}; no se modificó la fila`);
      await withSystem((tx) => tx.courtImage.updateMany({ where: { id: row.id, storage: "DATABASE" }, data: { storage: "OBJECT", objectKey: key } }));
      done++;
    }
    console.log(JSON.stringify({ migrated: done, note: "Los bytes siguen en la base como respaldo." }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
