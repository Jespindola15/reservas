import { defineConfig, devices } from "@playwright/test";

/**
 * E2E contra el BUILD DE PRODUCCIÓN (`next start`) y una base dedicada
 * (reservas_e2e) que se reinicia y siembra en global-setup.
 * Requiere `npm run build` previo (el script test:e2e lo hace).
 */
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export const E2E_ENV = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://reservas_app:dev_app_pw@localhost:5432/reservas_e2e",
  MIGRATION_DATABASE_URL: "postgresql://reservas_owner:dev_owner_pw@localhost:5432/reservas_e2e",
  BETTER_AUTH_URL: BASE_URL,
  BETTER_AUTH_SECRET: "e2e-local-secret-not-for-real-use-0123456789",
  ALLOW_INSECURE_LOCALHOST: "true",
  TRUST_PROXY_HOPS: "0",
  // Simula un proxy confiable: cada prueba envía su propia IP en x-real-ip,
  // así el rate limiting de login es por IP (como en producción) y no un cupo global.
  AUTH_CLIENT_IP_HEADER: "x-real-ip",
  CRON_SECRET: "e2e-cron-secret-0123456789abcdef0123456789",
  SEED_SUPERADMIN_PASSWORD: "e2e-superadmin-pass-123",
  SEED_OWNER_PASSWORD: "e2e-owner-pass-1234",
  // Las pruebas locales no tienen Supabase Storage: se permite guardar imágenes en la base solo acá.
  ALLOW_DB_IMAGES: "true",
  // Los emails se "envían" al registro del servidor (nunca salen a internet): prueba la cola completa.
  EMAIL_PROVIDER: "log",
};

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: BASE_URL, trace: "retain-on-failure", locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: E2E_ENV,
  },
});
