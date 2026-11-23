/**
 * Seed de DESARROLLO. Corre con el rol dueño (MIGRATION_DATABASE_URL).
 * - Idempotente: si los datos ya existen, no los duplica.
 * - Sin contraseñas en el repositorio: se toman de SEED_SUPERADMIN_PASSWORD y
 *   SEED_OWNER_PASSWORD; si faltan, se generan al azar y se muestran UNA vez.
 * - Se niega a correr en producción.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient, type MembershipRole, type SportType } from "../src/generated/prisma/client";

if (process.env.NODE_ENV === "production") {
  console.error("El seed de desarrollo no se ejecuta en producción.");
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATION_DATABASE_URL! }) });

const generated: string[] = [];
function passwordFor(envVar: string, label: string) {
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.length >= 12) return fromEnv;
  const pw = randomBytes(12).toString("base64url");
  generated.push(`${label}: ${pw}`);
  return pw;
}

async function ensureUser(email: string, name: string, password: string, platformRole: "USER" | "SUPERADMIN" = "USER") {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { user: existing, created: false };
  const user = await db.user.create({ data: { email, name, platformRole, emailVerified: true } });
  await db.account.create({
    data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(password) },
  });
  return { user, created: true };
}

type CourtSpec = { name: string; sport: SportType; durations: number[]; open: number; close: number; prices: Record<number, [number, number]> };

async function ensureTenant(spec: {
  slug: string;
  name: string;
  description: string;
  address: string;
  approval: boolean;
  courts: CourtSpec[];
}) {
  const found = await db.tenant.findUnique({ where: { slug: spec.slug } });
  if (found) return found;
  const tenant = await db.tenant.create({
    data: {
      slug: spec.slug,
      name: spec.name,
      description: spec.description,
      address: spec.address,
      contactPhone: "+54 11 0000-0000",
      bookingRequiresApproval: spec.approval,
      minLeadMinutes: 30,
      maxAdvanceDays: 21,
    },
  });
  let order = 0;
  for (const c of spec.courts) {
    const court = await db.court.create({
      data: { tenantId: tenant.id, name: c.name, sport: c.sport, allowedDurations: c.durations, sortOrder: order++ },
    });
    await db.courtScheduleRule.createMany({
      data: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        tenantId: tenant.id,
        courtId: court.id,
        weekday,
        openMinute: c.open,
        closeMinute: c.close,
      })),
    });
    await db.courtPriceRule.createMany({
      data: c.durations.flatMap((d) => {
        const [day, night] = c.prices[d] ?? [d * 300_00 / 60, d * 400_00 / 60];
        return [
          { tenantId: tenant.id, courtId: court.id, durationMinutes: d, amount: day },
          { tenantId: tenant.id, courtId: court.id, durationMinutes: d, startMinute: 1080, endMinute: 2880, amount: night },
        ];
      }),
    });
  }
  return tenant;
}

async function main() {
  const plan = await db.plan.upsert({
    where: { code: "basico" },
    update: {},
    create: { code: "basico", name: "Básico", priceAmount: 25_000_00, maxCourts: 4 },
  });
  await db.plan.upsert({
    where: { code: "pro" },
    update: {},
    create: { code: "pro", name: "Pro", priceAmount: 45_000_00, maxCourts: null },
  });

  const padel = await ensureTenant({
    slug: "padel-centro",
    name: "Pádel Centro",
    description: "Tres canchas de pádel techadas en el centro.",
    address: "Av. Siempreviva 742",
    approval: false,
    courts: ["Cancha 1", "Cancha 2", "Cancha 3"].map((name) => ({
      name, sport: "PADEL" as const, durations: [60, 90, 120], open: 8 * 60, close: 24 * 60,
      prices: { 60: [18_000_00, 22_000_00], 90: [25_000_00, 30_000_00], 120: [32_000_00, 38_000_00] },
    })),
  });
  const futbol = await ensureTenant({
    slug: "futbol-norte",
    name: "Fútbol Norte",
    description: "Fútbol 5 y 7 con césped sintético. Abierto hasta las 2 AM.",
    address: "Ruta 8 km 40",
    approval: true,
    courts: [
      { name: "F5 — Cancha A", sport: "FOOTBALL_5", durations: [60, 90], open: 14 * 60, close: 26 * 60, prices: { 60: [40_000_00, 55_000_00], 90: [58_000_00, 78_000_00] } },
      { name: "F7 — Cancha B", sport: "FOOTBALL_7", durations: [60, 90, 120], open: 14 * 60, close: 26 * 60, prices: { 60: [60_000_00, 80_000_00], 90: [85_000_00, 110_000_00], 120: [110_000_00, 140_000_00] } },
    ],
  });
  await ensureTenant({
    slug: "complejo-deportivo-sur",
    name: "Complejo Deportivo Sur",
    description: "Fútbol y pádel en un mismo lugar.",
    address: "Calle Falsa 123",
    approval: true,
    courts: [
      { name: "Pádel 1", sport: "PADEL", durations: [60, 90], open: 9 * 60, close: 23 * 60, prices: { 60: [15_000_00, 19_000_00], 90: [21_000_00, 26_000_00] } },
      { name: "Fútbol 5", sport: "FOOTBALL_5", durations: [60], open: 16 * 60, close: 24 * 60, prices: { 60: [38_000_00, 50_000_00] } },
    ],
  });

  for (const t of [padel, futbol]) {
    const has = await db.subscription.findFirst({ where: { tenantId: t.id } });
    if (!has) {
      const start = new Date();
      await db.subscription.create({
        data: { tenantId: t.id, planId: plan.id, status: "TRIAL", currentPeriodStart: start, currentPeriodEnd: new Date(start.getTime() + 30 * 86_400_000) },
      });
    }
  }

  const ownerPw = passwordFor("SEED_OWNER_PASSWORD", "Contraseña de los dueños demo");
  await ensureUser("superadmin@example.com", "Superadmin", passwordFor("SEED_SUPERADMIN_PASSWORD", "Contraseña superadmin@example.com"), "SUPERADMIN");
  const memberships: [string, string, string, MembershipRole][] = [
    ["duenio@padel-centro.example.com", "Dueño Pádel Centro", padel.id, "OWNER"],
    ["duenio@futbol-norte.example.com", "Dueña Fútbol Norte", futbol.id, "OWNER"],
    ["staff@futbol-norte.example.com", "Encargado Fútbol Norte", futbol.id, "STAFF"],
  ];
  for (const [email, name, tenantId, role] of memberships) {
    const { user } = await ensureUser(email, name, ownerPw);
    await db.membership.upsert({
      where: { tenantId_userId: { tenantId, userId: user.id } },
      update: {},
      create: { tenantId, userId: user.id, role },
    });
  }

  console.log("Seed listo: padel-centro, futbol-norte, complejo-deportivo-sur.");
  console.log("Usuarios: superadmin@example.com, duenio@padel-centro.example.com, duenio@futbol-norte.example.com, staff@futbol-norte.example.com");
  if (generated.length) {
    console.log("\nContraseñas generadas (solo para usuarios NUEVOS creados ahora; guardalas, no se vuelven a mostrar):");
    for (const g of generated) console.log(`  ${g}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
