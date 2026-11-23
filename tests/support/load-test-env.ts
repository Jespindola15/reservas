import { config } from "dotenv";

// Fuerza la base de TEST antes de importar cualquier módulo de la app.
config({ path: ".env.test", override: true, quiet: true });

if (!process.env.DATABASE_URL?.includes("reservas_test")) {
  throw new Error("Las pruebas de integración deben apuntar a la base reservas_test");
}
