import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// El CLI de Prisma (migraciones, seed) se conecta con el rol DUEÑO de la base
// (MIGRATION_DATABASE_URL). La aplicación en runtime usa DATABASE_URL, un rol
// sin privilegios sujeto a Row Level Security. Nunca intercambiarlas.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("MIGRATION_DATABASE_URL"),
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
