import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/tenant-context";
import { getDayAvailability } from "@/modules/booking/availability";
import { changeBookingStatus, createBooking, rescheduleBooking } from "@/modules/booking/service";
import { expirePendingBookings } from "@/modules/jobs/expire-pending";
import { POST as expireEndpoint } from "@/app/api/internal/jobs/expire-pending/route";
import { DAY, NOW, appRole, at, makeTenant, onlineInput, owner, publicActor, resetDb, type Fixture } from "../support/fixtures";

const opts = { now: NOW };

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

/** Simula que pasó el plazo: corre el vencimiento al pasado (reloj real de la BD). */
async function makeOverdue(bookingId: string) {
  await owner.$executeRaw`UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = ${bookingId}::uuid`;
}

let f: Fixture;
let g: Fixture;

beforeEach(async () => {
  await resetDb();
  f = await makeTenant("vence-a", { requiresApproval: true });
  g = await makeTenant("vence-b", { requiresApproval: true });
});

afterAll(async () => {
  await prisma.$disconnect();
  await owner.$disconnect();
  await appRole.$disconnect();
});

describe("reglas de vencimiento", () => {
  it("una solicitud online PENDING recibe vencimiento configurable; las manuales/confirmadas no vencen", async () => {
    await owner.tenant.update({ where: { id: f.tenant.id }, data: { pendingExpirationMinutes: 45 } });
    const p = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    expect(p.booking.status).toBe("PENDING");
    expect(p.booking.expiresAt!.getTime() - NOW.getTime()).toBe(45 * 60_000);
    const m = await createBooking(f.ctx, { ...onlineInput(f.court.id, at(DAY, "22:00"), 60, 2), source: "MANUAL" }, publicActor, opts);
    expect(m.booking.status).toBe("CONFIRMED");
    expect(m.booking.expiresAt).toBeNull();
  });

  it("el vencimiento nunca supera el inicio del turno", async () => {
    await owner.tenant.update({ where: { id: f.tenant.id }, data: { pendingExpirationMinutes: 1440 } });
    const start = new Date(NOW.getTime() + 2 * 3_600_000); // 11:00, dentro de la anticipación
    const p = await createBooking(f.ctx, onlineInput(f.court.id, start, 60), publicActor, opts);
    expect(p.booking.expiresAt!.getTime()).toBe(start.getTime());
  });

  it("al confirmar se quita el vencimiento", async () => {
    const p = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    const c = await changeBookingStatus(f.ctx, { bookingId: p.booking.id, to: "CONFIRMED", expectedVersion: 1 }, publicActor, opts);
    expect(c.expiresAt).toBeNull();
    await makeOverdue(p.booking.id); // aunque alguien forzara una fecha, CONFIRMED no vence
    expect((await expirePendingBookings()).expired).toBe(0);
  });
});

describe("job de vencimiento", () => {
  it("vence, libera el turno y audita como SYSTEM; repetirlo no hace nada (idempotente)", async () => {
    const p = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    const fresh = await createBooking(f.ctx, onlineInput(f.court2.id, at(DAY, "20:00"), 90, 2), publicActor, opts);
    await makeOverdue(p.booking.id);

    expect((await expirePendingBookings()).expired).toBe(1);
    const row = await owner.booking.findUniqueOrThrow({ where: { id: p.booking.id } });
    expect(row.status).toBe("EXPIRED");
    expect(row.expiredAt).not.toBeNull();
    expect(await owner.courtAllocation.count({ where: { bookingId: p.booking.id } })).toBe(0);
    expect((await owner.booking.findUniqueOrThrow({ where: { id: fresh.booking.id } })).status).toBe("PENDING");
    const logs = await owner.auditLog.findMany({ where: { entityId: p.booking.id, action: "booking.status.expired" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.actorType).toBe("SYSTEM");

    expect((await expirePendingBookings()).expired).toBe(0);
    expect(await owner.auditLog.count({ where: { action: "booking.status.expired" } })).toBe(1);
    // El turno quedó libre para otra persona.
    const again = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 3), publicActor, opts);
    expect(again.booking.status).toBe("PENDING");
  });

  it("8 ejecuciones simultáneas del job sobre 60 vencidas: cada una se vence exactamente una vez", async () => {
    const starts = ["08:00", "09:30", "18:00", "19:30", "21:00", "22:30"];
    const ids: string[] = [];
    for (let day = 5; day <= 9; day++) {
      for (const court of [f.court.id, f.court2.id]) {
        for (const s of starts) {
          const r = await createBooking(f.ctx, onlineInput(court, at(`2030-03-0${day}`, s), 60, ids.length + 1), publicActor, opts);
          ids.push(r.booking.id);
        }
      }
    }
    expect(ids).toHaveLength(60);
    await owner.$executeRaw`UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE status = 'PENDING'`;

    const runs = await Promise.all(Array.from({ length: 8 }, () => expirePendingBookings({ batchSize: 7 })));
    expect(runs.reduce((a, r) => a + r.expired, 0)).toBe(60);
    expect(await owner.booking.count({ where: { status: "EXPIRED" } })).toBe(60);
    expect(await owner.auditLog.count({ where: { action: "booking.status.expired" } })).toBe(60);
    expect(await owner.courtAllocation.count({ where: { tenantId: f.tenant.id } })).toBe(0);
  });

  it("acotado a un complejo no toca a los demás", async () => {
    const a = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    const b = await createBooking(g.ctx, onlineInput(g.court.id, at(DAY, "20:00")), publicActor, opts);
    await makeOverdue(a.booking.id);
    await makeOverdue(b.booking.id);
    expect((await expirePendingBookings({ tenantId: f.tenant.id })).expired).toBe(1);
    expect((await owner.booking.findUniqueOrThrow({ where: { id: b.booking.id } })).status).toBe("PENDING");
  });
});

describe("confirmación de reservas vencidas", () => {
  it("no se puede confirmar una solicitud vencida aunque el job todavía no haya corrido", async () => {
    const p = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    await makeOverdue(p.booking.id);
    // `now` real: la app ve el vencimiento.
    await expectCode(changeBookingStatus(f.ctx, { bookingId: p.booking.id, to: "CONFIRMED", expectedVersion: 1 }, publicActor), "BOOKING_EXPIRED");
    // `now` falso en el pasado: la app no lo ve... pero la BASE lo impide igual.
    await expectCode(
      changeBookingStatus(f.ctx, { bookingId: p.booking.id, to: "CONFIRMED", expectedVersion: 1 }, publicActor, { now: new Date("2020-01-01") }),
      "BOOKING_EXPIRED",
    );
    expect((await owner.booking.findUniqueOrThrow({ where: { id: p.booking.id } })).status).toBe("PENDING");
  });

  it("ni siquiera con SQL directo (rol de la app) se confirma o reabre una reserva vencida", async () => {
    const p = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    await makeOverdue(p.booking.id);
    await expect(
      withTenant(f.ctx, (tx) => tx.$executeRaw`UPDATE bookings SET status = 'CONFIRMED' WHERE id = ${p.booking.id}::uuid`),
    ).rejects.toThrow(/booking_expired/);
    await expirePendingBookings();
    await expect(
      withTenant(f.ctx, (tx) => tx.$executeRaw`UPDATE bookings SET status = 'PENDING' WHERE id = ${p.booking.id}::uuid`),
    ).rejects.toThrow(/booking_final_state/);
    await expectCode(changeBookingStatus(f.ctx, { bookingId: p.booking.id, to: "CONFIRMED", expectedVersion: 2 }, publicActor, opts), "BOOKING_CLOSED");
  });

  it("confirmar y vencer en paralelo: nunca queda CONFIRMED una vencida", async () => {
    for (let i = 0; i < 5; i++) {
      const p = await createBooking(f.ctx, onlineInput(f.court.id, at(`2030-03-0${5 + i}`, "20:00"), 90, i), publicActor, opts);
      await makeOverdue(p.booking.id);
      await Promise.allSettled([
        changeBookingStatus(f.ctx, { bookingId: p.booking.id, to: "CONFIRMED", expectedVersion: 1 }, publicActor, { now: new Date("2020-01-01") }),
        expirePendingBookings(),
      ]);
      expect((await owner.booking.findUniqueOrThrow({ where: { id: p.booking.id } })).status).not.toBe("CONFIRMED");
    }
  });

  it("no se puede reprogramar una solicitud vencida", async () => {
    const p = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    await makeOverdue(p.booking.id);
    await expectCode(
      rescheduleBooking(f.ctx, { bookingId: p.booking.id, startsAt: at(DAY, "22:00"), durationMinutes: 90, expectedVersion: 1 }, publicActor, opts),
      "BOOKING_EXPIRED",
    );
    // Barrera en la base: mover una PENDING vencida con SQL directo también falla.
    await expect(
      withTenant(f.ctx, (tx) => tx.$executeRaw`UPDATE bookings SET starts_at = starts_at + interval '2 hours', ends_at = ends_at + interval '2 hours' WHERE id = ${p.booking.id}::uuid`),
    ).rejects.toThrow(/booking_expired/);
  });
});

describe("liberación inmediata sin esperar al job", () => {
  it("la disponibilidad muestra libre el turno de una solicitud vencida y otra persona puede reservarlo", async () => {
    const p = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    await makeOverdue(p.booking.id);
    const day = await getDayAvailability(f.ctx, { operatingDate: DAY, durationMinutes: 90, courtId: f.court.id }, opts);
    const slot = day.courts[0]!.slots.find((s) => s.startsAt === at(DAY, "20:00").toISOString());
    expect(slot?.available).toBe(true);
    const other = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:30"), 60, 2), publicActor, opts);
    expect(other.booking.status).toBe("PENDING");
    expect((await owner.booking.findUniqueOrThrow({ where: { id: p.booking.id } })).status).toBe("EXPIRED");
  });
});

describe("endpoint del job", () => {
  const call = (auth?: string) =>
    expireEndpoint(new Request("http://localhost/api/internal/jobs/expire-pending", { method: "POST", headers: auth ? { authorization: auth } : {} }));

  it("exige el secreto y es idempotente", async () => {
    const p = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    await makeOverdue(p.booking.id);
    expect((await call()).status).toBe(401);
    expect((await call("Bearer otro-secreto-0123456789abcdef0123456789xx")).status).toBe(401);
    const ok = await call(`Bearer ${process.env.CRON_SECRET}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ expired: 1 });
    expect(await (await call(`Bearer ${process.env.CRON_SECRET}`)).json()).toEqual({ expired: 0 });
  });
});
