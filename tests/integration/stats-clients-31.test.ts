import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { recordPayment } from "@/modules/booking/payments";
import { changeBookingStatus, createBooking } from "@/modules/booking/service";
import { findDuplicateCustomers, getCustomer, listCustomers } from "@/modules/customers/service";
import { getStats } from "@/modules/dashboard/stats";
import { exportCustomersCsv } from "@/modules/exports/csv";
import { DAY, NOW, at, makeTenant, makeUser, onlineInput, owner, publicActor, resetDb, TZ, type Fixture } from "../support/fixtures";

const opts = { now: NOW };
let f: Fixture;
let actor: { type: "USER"; userId: string };

beforeEach(async () => {
  await resetDb();
  f = await makeTenant("st31");
  const u = await makeUser("dueno@st31.test", { tenantId: f.tenant.id, role: "OWNER" });
  actor = { type: "USER", userId: u.id };
});
afterAll(async () => {
  await prisma.$disconnect();
  await owner.$disconnect();
});

describe("estadísticas del complejo", () => {
  it("suma solo hechos registrados y no mezcla otro complejo", async () => {
    const { booking: a } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    const { booking: b } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "18:00"), 90, 2), publicActor, opts);
    await changeBookingStatus(f.ctx, { bookingId: b.id, to: "CANCELLED", reason: "lluvia", expectedVersion: 1 }, actor, opts);
    await recordPayment(f.ctx, { bookingId: a.id, kind: "DEPOSIT", method: "TRANSFER", amount: "100" }, actor);
    // La seña se registró "hoy" (reloj real); la movemos al día del turno para que caiga en el período.
    await owner.bookingPayment.updateMany({ data: { paidAt: at(DAY, "10:00") } });

    const g = await makeTenant("otrost31");
    await createBooking(g.ctx, onlineInput(g.court.id, at(DAY, "20:00")), publicActor, opts);

    const r = await getStats(f.ctx, TZ, { period: "week", date: DAY }, NOW);
    expect(r.current.from).toBe("2030-03-04");
    expect(r.stats.bookings).toMatchObject({ total: 2, active: 1, cancelled: 1 });
    expect(r.stats.money.collected).toBe(10_000);
    expect(r.stats.money.projected).toBe(a.priceAmount);
    expect(r.stats.money.pendingCollection).toBe(a.priceAmount! - 10_000);
    expect(r.stats.cancellationRate).toBe(50);
    expect(r.stats.customers).toEqual({ total: 1, new: 1, returning: 0 });
    expect(r.stats.occupancy.bookedMinutes).toBe(90);
    expect(r.stats.occupancy.openMinutes).toBeGreaterThan(0);
    expect(r.prev.bookings.total).toBe(0);
  });
});

describe("clientes", () => {
  it("visitas, total abonado, frecuentes, duplicados y CSV", async () => {
    // Cliente 1 jugó (turno pasado confirmado) y abonó; consultado "después" del turno.
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    await recordPayment(f.ctx, { bookingId: booking.id, kind: "PAYMENT", method: "CASH", amount: "250" }, actor);
    const { customerId } = await owner.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { customerId: true } });
    const later = new Date(at(DAY, "23:00").getTime() + 86_400_000);
    const list = await listCustomers(f.ctx, {}, later);
    const c1 = list.rows.find((r) => r.id === customerId)!;
    expect(c1).toMatchObject({ visits: 1, totalPaid: 25_000 });
    expect(c1.lastVisitAt?.toISOString()).toBe(booking.startsAt.toISOString());
    expect((await listCustomers(f.ctx, { filter: "frequent" }, later)).total).toBe(0);
    expect((await listCustomers(f.ctx, { filter: "nonsense" }, later)).total).toBe(list.total);
    const detail = await getCustomer(f.ctx, customerId);
    expect(detail.stats.totalPaid).toBe(25_000);

    // Duplicado: mismo teléfono con distinto formato, cargado con email distinto.
    const base = await owner.customer.findUniqueOrThrow({ where: { id: customerId } });
    await owner.customer.create({ data: { tenantId: f.tenant.id, contactKey: "otro@st31.test", name: "Mismo Jugador", email: "otro@st31.test", phone: `+54 9 ${base.phone}` } });
    const dups = await findDuplicateCustomers(f.ctx);
    expect(dups).toHaveLength(1);
    expect(dups[0]!.reason).toBe("phone");
    expect(dups[0]!.customers).toHaveLength(2);
    // Otro complejo con el mismo teléfono no aparece como duplicado.
    const g = await makeTenant("dupst31");
    await owner.customer.create({ data: { tenantId: g.tenant.id, contactKey: "tel:x", name: "Ajeno", phone: base.phone } });
    expect(await findDuplicateCustomers(f.ctx)).toHaveLength(1);
    expect((await findDuplicateCustomers(g.ctx)).length).toBe(0);

    const csv = await exportCustomersCsv(f.ctx, actor);
    expect(csv.split("\r\n")[0]).toContain("Total abonado");
    expect(csv).toContain("250.00");
    expect(csv).not.toContain("Ajeno");
  });
});
