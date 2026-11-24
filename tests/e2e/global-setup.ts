import { execSync } from "node:child_process";
import { Client } from "pg";
import { E2E_ENV } from "../../playwright.config";

/**
 * Base E2E limpia SIN borrar el esquema: aplica migraciones pendientes y vacía
 * los datos. Salvaguarda: solo opera sobre una base cuyo nombre termina en _e2e.
 */
export default async function globalSetup() {
  const url = new URL(E2E_ENV.MIGRATION_DATABASE_URL);
  if (!url.pathname.endsWith("_e2e")) throw new Error("La limpieza E2E solo se permite en bases *_e2e");

  const env = { ...process.env, ...E2E_ENV, NODE_ENV: "development" } as NodeJS.ProcessEnv;
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });

  const db = new Client({ connectionString: E2E_ENV.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await db.query("TRUNCATE tenants, users, plans, rate_limits, audit_logs, verifications, notifications, job_runs, two_factors RESTART IDENTITY CASCADE");
  } finally {
    await db.end();
  }
  execSync("npx prisma db seed", { env, stdio: "pipe" });
}
