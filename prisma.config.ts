import "dotenv/config";
import { defineConfig } from "prisma/config";

// El CLI de Prisma (migraciones, seed) se conecta con el rol DUEÑO de la base
// (MIGRATION_DATABASE_URL). La aplicación en runtime usa DATABASE_URL, un rol
// sin privilegios sujeto a Row Level Security. Nunca intercambiarlas.
//
// La URL NO se exige acá: `prisma generate` (postinstall) no se conecta a la base
// y debe funcionar en entornos de build sin secretos (Netlify, CI). Los comandos
// que sí se conectan (migrate, db seed) fallan con un error claro si falta.
const migrationUrl = process.env.MIGRATION_DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  ...(migrationUrl
    ? { datasource: { url: migrationUrl, shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL } }
    : {}),
});
