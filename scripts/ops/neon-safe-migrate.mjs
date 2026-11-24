#!/usr/bin/env node
/**
 * Migración SEGURA de producción en Neon (mecanismo local, sin credenciales en el chat ni en el repo).
 *
 *   node scripts/ops/neon-safe-migrate.mjs            # prueba en rama aislada + respaldo + aplica
 *   node scripts/ops/neon-safe-migrate.mjs --dry-run  # solo prueba en rama aislada (no toca producción)
 *
 * - La clave de la API de Neon se lee de .turnup-secrets/neon-api-key.txt (carpeta excluida de Git)
 *   o de NEON_API_KEY. Nunca se imprime. Las cadenas de conexión se piden a la API y solo viven en memoria.
 * - Pasos: 1) rama de prueba desde producción → 2) `prisma migrate deploy` → 3) verifica esquema (diff vacío),
 *   conteos de datos y RLS → 4) borra la rama de prueba → 5) crea rama de RESPALDO de producción →
 *   6) aplica en producción → 7) verifica igual que en la prueba. Ante cualquier error se detiene.
 * - Rollback: ver docs/ROLLBACK.md (restaurar producción desde la rama de respaldo).
 * Requiere conexión TCP al puerto 5432 de Neon y las dependencias del proyecto (prisma, pg).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

const PROJECT = process.env.NEON_PROJECT_ID ?? "round-haze-78677302";
const PROD_BRANCH = process.env.NEON_PROD_BRANCH ?? "br-twilight-pond-bdxq5izs";
const DB = process.env.NEON_DB ?? "turnup";
const DRY = process.argv.includes("--dry-run");
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

const keyFile = ".turnup-secrets/neon-api-key.txt";
const KEY = (process.env.NEON_API_KEY ?? (existsSync(keyFile) ? readFileSync(keyFile, "utf8") : "")).trim();
if (!KEY.startsWith("napi_")) throw new Error(`Falta la clave de Neon (${keyFile} o NEON_API_KEY).`);

async function api(method, path, body) {
  const res = await fetch(`https://console.neon.tech/api/v2${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Neon API ${method} ${path.split("?")[0]}: ${res.status} ${json.message ?? ""}`);
  return json;
}
const uri = async (branch, role) =>
  (await api("GET", `/projects/${PROJECT}/connection_uri?branch_id=${branch}&database_name=${DB}&role_name=${role}&pooled=false`)).uri;

function prisma(args, url) {
  return execFileSync("npx", ["prisma", ...args], { env: { ...process.env, MIGRATION_DATABASE_URL: url }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function q(url, sql) {
  const c = new pg.Client({ connectionString: url.replace("sslmode=require", "sslmode=verify-full") });
  await c.connect();
  try { return (await c.query(sql)).rows; } finally { await c.end(); }
}

const COUNTS = `select (select count(*) from tenants)::int tenants, (select count(*) from users)::int users,
  (select count(*) from bookings)::int bookings, (select count(*) from courts)::int courts, (select count(*) from customers)::int customers`;

async function verify(branch, label, before) {
  const owner = await uri(branch, "reservas_owner");
  const diff = prisma(["migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"], owner);
  if (!/No difference detected/.test(diff)) throw new Error(`${label}: el esquema no coincide con el código.`);
  const [counts] = await q(owner, COUNTS);
  if (before && JSON.stringify(counts) !== JSON.stringify(before)) throw new Error(`${label}: los conteos cambiaron ${JSON.stringify(before)} → ${JSON.stringify(counts)}`);
  const app = await uri(branch, "reservas_app");
  const [rls] = await q(app, `select (select rolbypassrls from pg_roles where rolname = current_user) bypass, (select count(*) from bookings)::int sin_contexto`);
  if (rls.bypass || rls.sin_contexto !== 0) throw new Error(`${label}: RLS no aísla al rol de la aplicación.`);
  console.log(`✓ ${label}: esquema = código, datos intactos ${JSON.stringify(counts)}, RLS activo para la app.`);
  return counts;
}

async function main() {
  const prodOwner = await uri(PROD_BRANCH, "reservas_owner");
  const before = (await q(prodOwner, COUNTS))[0];
  // `migrate status` sale con código 1 cuando hay migraciones pendientes: se lee la salida igual.
  const st = spawnSync("npx", ["prisma", "migrate", "status"], { env: { ...process.env, MIGRATION_DATABASE_URL: prodOwner }, encoding: "utf8" });
  const status = `${st.stdout}\n${st.stderr}`;
  const pending = [...status.matchAll(/^(\d{14}_\w+)$/gm)].map((m) => m[1]);
  console.log(`Producción: ${JSON.stringify(before)}. Migraciones pendientes: ${pending.length ? pending.join(", ") : "ninguna"}.`);
  if (!pending.length) return;

  // 1-4) Prueba en rama aislada (copia de producción; se borra al final).
  const test = await api("POST", `/projects/${PROJECT}/branches`, {
    branch: { parent_id: PROD_BRANCH, name: `prueba-migracion-${stamp}` },
    endpoints: [{ type: "read_write", autoscaling_limit_min_cu: 0.25, autoscaling_limit_max_cu: 0.5 }],
  });
  const testId = test.branch.id;
  try {
    await new Promise((r) => setTimeout(r, 5000));
    prisma(["migrate", "deploy"], await uri(testId, "reservas_owner"));
    await verify(testId, "Rama de prueba", before);
  } finally {
    await api("DELETE", `/projects/${PROJECT}/branches/${testId}`).catch((e) => console.error("No se pudo borrar la rama de prueba:", e.message));
  }
  if (DRY) return console.log("Simulación: producción no se modificó.");

  // 5) Respaldo instantáneo de producción (rama). 6-7) Aplicar y verificar.
  const backup = await api("POST", `/projects/${PROJECT}/branches`, { branch: { parent_id: PROD_BRANCH, name: `backup-antes-de-migrar-${stamp}` } });
  console.log(`✓ Respaldo: rama ${backup.branch.name} (${backup.branch.id}).`);
  prisma(["migrate", "deploy"], prodOwner);
  await verify(PROD_BRANCH, "Producción", before);
  console.log("Listo. Si hiciera falta volver atrás: docs/ROLLBACK.md");
}

main().catch((e) => {
  console.error("✗", e.message.replace(/postgres(ql)?:\/\/[^\s]+/g, "[conexión oculta]"));
  process.exit(1);
});
