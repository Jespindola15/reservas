import { execSync } from "node:child_process";
import { config } from "dotenv";

/** Aplica las migraciones reales a la base de test antes de correr la suite. */
export default function setup() {
  const env = config({ path: ".env.test", override: false, quiet: true }).parsed ?? {};
  if (!env.MIGRATION_DATABASE_URL?.includes("reservas_test")) {
    throw new Error("MIGRATION_DATABASE_URL de test debe apuntar a reservas_test");
  }
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, MIGRATION_DATABASE_URL: env.MIGRATION_DATABASE_URL },
  });
}
