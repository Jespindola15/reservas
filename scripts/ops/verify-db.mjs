// Ejecuta db/verify.sql sin necesitar psql (usa el driver pg del proyecto). Solo lectura.
// Uso: MIGRATION_DATABASE_URL=... node scripts/ops/verify-db.mjs
import { readFile } from "node:fs/promises";
import pg from "pg";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("Definí MIGRATION_DATABASE_URL");
const sql = await readFile(new URL("../../db/verify.sql", import.meta.url), "utf8");
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query(sql);
  let bad = 0;
  for (const r of rows) {
    if (!r.ok) bad++;
    console.log(`${r.ok ? "OK   " : "FALLA"}  ${r.check_name}${r.detail ? `  (${r.detail})` : ""}`);
  }
  if (bad) {
    console.error(`\n${bad} verificación(es) fallaron. No habilites el sitio hasta corregirlas.`);
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
