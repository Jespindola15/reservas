import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { bookingAccessToken, getPublicBooking, reportTransferByLink } from "@/modules/booking/public-access";
import { changeBookingStatus, createBooking } from "@/modules/booking/service";
import { getFinance } from "@/modules/dashboard/finance";
import { listTenantInbox } from "@/modules/inbox/service";
import { confirmTransfer, listTransferQueue, updatePaymentSettings } from "@/modules/payments/transfers";
import { DAY, NOW, TZ, at, makeTenant, makeUser, onlineInput, owner, publicActor, resetDb, type Fixture } from "../support/fixtures";

const opts = { now: NOW };
let f: Fixture;
let ownerActor: { type: "USER"; userId: string };
const later = (min: number) => new Date(NOW.getTime() + min * 60_000);

async function configure(alias = "complejo.uno") {
  await updatePaymentSettings(f.ctx, { alias, holderName: "Complejo SRL", transferWindowMinutes: 30, reviewWindowMinutes: 120, depositType: "FIXED", depositValue: 5000 }, ownerActor);
}
async function reported(n: number, start: string, ref: string | null = null) {
  const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, start), 60, n), publicActor, opts);
  await reportTransferByLink(f.tenant.slug, booking.code, bookingAccessToken(booking.id), ref, publicActor, later(1));
  return owner.booking.findUniqueOrThrow({ where: { id: booking.id } });
}

beforeEach(async () => {
  await resetDb();
  f = await makeTenant("tr51");
  const u = await makeUser("dueno@tr51.test", { tenantId: f.tenant.id, role: "OWNER" });
  ownerActor = { type: "USER", userId: u.id };
  await configure();
});
afterAll(async () => { await prisma.$disconnect(); await owner.$disconnect(); });

describe("Fase 5.1: protecciones de transferencias", () => {
  it("cada reserva conserva los datos de cobro que vio el jugador aunque el complejo los cambie", async () => {
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    await configure("cuenta.nueva");
    const view = await getPublicBooking(f.tenant.slug, booking.code, bookingAccessToken(booking.id), later(2));
    expect(view.transfer).toMatchObject({ alias: "complejo.uno", holderName: "Complejo SRL", amountDue: booking.amountDue, currency: "ARS" });
    // El complejo recibe un aviso: hay solicitudes con los datos anteriores.
    const inbox = await listTenantInbox(f.ctx, 50);
    expect(inbox.rows.some((r) => r.kind === "bank_data_changed")).toBe(true);
    // Reservas nuevas usan los datos nuevos.
    const { booking: b2 } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "22:00"), 60, 2), publicActor, opts);
    const v2 = await getPublicBooking(f.tenant.slug, b2.code, bookingAccessToken(b2.id), later(2));
    expect(v2.transfer?.alias).toBe("cuenta.nueva");
  });

  it("importe distinto al esperado exige una decisión explícita y deja una incidencia", async () => {
    const row = await reported(1, "20:00");
    const due = row.amountDue! / 100;
    const less = String(Math.floor(due / 2));
    await expect(confirmTransfer(f.ctx, { bookingId: row.id, expectedVersion: row.version, receivedAmount: less }, ownerActor, later(5)))
      .rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
    await expect(confirmTransfer(f.ctx, { bookingId: row.id, expectedVersion: row.version, receivedAmount: String(due * 2), difference: "ACCEPT_PARTIAL" }, ownerActor, later(5)))
      .rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
    await confirmTransfer(f.ctx, { bookingId: row.id, expectedVersion: row.version, receivedAmount: less, difference: "ACCEPT_PARTIAL" }, ownerActor, later(5));
    const inc = await owner.paymentIncident.findFirstOrThrow({ where: { bookingId: row.id } });
    expect(inc).toMatchObject({ kind: "UNDERPAID", amount: row.amountDue! - Number(less) * 100, status: "OPEN" });
    expect(await owner.booking.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "CONFIRMED", paymentReceivedAmount: Number(less) * 100 });
  });

  it("un mismo n.º de operación no confirma dos reservas y queda marcado al informarlo", async () => {
    const a = await reported(1, "18:00", "op-778899");
    const b = await reported(2, "20:00", "OP 778899");
    expect(await owner.paymentIncident.count({ where: { bookingId: b.id, kind: "DUPLICATE_REFERENCE" } })).toBe(1);
    await confirmTransfer(f.ctx, { bookingId: a.id, expectedVersion: a.version, receivedAmount: String(a.amountDue! / 100) }, ownerActor, later(5));
    await expect(confirmTransfer(f.ctx, { bookingId: b.id, expectedVersion: b.version, receivedAmount: String(b.amountDue! / 100) }, ownerActor, later(5)))
      .rejects.toMatchObject({ code: "REFERENCE_ALREADY_USED" });
    // Búsqueda por n.º de operación.
    const q = await listTransferQueue(f.ctx, { estado: "todas", q: "778899" }, later(6));
    expect(q.bookings.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("las transferencias no verificadas no se cuentan como ingresos", async () => {
    const a = await reported(1, "18:00");
    await reported(2, "20:00");
    await confirmTransfer(f.ctx, { bookingId: a.id, expectedVersion: a.version, receivedAmount: String(a.amountDue! / 100) }, ownerActor, later(5));
    const fin = await getFinance(f.ctx, TZ, { from: "2000-01-01", to: "2100-01-01" }, later(6));
    expect(fin.total).toBe(a.amountDue);
    expect(fin.pendingReview.count).toBe(1);
  });

  it("transferencia informada segundos antes del vencimiento se acepta; un segundo después es incidencia", async () => {
    const { booking: a } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "18:00")), publicActor, opts);
    const r1 = await reportTransferByLink(f.tenant.slug, a.code, bookingAccessToken(a.id), null, publicActor, new Date(a.expiresAt!.getTime() - 2000));
    expect(r1.status).toBe("reported");
    const { booking: b } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 60, 2), publicActor, opts);
    const r2 = await reportTransferByLink(f.tenant.slug, b.code, bookingAccessToken(b.id), null, publicActor, new Date(b.expiresAt!.getTime() + 1000));
    expect(r2.status).toBe("late");
    expect(await owner.paymentIncident.count({ where: { bookingId: b.id, kind: "LATE_TRANSFER", status: "OPEN" } })).toBe(1);
  });

  it("ninguna otra pantalla confirma una reserva que espera transferencia", async () => {
    const row = await reported(1, "20:00");
    await expect(changeBookingStatus(f.ctx, { bookingId: row.id, to: "CONFIRMED", expectedVersion: row.version }, ownerActor, { now: later(3) }))
      .rejects.toMatchObject({ code: "TRANSFER_VERIFY_REQUIRED" });
  });
});
