import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/db/prisma";
import { getBookingDetail, getCalendar, listBookings } from "@/modules/booking/admin-queries";
import { changeBookingStatus, createBlock, createBooking, rescheduleBooking, setBookingInternalNotes } from "@/modules/booking/service";
import { DAY, NOW, TZ, appRole, at, key, makeTenant, makeUser, onlineInput, owner, publicActor, resetDb, type Fixture } from "../support/fixtures";

const opts = { now: NOW };

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

let f: Fixture;
let g: Fixture;

beforeEach(async () => {
  await resetDb();
  f = await makeTenant("admin-a");
  g = await makeTenant("admin-b");
});

afterAll(async () => {
  await prisma.$disconnect();
  await owner.$disconnect();
  await appRole.$disconnect();
});

const manual = (courtId: string, start: Date, n: number, duration = 90) => ({
  ...onlineInput(courtId, start, duration, n),
  customer: { name: `Cliente ${n}`, phone: `11 4000-${String(n).padStart(4, "0")}` },
  idempotencyKey: key(`man${n}`),
  source: "MANUAL" as const,
});

describe("dos administradores operando a la vez", () => {
  it("dos reservas manuales simultáneas incompatibles: solo una se registra", async () => {
    const u1 = await makeUser("a1@example.com", { tenantId: f.tenant.id, role: "ADMIN" });
    const u2 = await makeUser("a2@example.com", { tenantId: f.tenant.id, role: "STAFF" });
    const results = await Promise.allSettled([
      createBooking({ ...f.ctx, userId: u1.id }, manual(f.court.id, at(DAY, "20:00"), 1), { type: "USER", userId: u1.id }, opts),
      createBooking({ ...f.ctx, userId: u2.id }, manual(f.court.id, at(DAY, "20:30"), 2), { type: "USER", userId: u2.id }, opts),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as AppError).code).toBe("SLOT_UNAVAILABLE");
  });

  it("dos reprogramaciones simultáneas hacia el mismo horario: solo una se aplica y la otra queda intacta", async () => {
    const a = await createBooking(f.ctx, manual(f.court.id, at(DAY, "18:00"), 1), publicActor, opts);
    const b = await createBooking(f.ctx, manual(f.court.id, at(DAY, "22:00"), 2), publicActor, opts);
    const target = at(DAY, "20:00");
    const results = await Promise.allSettled([
      rescheduleBooking(f.ctx, { bookingId: a.booking.id, startsAt: target, durationMinutes: 90, expectedVersion: 1 }, publicActor, opts),
      rescheduleBooking(f.ctx, { bookingId: b.booking.id, startsAt: target, durationMinutes: 90, expectedVersion: 1 }, publicActor, opts),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rows = await owner.booking.findMany({ where: { tenantId: f.tenant.id }, orderBy: { startsAt: "asc" } });
    const moved = rows.filter((r) => r.startsAt.getTime() === target.getTime());
    expect(moved).toHaveLength(1);
    const untouched = rows.find((r) => r.startsAt.getTime() !== target.getTime())!;
    expect(untouched.version).toBe(1);
  });

  it("dos administradores reprogramando la MISMA reserva con la misma versión: gana uno", async () => {
    const a = await createBooking(f.ctx, manual(f.court.id, at(DAY, "18:00"), 1), publicActor, opts);
    const results = await Promise.allSettled([
      rescheduleBooking(f.ctx, { bookingId: a.booking.id, startsAt: at(DAY, "20:00"), durationMinutes: 90, expectedVersion: 1 }, publicActor, opts),
      rescheduleBooking(f.ctx, { bookingId: a.booking.id, startsAt: at(DAY, "22:00"), durationMinutes: 90, expectedVersion: 1 }, publicActor, opts),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await owner.booking.findUniqueOrThrow({ where: { id: a.booking.id } })).version).toBe(2);
  });

  it("no se puede reprogramar sobre un bloqueo de mantenimiento", async () => {
    const a = await createBooking(f.ctx, manual(f.court.id, at(DAY, "18:00"), 1), publicActor, opts);
    await createBlock(f.ctx, { courtId: f.court.id, startsAt: at(DAY, "21:00"), endsAt: at(DAY, "23:00"), reason: "Mantenimiento" }, publicActor, opts);
    await expectCode(
      rescheduleBooking(f.ctx, { bookingId: a.booking.id, startsAt: at(DAY, "20:30"), durationMinutes: 90, expectedVersion: 1 }, publicActor, opts),
      "SLOT_UNAVAILABLE",
    );
  });
});

describe("consultas del panel", () => {
  it("filtra por estado, cancha, fecha y texto; nunca devuelve reservas de otro complejo", async () => {
    const a = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    await createBooking(f.ctx, onlineInput(f.court2.id, at("2030-03-06", "20:00"), 90, 2), publicActor, opts);
    await createBooking(g.ctx, onlineInput(g.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    await changeBookingStatus(f.ctx, { bookingId: a.booking.id, to: "CANCELLED", expectedVersion: 1 }, publicActor, opts);

    expect((await listBookings(f.ctx, TZ, {})).total).toBe(2);
    expect((await listBookings(f.ctx, TZ, { status: "CANCELLED" })).rows.map((r) => r.id)).toEqual([a.booking.id]);
    expect((await listBookings(f.ctx, TZ, { courtId: f.court2.id })).total).toBe(1);
    expect((await listBookings(f.ctx, TZ, { from: DAY, to: DAY })).total).toBe(1);
    expect((await listBookings(f.ctx, TZ, { q: "Jugador 2" })).total).toBe(1);
    expect((await listBookings(f.ctx, TZ, { q: a.booking.code })).total).toBe(1);
    expect((await listBookings(f.ctx, TZ, { q: "%" })).total).toBe(2); // comodines neutralizados
    // Filtro por una cancha de OTRO complejo: vacío.
    expect((await listBookings(f.ctx, TZ, { courtId: g.court.id })).total).toBe(0);
    await expectCode(listBookings(f.ctx, TZ, { status: "INVENTADO" as never }), "VALIDATION_ERROR");
  });

  it("el detalle incluye historial y no es accesible desde otro complejo", async () => {
    const u = await makeUser("staff@example.com", { tenantId: f.tenant.id, role: "STAFF" });
    const a = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    await setBookingInternalNotes(f.ctx, { bookingId: a.booking.id, notes: "Trae pelota" }, { type: "USER", userId: u.id });
    await rescheduleBooking(f.ctx, { bookingId: a.booking.id, startsAt: at(DAY, "21:30"), durationMinutes: 90, expectedVersion: 1 }, { type: "USER", userId: u.id }, opts);
    const d = await getBookingDetail(f.ctx, a.booking.id);
    expect(d.booking.internalNotes).toBe("Trae pelota");
    expect(d.history.map((h) => h.action)).toEqual(["booking.created", "booking.internal_notes.updated", "booking.rescheduled"]);
    expect(d.history[2]!.actorName).toBe("staff");
    await expectCode(getBookingDetail(g.ctx, a.booking.id), "BOOKING_NOT_FOUND");
    await expectCode(setBookingInternalNotes(g.ctx, { bookingId: a.booking.id, notes: "x" }, publicActor), "BOOKING_NOT_FOUND");
  });

  it("el calendario semanal trae solo reservas activas y bloqueos del complejo", async () => {
    const a = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    await createBooking(f.ctx, onlineInput(f.court.id, at("2030-03-06", "23:30"), 90, 2), publicActor, opts);
    const c = await createBooking(f.ctx, onlineInput(f.court2.id, at(DAY, "20:00"), 90, 3), publicActor, opts);
    await changeBookingStatus(f.ctx, { bookingId: c.booking.id, to: "CANCELLED", expectedVersion: 1 }, publicActor, opts);
    await createBooking(g.ctx, onlineInput(g.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    const cal = await getCalendar(f.ctx, TZ, { date: "2030-03-04", days: 7 });
    expect(cal.dates).toHaveLength(7);
    expect(cal.bookings.map((b) => b.id)).toContain(a.booking.id);
    expect(cal.bookings.map((b) => b.id)).not.toContain(c.booking.id);
    expect(cal.bookings.every((b) => [f.court.id, f.court2.id].includes(b.courtId))).toBe(true);
    expect(cal.windows[1]!.courts[0]!.windows).toEqual([
      { openMinute: 480, closeMinute: 720 },
      { openMinute: 1080, closeMinute: 1560 },
    ]);
  });
});
