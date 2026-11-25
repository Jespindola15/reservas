/**
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
import "dotenv/config";

async function main() {
  const { prisma } = await import("../src/lib/db/prisma");
  const { migrateImages } = await import("../src/lib/storage/migrate");
  try {
    const r = await migrateImages({ execute: process.argv.includes("--execute"), freeDb: process.argv.includes("--free-db") });
    if (r.failed.length) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
