/**
 * Complejo de DEMOSTRACIÓN para un entorno SEPARADO de producción (p. ej. una rama
 * "demo" de Neon + un deploy de rama de Netlify). Datos claramente ficticios.
 *
 *   TURNUP_DEMO_ENV=1 MIGRATION_DATABASE_URL=... DATABASE_URL=... npm run demo:seed
 *
 * Barreras (cualquiera aborta sin escribir nada):
 *  - Requiere TURNUP_DEMO_ENV=1.
 *  - Si la base tiene algún complejo cuyo slug no empiece con "demo-", o algún usuario cuyo
 *    email no sea @example.com, NO es una base de demo (p. ej. producción): se niega.
 * Idempotente: si "demo-turnup" ya existe, no hace nada. Las reservas se crean con la misma
 * lógica de la app (createBooking), así respetan precios, horarios y antisolapamiento.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient } from "../../src/generated/prisma/client";
import { recordPayment } from "../../src/modules/booking/payments";
import { changeBookingStatus, createBooking } from "../../src/modules/booking/service";

const SLUG = "demo-turnup";
const TZ = "America/Argentina/Buenos_Aires";

async function main() {
  if (process.env.TURNUP_DEMO_ENV !== "1") throw new Error("Definí TURNUP_DEMO_ENV=1: este script solo corre en el entorno de demostración.");
  const owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATION_DATABASE_URL! }) });
  try {
    const foreignTenants = await owner.tenant.count({ where: { NOT: { slug: { startsWith: "demo-" } } } });
    const foreignUsers = await owner.user.count({ where: { NOT: { email: { endsWith: "@example.com" } } } });
    if (foreignTenants > 0 || foreignUsers > 0) {
      throw new Error("Esta base tiene datos que no son de demostración (¿producción?). No se escribe nada.");
    }
    if (await owner.tenant.findUnique({ where: { slug: SLUG } })) {
      console.log("El complejo demo ya existe: nada que hacer.");
      return;
    }

    const tenant = await owner.tenant.create({
      data: {
        slug: SLUG,
        name: "Club Demo TURNUP (ficticio)",
        description: "Complejo de DEMOSTRACIÓN con datos ficticios. Las reservas acá no son reales.",
        address: "Calle Ficticia 123, Ciudad Demo",
        contactPhone: "+54 11 0000-0000",
        timezone: TZ,
        whatsapp: "+54 11 0000-0000",
        services: ["Vestuarios", "Estacionamiento", "Buffet / bar"],
        cancellationPolicy: "Ejemplo: cancelá sin cargo hasta 2 horas antes.",
        maxAdvanceDays: 30,
        minLeadMinutes: 0,
        publicListed: true,
        onboardingStep: 7,
        onboardingCompletedAt: new Date(),
      },
    });
    const courts = [];
    for (const [i, c] of [
      { name: "Pádel 1 (demo)", sport: "PADEL" as const, durations: [60, 90], day: 18_000_00, night: 22_000_00 },
      { name: "Pádel 2 (demo)", sport: "PADEL" as const, durations: [60, 90], day: 18_000_00, night: 22_000_00 },
      { name: "Fútbol 5 (demo)", sport: "FOOTBALL_5" as const, durations: [60], day: 40_000_00, night: 52_000_00 },
    ].entries()) {
      const court = await owner.court.create({ data: { tenantId: tenant.id, name: c.name, sport: c.sport, allowedDurations: c.durations, sortOrder: i } });
      await owner.courtScheduleRule.createMany({ data: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ tenantId: tenant.id, courtId: court.id, weekday, openMinute: 9 * 60, closeMinute: 24 * 60 })) });
      await owner.courtPriceRule.createMany({
        data: c.durations.flatMap((d) => [
          { tenantId: tenant.id, courtId: court.id, durationMinutes: d, amount: Math.round((c.day * d) / 60) },
          { tenantId: tenant.id, courtId: court.id, durationMinutes: d, startMinute: 18 * 60, endMinute: 24 * 60, amount: Math.round((c.night * d) / 60) },
        ]),
      });
      courts.push(court);
    }
    const pw = randomBytes(12).toString("base64url");
    const user = await owner.user.create({ data: { email: "demo@example.com", name: "Dueño Demo", emailVerified: true } });
    await owner.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(pw) } });
    await owner.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: "OWNER" } });

    // Reservas de las últimas 3 semanas y las próximas 2, con la lógica real de la app.
    const ctx = { tenantId: tenant.id, userId: user.id };
    const actor = { type: "USER" as const, userId: user.id };
    const now = new Date();
    let n = 0;
    let created = 0;
    for (let dayOffset = -21; dayOffset <= 14; dayOffset++) {
      for (const [ci, court] of courts.entries()) {
        for (const hour of [10, 18, 19, 20, 21, 22]) {
          n++;
          // Patrón determinista: ~45 % de ocupación, más de noche.
          if ((n * 7 + ci * 3 + dayOffset * 5) % 11 > (hour >= 18 ? 5 : 2)) continue;
          const local = new Date(now.getTime() + dayOffset * 86_400_000);
          const ymd = local.toLocaleDateString("en-CA", { timeZone: TZ });
          const startsAt = new Date(`${ymd}T${String(hour).padStart(2, "0")}:00:00-03:00`);
          const c = (n % 25) + 1;
          const bookedAt = new Date(startsAt.getTime() - 2 * 86_400_000);
          try {
            const { booking } = await createBooking(
              ctx,
              {
                courtId: court.id,
                startsAt,
                durationMinutes: 60,
                customer: { name: `Jugador Demo ${String(c).padStart(2, "0")}`, phone: `11 0000-${String(c).padStart(4, "0")}`, email: `jugador${c}@example.com` },
                idempotencyKey: `demo-${n}`,
                source: "MANUAL",
              },
              actor,
              { now: bookedAt },
            );
            created++;
            if (startsAt < now) {
              const to = n % 13 === 0 ? "NO_SHOW" : n % 9 === 0 ? "CANCELLED" : "COMPLETED";
              await changeBookingStatus(ctx, { bookingId: booking.id, to, expectedVersion: booking.version, reason: to === "CANCELLED" ? "Ejemplo de cancelación" : null }, actor, { now: new Date(startsAt.getTime() + 3_600_000) });
              if (to === "COMPLETED") await recordPayment(ctx, { bookingId: booking.id, kind: "PAYMENT", method: n % 2 ? "CASH" : "TRANSFER", amount: String((booking.priceAmount ?? 0) / 100) }, actor);
            } else if (n % 3 === 0) {
              await recordPayment(ctx, { bookingId: booking.id, kind: "DEPOSIT", method: "TRANSFER", amount: "5000" }, actor);
            }
          } catch {
            // Horario no disponible en el patrón: se saltea.
          }
        }
      }
    }
    // Los pagos ficticios se fechan el día del turno (para que las estadísticas se vean realistas).
    await owner.$executeRaw`UPDATE booking_payments p SET paid_at = b.starts_at FROM bookings b
      WHERE p.tenant_id = ${tenant.id}::uuid AND b.tenant_id = p.tenant_id AND b.id = p.booking_id AND b.starts_at < now()`;
    console.log(`Complejo demo listo: /${SLUG} · ${created} reservas ficticias.`);
    console.log("Usuario: demo@example.com · contraseña (se muestra UNA vez, guardala):", pw);
  } finally {
    await owner.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
