import { PrismaPg } from "@prisma/adapter-pg";
import { DateTime } from "luxon";
import { PrismaClient, type MembershipRole } from "@/generated/prisma/client";
import type { TenantContext } from "@/lib/db/tenant-context";
import type { Actor } from "@/lib/audit";
import type { AuthUser } from "@/modules/access/authorize";

/**
 * Cliente con el rol DUEÑO: solo para preparar/limpiar datos de prueba.
 * Las pruebas ejercitan el código de la app, que usa el rol reservas_app (RLS).
 */
export const owner = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.MIGRATION_DATABASE_URL! }),
});

/** Cliente con el rol de la APP, para probar RLS con SQL directo. */
export const appRole = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

export const TZ = "America/Argentina/Buenos_Aires";
/** "Ahora" fijo para pruebas deterministas: lunes 4/3/2030 09:00 hora local. */
export const NOW = DateTime.fromISO("2030-03-04T09:00", { zone: TZ }).toJSDate();
export const DAY = "2030-03-05"; // martes

export function at(date: string, hhmm: string, tz = TZ): Date {
  return DateTime.fromISO(`${date}T${hhmm}`, { zone: tz }).toJSDate();
}

export async function resetDb() {
  await owner.$executeRawUnsafe(
    "TRUNCATE tenants, users, plans, rate_limits, audit_logs, verifications, notifications, job_runs RESTART IDENTITY CASCADE",
  );
}

let seq = 0;
export function key(prefix = "k"): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 10)}`.padEnd(16, "x");
}

export type Fixture = {
  tenant: { id: string; slug: string };
  court: { id: string };
  court2: { id: string };
  ctx: TenantContext;
};

/**
 * Complejo con dos canchas abiertas TODOS los días:
 *  - 08:00 a 12:00
 *  - 18:00 a 02:00 del día siguiente (cruza medianoche)
 * Paso de 30 min, duraciones 60/90/120, precios con franja nocturna.
 */
export async function makeTenant(slug: string, opts: { requiresApproval?: boolean } = {}): Promise<Fixture> {
  const tenant = await owner.tenant.create({
    data: {
      slug,
      name: `Complejo ${slug}`,
      timezone: TZ,
      bookingRequiresApproval: opts.requiresApproval ?? false,
      minLeadMinutes: 60,
      maxAdvanceDays: 30,
    },
    select: { id: true, slug: true },
  });
  const mkCourt = async (name: string) => {
    const court = await owner.court.create({
      data: { tenantId: tenant.id, name, sport: "PADEL", slotStepMinutes: 30, allowedDurations: [60, 90, 120] },
      select: { id: true },
    });
    const rules = [];
    for (let weekday = 1; weekday <= 7; weekday++) {
      rules.push({ tenantId: tenant.id, courtId: court.id, weekday, openMinute: 480, closeMinute: 720 });
      rules.push({ tenantId: tenant.id, courtId: court.id, weekday, openMinute: 1080, closeMinute: 1560 });
    }
    await owner.courtScheduleRule.createMany({ data: rules });
    await owner.courtPriceRule.createMany({
      data: [60, 90, 120].flatMap((d) => [
        { tenantId: tenant.id, courtId: court.id, durationMinutes: d, amount: d * 1000 },
        { tenantId: tenant.id, courtId: court.id, durationMinutes: d, startMinute: 1080, endMinute: 1560, amount: d * 1500 },
      ]),
    });
    return court;
  };
  const court = await mkCourt("Cancha 1");
  const court2 = await mkCourt("Cancha 2");
  return { tenant, court, court2, ctx: { tenantId: tenant.id, userId: null } };
}

export async function makeUser(
  email: string,
  opts: { platformRole?: "USER" | "SUPERADMIN"; tenantId?: string; role?: MembershipRole } = {},
): Promise<AuthUser> {
  const user = await owner.user.create({
    data: { email, name: email.split("@")[0]!, platformRole: opts.platformRole ?? "USER" },
    select: { id: true, name: true, email: true, platformRole: true },
  });
  if (opts.tenantId && opts.role) {
    await owner.membership.create({ data: { tenantId: opts.tenantId, userId: user.id, role: opts.role } });
  }
  return user;
}

export const publicActor: Actor = { type: "PUBLIC", userId: null };

export function onlineInput(courtId: string, startsAt: Date, durationMinutes = 90, n = 1) {
  return {
    courtId,
    startsAt,
    durationMinutes,
    customer: { name: `Jugador ${n}`, phone: `11 5555-${String(n).padStart(4, "0")}`, email: `jugador${n}@example.com` },
    idempotencyKey: key(`req${n}`),
    source: "ONLINE" as const,
  };
}
