import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/tenant-context";
import { hasPermission } from "@/modules/access/authorize";
import { getDayAvailability } from "@/modules/booking/availability";
import { bookingAccessToken, getPublicBooking, reportTransferByLink } from "@/modules/booking/public-access";
import { publicBookingRequestSchema } from "@/modules/booking/schemas";
import { createBooking } from "@/modules/booking/service";
import { listTenantInbox, listPlayerInbox } from "@/modules/inbox/service";
import { confirmTransfer, getPaymentSettings, isValidCbu, listTransferQueue, rejectTransfer, resolveIncident, updatePaymentSettings, amountDueFor } from "@/modules/payments/transfers";
import { registerPlayer } from "@/modules/player/account";
import { listPlayerBookings, reportPlayerTransfer } from "@/modules/player/bookings";
import { DAY, NOW, at, makeTenant, makeUser, onlineInput, owner, publicActor, resetDb, type Fixture } from "../support/fixtures";

const opts = { now: NOW };
const CBU = "2850590940090418135201"; // CBU de ejemplo con dígitos verificadores válidos
let f: Fixture;
let ownerActor: { type: "USER"; userId: string };

async function configure(depositType: "FIXED" | "PERCENT" | "FULL" | "NONE", depositValue: string | number, extra: Record<string, unknown> = {}) {
  await updatePaymentSettings(f.ctx, { alias: "complejo.mp", holderName: "Complejo SRL", transferWindowMinutes: 30, reviewWindowMinutes: 120, depositType, depositValue, ...extra }, ownerActor);
}

beforeEach(async () => {
  await resetDb();
  f = await makeTenant("tr5");
  const u = await makeUser("dueno@tr5.test", { tenantId: f.tenant.id, role: "OWNER" });
  ownerActor = { type: "USER", userId: u.id };
});
afterAll(async () => { await prisma.$disconnect(); await owner.$disconnect(); });

describe("configuración de cobro", () => {
  it("valida alias, CBU/CVU (dígito verificador), titular y montos; audita sin datos bancarios", async () => {
    expect(isValidCbu(CBU)).toBe(true);
    expect(isValidCbu("2850590940090418135202")).toBe(false);
    await expect(configure("FIXED", 0)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(configure("PERCENT", 150)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(updatePaymentSettings(f.ctx, { transferWindowMinutes: 30, reviewWindowMinutes: 120, depositType: "FIXED", depositValue: 5000 }, ownerActor)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(configure("FIXED", 5000, { cbuCvu: "123" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await configure("FIXED", 5000, { cbuCvu: CBU });
    const s = await getPaymentSettings(f.ctx);
    expect(s).toMatchObject({ configured: true, tenant: { depositType: "FIXED", depositValue: 500000 } });
    const log = await owner.auditLog.findFirstOrThrow({ where: { action: "tenant.payment_settings.updated" } });
    expect(JSON.stringify(log.metadata)).not.toContain("complejo.mp");
    expect(JSON.stringify(log.metadata)).not.toContain(CBU);
    expect(hasPermission("OWNER", "payments.configure")).toBe(true);
    expect(hasPermission("ADMIN", "payments.configure")).toBe(false);
    expect(hasPermission("ADMIN", "payments.verify")).toBe(true);
    expect(hasPermission("STAFF", "payments.verify")).toBe(false);
    expect(hasPermission("STAFF", "payments.configure")).toBe(false);
  });

  it("si el complejo pide transferencia sin datos de cobro, no acepta reservas online", async () => {
    await owner.tenant.update({ where: { id: f.tenant.id }, data: { depositType: "FIXED", depositValue: 500000 } });
    await expect(createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts)).rejects.toMatchObject({ code: "PAYMENTS_NOT_CONFIGURED" });
  });
});

describe("importe a transferir (calculado en el servidor)", () => {
  it("seña fija, porcentual, pago completo y sin seña", async () => {
    expect(amountDueFor(2_000_000, "FIXED", 500_000)).toBe(500_000);
    expect(amountDueFor(300_000, "FIXED", 500_000)).toBe(300_000);
    expect(amountDueFor(2_000_000, "PERCENT", 30)).toBe(600_000);
    expect(amountDueFor(2_000_000, "FULL", 0)).toBe(2_000_000);
    expect(amountDueFor(null, "FULL", 0)).toBeNull();
    expect(amountDueFor(2_000_000, "NONE", 0)).toBe(0);
    for (const [type, value] of [["FIXED", 5000], ["PERCENT", 25], ["FULL", 0]] as const) {
      await configure(type, value);
      const { booking } = await createBooking(f.ctx, { ...onlineInput(f.court.id, at(DAY, "20:00"), 60, Math.floor(Math.random() * 1e6)) }, publicActor, opts);
      const price = booking.priceAmount!;
      expect(booking).toMatchObject({ status: "PENDING", paymentStatus: "AWAITING_TRANSFER" });
      // Seña fija: nunca más que el precio del turno (acá el turno cuesta menos que la seña).
      expect(booking.amountDue).toBe(type === "FIXED" ? Math.min(500000, price) : type === "PERCENT" ? Math.round(price * 0.25) : price);
      await owner.booking.delete({ where: { id: booking.id } });
    }
    await configure("NONE", 0);
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    expect(booking).toMatchObject({ status: "CONFIRMED", paymentStatus: "NOT_REQUIRED", amountDue: null });
  });

  it("el navegador no puede fijar el importe ni el estado: el esquema los descarta", () => {
    const parsed = publicBookingRequestSchema.parse({
      courtId: "00000000-0000-4000-8000-000000000000", startsAt: "2030-03-05T20:00:00-03:00", durationMinutes: 60,
      customer: { name: "Ana", phone: "1155550000", email: "a@b.co" }, idempotencyKey: "abcdefghijklmnop1234",
      amountDue: 1, status: "CONFIRMED", paymentStatus: "VERIFIED",
    } as never);
    expect(parsed).not.toHaveProperty("amountDue");
    expect(parsed).not.toHaveProperty("status");
    expect(() => publicBookingRequestSchema.parse({ ...parsed, payerIsSelf: false })).toThrow();
  });
});

describe("flujo de transferencia", () => {
  it("titular distinto, informar (una sola vez), confirmar con registro y sin doble confirmación", async () => {
    await configure("PERCENT", 50);
    const { booking } = await createBooking(f.ctx, { ...onlineInput(f.court.id, at(DAY, "20:00")), transferPayerName: "Marta Gómez" }, publicActor, opts);
    expect(booking.expiresAt!.getTime()).toBe(NOW.getTime() + 30 * 60_000);
    const token = bookingAccessToken(booking.id);
    const view = await getPublicBooking(f.tenant.slug, booking.code, token, NOW);
    expect(view.transfer).toMatchObject({ alias: "complejo.mp", holderName: "Complejo SRL" });
    expect(view.amountDue).toBe(booking.amountDue);

    const r = await reportTransferByLink(f.tenant.slug, booking.code, token, "OP-12345", publicActor, new Date(NOW.getTime() + 10 * 60_000));
    expect(r.status).toBe("reported");
    await expect(reportTransferByLink(f.tenant.slug, booking.code, token, null, publicActor, new Date(NOW.getTime() + 11 * 60_000))).rejects.toMatchObject({ code: "ALREADY_PROCESSED" });
    const row = await owner.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row).toMatchObject({ paymentStatus: "TRANSFER_REPORTED", transferReference: "OP-12345", transferPayerName: "Marta Gómez", status: "PENDING" });
    expect(row.expiresAt!.getTime()).toBe(NOW.getTime() + 10 * 60_000 + 120 * 60_000);

    const q = await listTransferQueue(f.ctx, { estado: "informadas", q: "marta" }, NOW);
    expect(q.bookings.map((b) => b.code)).toEqual([booking.code]);
    expect((await listTransferQueue(f.ctx, { estado: "informadas", q: String(booking.amountDue! / 100) }, NOW)).bookings).toHaveLength(1);

    const later = new Date(NOW.getTime() + 20 * 60_000);
    await confirmTransfer(f.ctx, { bookingId: booking.id, expectedVersion: row.version, receivedAmount: String(booking.amountDue! / 100) }, ownerActor, later);
    await expect(confirmTransfer(f.ctx, { bookingId: booking.id, expectedVersion: row.version, receivedAmount: "1" }, ownerActor, later)).rejects.toMatchObject({ code: "ALREADY_PROCESSED" });
    const done = await owner.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { payments: true } });
    expect(done).toMatchObject({ status: "CONFIRMED", paymentStatus: "VERIFIED", paymentVerifiedBy: ownerActor.userId });
    expect(done.payments).toHaveLength(1);
    expect(done.payments[0]).toMatchObject({ kind: "DEPOSIT", method: "TRANSFER", amount: booking.amountDue });
    const inbox = await listTenantInbox(f.ctx);
    expect(inbox.rows.map((r) => r.kind)).toEqual(expect.arrayContaining(["booking_requested", "transfer_reported"]));
  });

  it("rechazo con dinero recibido genera incidencia; se resuelve registrando la devolución externa", async () => {
    await configure("FULL", 0);
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    await rejectTransfer(f.ctx, { bookingId: booking.id, expectedVersion: booking.version, reason: "El importe no coincide", moneyReceived: true, receivedAmount: "100" }, ownerActor, NOW);
    expect((await owner.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("REJECTED");
    const q = await listTransferQueue(f.ctx, { estado: "incidencias" }, NOW);
    expect(q.incidents).toHaveLength(1);
    expect(q.incidents[0]).toMatchObject({ kind: "PAID_BUT_REJECTED", amount: 10000, status: "OPEN" });
    await resolveIncident(f.ctx, { incidentId: q.incidents[0]!.id, resolution: "REFUNDED_EXTERNALLY", notes: "Devuelto por transferencia" }, ownerActor);
    await expect(resolveIncident(f.ctx, { incidentId: q.incidents[0]!.id, resolution: "OTHER" }, ownerActor)).rejects.toMatchObject({ code: "ALREADY_PROCESSED" });
  });

  it("vencimiento libera el turno (aunque la tarea programada no haya corrido); informar tarde crea incidencia y nunca confirma", async () => {
    await configure("FIXED", 5000);
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    // Sin pagar, el turno aparece ocupado para otros.
    let day = await getDayAvailability(f.ctx, { operatingDate: DAY, durationMinutes: 60 }, opts);
    expect(day.courts[0]!.slots.find((s) => s.startsAt === at(DAY, "20:00").toISOString())?.available).toBe(false);
    // Pasa el plazo (sin ejecutar ninguna tarea): la disponibilidad lo libera.
    const after = new Date(NOW.getTime() + 31 * 60_000);
    day = await getDayAvailability(f.ctx, { operatingDate: DAY, durationMinutes: 60 }, { now: after });
    expect(day.courts[0]!.slots.find((s) => s.startsAt === at(DAY, "20:00").toISOString())?.available).toBe(true);
    // Confirmar fuera de plazo: imposible.
    await expect(confirmTransfer(f.ctx, { bookingId: booking.id, expectedVersion: booking.version, receivedAmount: "50" }, ownerActor, after)).rejects.toMatchObject({ code: "BOOKING_EXPIRED" });
    // Informar tarde: incidencia para revisión manual, sin reconfirmar.
    const r = await reportTransferByLink(f.tenant.slug, booking.code, bookingAccessToken(booking.id), "TARDE-1", publicActor, after);
    expect(r.status).toBe("late");
    const row = await owner.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.paymentStatus).toBe("AWAITING_TRANSFER");
    expect(await owner.paymentIncident.count({ where: { bookingId: booking.id, kind: "LATE_TRANSFER" } })).toBe(1);
    // Otra persona puede tomar el turno: el vencimiento se aplica dentro de la transacción de reserva.
    await owner.booking.update({ where: { id: booking.id }, data: { expiresAt: new Date("2026-01-01T00:00:00Z") } });
    const { booking: b2 } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 60, 2), publicActor, opts);
    expect(b2.status).toBe("PENDING");
    expect((await owner.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("EXPIRED");
  });

  it("reservas simultáneas del mismo turno: una sola gana", async () => {
    await configure("FIXED", 5000);
    const results = await Promise.allSettled([1, 2, 3, 4].map((n) => createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 60, n), publicActor, opts)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected")) expect((r as PromiseRejectedResult).reason).toMatchObject({ code: "SLOT_UNAVAILABLE" });
  });

  it("una persona no puede bloquear más de 2 turnos sin pagar", async () => {
    await configure("FIXED", 5000);
    const same = (hh: string) => ({ ...onlineInput(f.court.id, at(DAY, hh)), idempotencyKey: `hold-${hh.replace(":", "")}-abcdefghij` });
    await createBooking(f.ctx, same("18:00"), publicActor, opts);
    await createBooking(f.ctx, same("19:30"), publicActor, opts);
    await expect(createBooking(f.ctx, same("21:00"), publicActor, opts)).rejects.toMatchObject({ code: "HOLD_LIMIT" });
  });

  it("jugador con cuenta: ve la reserva pendiente, informa desde Mis turnos y recibe avisos internos", async () => {
    await configure("FIXED", 5000);
    const { userId } = await registerPlayer({ name: "Juana Pérez", email: "juana@tr5.test", password: "una-clave-de-jugador-1", acceptTerms: true }, "10.1.1.1");
    const { booking } = await createBooking(f.ctx, { ...onlineInput(f.court.id, at(DAY, "20:00")), playerUserId: userId }, publicActor, opts);
    const mine = await listPlayerBookings(userId, NOW);
    expect(mine[0]).toMatchObject({ paymentStatus: "AWAITING_TRANSFER", amountDue: booking.amountDue });
    await reportPlayerTransfer(userId, booking.id, null, new Date(NOW.getTime() + 5 * 60_000));
    const other = await registerPlayer({ name: "Otro", email: "otro@tr5.test", password: "una-clave-de-jugador-1", acceptTerms: true }, "10.1.1.2");
    await expect(reportPlayerTransfer(other.userId, booking.id, null, NOW)).rejects.toMatchObject({ code: "BOOKING_NOT_FOUND" });
    const row = await owner.booking.findUniqueOrThrow({ where: { id: booking.id } });
    await confirmTransfer(f.ctx, { bookingId: booking.id, expectedVersion: row.version, receivedAmount: String(booking.amountDue! / 100) }, ownerActor, new Date(NOW.getTime() + 6 * 60_000));
    const inbox = await listPlayerInbox(userId);
    expect(inbox.rows.map((r) => r.kind)).toEqual(expect.arrayContaining(["transfer_pending_review", "booking_confirmed"]));
    expect((await listPlayerInbox(other.userId)).rows).toEqual([]);
    // El complejo no ve la bandeja del jugador ni viceversa.
    expect(await withTenant(f.ctx, (tx) => tx.inboxNotification.count({ where: { userId } }))).toBe(0);
  });
});

describe("regresión: contador de visitas de la ficha", () => {
  it("suma visitas (antes fallaba en silencio por leer una función void con $queryRaw)", async () => {
    const { trackProfileView } = await import("@/modules/marketplace/catalog");
    await trackProfileView(f.tenant.slug);
    await trackProfileView(f.tenant.slug);
    const row = await owner.tenantDailyView.findFirstOrThrow({ where: { tenantId: f.tenant.id } });
    expect(row.views).toBe(2);
  });
});
