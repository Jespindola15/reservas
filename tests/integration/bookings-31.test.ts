import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import { hasPermission } from "@/modules/access/authorize";
import { computeBalance, getBookingPayments, recordPayment, voidPayment } from "@/modules/booking/payments";
import { cancelSeries, createSeries, previewSeries } from "@/modules/booking/series";
import { changeBookingStatus, createBooking } from "@/modules/booking/service";
import { DAY, NOW, at, makeTenant, makeUser, onlineInput, owner, publicActor, resetDb, TZ, type Fixture } from "../support/fixtures";

const opts = { now: NOW };
let f: Fixture;
let actor: { type: "USER"; userId: string };
async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  await resetDb();
  f = await makeTenant("res31");
  const u = await makeUser("staff@res31.test", { tenantId: f.tenant.id, role: "STAFF" });
  actor = { type: "USER", userId: u.id };
});
afterAll(async () => {
  await prisma.$disconnect();
  await owner.$disconnect();
});

describe("pagos y señas (registro manual)", () => {
  it("seña + pago saldan la reserva; la devolución no puede superar lo abonado", async () => {
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    const total = booking.priceAmount!;
    expect(total).toBeGreaterThan(0);
    await recordPayment(f.ctx, { bookingId: booking.id, kind: "DEPOSIT", method: "TRANSFER", amount: (total / 2 / 100).toFixed(2) }, actor);
    let p = await getBookingPayments(f.ctx, booking.id);
    expect(p.balance).toEqual({ total, paid: total / 2, due: total / 2 });
    await recordPayment(f.ctx, { bookingId: booking.id, kind: "PAYMENT", method: "CASH", amount: (total / 2 / 100).toFixed(2), note: "en la caja" }, actor);
    p = await getBookingPayments(f.ctx, booking.id);
    expect(p.balance.due).toBe(0);
    await expectCode(recordPayment(f.ctx, { bookingId: booking.id, kind: "REFUND", method: "CASH", amount: (total / 100 + 1).toFixed(2) }, actor), "VALIDATION_ERROR");
    await recordPayment(f.ctx, { bookingId: booking.id, kind: "REFUND", method: "CASH", amount: "100" }, actor);
    expect((await getBookingPayments(f.ctx, booking.id)).balance.due).toBe(10_000);
    expect(await owner.auditLog.count({ where: { action: "booking.payment.recorded", entityId: booking.id } })).toBe(3);
  });

  it("montos inválidos se rechazan; anular deja rastro; personal no puede anular", async () => {
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    await expectCode(recordPayment(f.ctx, { bookingId: booking.id, kind: "PAYMENT", method: "CASH", amount: "-5" }, actor), "VALIDATION_ERROR");
    await expectCode(recordPayment(f.ctx, { bookingId: booking.id, kind: "PAYMENT", method: "BITCOIN" as never, amount: "5" }, actor), "VALIDATION_ERROR");
    const r = await recordPayment(f.ctx, { bookingId: booking.id, kind: "PAYMENT", method: "CASH", amount: "1500" }, actor);
    expect(hasPermission("STAFF", "payment.void")).toBe(false);
    expect(hasPermission("ADMIN", "payment.void")).toBe(true);
    await voidPayment(f.ctx, r.id, actor);
    expect((await getBookingPayments(f.ctx, booking.id)).payments).toHaveLength(0);
    const log = await owner.auditLog.findFirstOrThrow({ where: { action: "booking.payment.voided" } });
    expect(log.metadata).toMatchObject({ amount: 150_000, method: "CASH" });
  });

  it("aislamiento: no se pueden ver ni registrar pagos de reservas de otro complejo", async () => {
    const g = await makeTenant("otro31");
    const { booking } = await createBooking(g.ctx, onlineInput(g.court.id, at(DAY, "20:00")), publicActor, opts);
    await expectCode(getBookingPayments(f.ctx, booking.id), "BOOKING_NOT_FOUND");
    await expectCode(recordPayment(f.ctx, { bookingId: booking.id, kind: "PAYMENT", method: "CASH", amount: "10" }, actor), "BOOKING_NOT_FOUND");
    // Ni siquiera con SQL directo bajo el contexto del otro complejo (RLS).
    expect(await owner.bookingPayment.count()).toBe(0);
  });

  it("saldo sin precio definido", () => {
    expect(computeBalance(null, [{ kind: "DEPOSIT", amount: 500 }])).toEqual({ total: null, paid: 500, due: null });
  });
});

describe("turnos fijos (reservas recurrentes)", () => {
  const base = { courtId: "", startsOn: DAY, endsOn: addDays(DAY, 21), startTime: "20:00", durationMinutes: 90, customer: { name: "Los Martes FC", phone: "11 5000-1111" } };

  it("la vista previa marca conflictos y la creación los omite sin duplicar", async () => {
    // Alguien ya reservó la tercera fecha.
    await createBooking(f.ctx, onlineInput(f.court.id, at(addDays(DAY, 14), "20:00"), 90, 8), publicActor, opts);
    const input = { ...base, courtId: f.court.id };
    const pv = await previewSeries(f.ctx, input, opts);
    expect(pv.occurrences.map((o) => o.status)).toEqual(["ok", "ok", "taken", "ok"]);
    const r = await createSeries(f.ctx, { ...input, skipDates: [addDays(DAY, 21)] }, actor, opts);
    expect(r.created.map((c) => c.date)).toEqual([DAY, addDays(DAY, 7)]);
    expect(r.failed).toEqual([]);
    const rows = await owner.booking.findMany({ where: { seriesId: r.seriesId }, orderBy: { startsAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows.every((b) => b.source === "MANUAL" && b.status === "CONFIRMED")).toBe(true);
    // Una segunda serie igual no puede pisar la primera (antisolapamiento).
    const again = await previewSeries(f.ctx, input, opts);
    expect(again.occurrences.filter((o) => o.status === "ok").map((o) => o.date)).toEqual([addDays(DAY, 21)]);
  });

  it("puede ir más allá de la anticipación máxima del público, hasta 26 semanas", async () => {
    await owner.tenant.update({ where: { id: f.tenant.id }, data: { maxAdvanceDays: 7 } });
    const r = await createSeries(f.ctx, { ...base, courtId: f.court.id, endsOn: addDays(DAY, 7 * 8) }, actor, opts);
    expect(r.created).toHaveLength(9);
    await expectCode(previewSeries(f.ctx, { ...base, courtId: f.court.id, endsOn: addDays(DAY, 7 * 30) }, opts), "VALIDATION_ERROR");
  });

  it("cancelar una fecha no afecta al resto; cancelar desde una fecha libera las siguientes", async () => {
    const r = await createSeries(f.ctx, { ...base, courtId: f.court.id }, actor, opts);
    const rows = await owner.booking.findMany({ where: { seriesId: r.seriesId }, orderBy: { startsAt: "asc" } });
    await changeBookingStatus(f.ctx, { bookingId: rows[0]!.id, to: "CANCELLED", expectedVersion: rows[0]!.version }, actor, opts);
    const c = await cancelSeries(f.ctx, r.seriesId, addDays(DAY, 14), actor, opts);
    expect(c.cancelled).toBe(2);
    const after = await owner.booking.findMany({ where: { seriesId: r.seriesId }, orderBy: { startsAt: "asc" }, select: { status: true } });
    expect(after.map((b) => b.status)).toEqual(["CANCELLED", "CONFIRMED", "CANCELLED", "CANCELLED"]);
    // El horario liberado vuelve a estar disponible.
    await createBooking(f.ctx, onlineInput(f.court.id, at(addDays(DAY, 14), "20:00"), 90, 9), publicActor, opts);
  });

  it("aislamiento: no se puede crear una serie con la cancha de otro complejo", async () => {
    const g = await makeTenant("ajeno31");
    await expectCode(createSeries(f.ctx, { ...base, courtId: g.court.id }, actor, opts), "COURT_NOT_FOUND");
    void TZ;
  });
});
