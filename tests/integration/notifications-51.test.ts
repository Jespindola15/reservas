import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createBooking } from "@/modules/booking/service";
import { bookingAccessToken, reportTransferByLink } from "@/modules/booking/public-access";
import { expirePendingBookings } from "@/modules/jobs/expire-pending";
import { processNotifications } from "@/modules/notifications/processor";
import { MemoryProvider } from "@/modules/notifications/providers";
import { confirmTransfer, openIncident, rejectTransfer, updatePaymentSettings } from "@/modules/payments/transfers";
import { DAY, NOW, at, makeTenant, makeUser, onlineInput, owner, publicActor, resetDb, type Fixture } from "../support/fixtures";

let f: Fixture;
let mem: MemoryProvider;
let ownerActor: { type: "USER"; userId: string };
const later = new Date(NOW.getTime() + 60_000);

beforeEach(async () => {
  await resetDb();
  f = await makeTenant("not51");
  await owner.tenant.update({ where: { id: f.tenant.id }, data: { contactEmail: "dueno@not51.test", notifyOwner: true } });
  const u = await makeUser("dueno@not51.test", { tenantId: f.tenant.id, role: "OWNER" });
  ownerActor = { type: "USER", userId: u.id };
  await updatePaymentSettings(f.ctx, { alias: "cancha.not51", holderName: "Complejo Not SRL", transferWindowMinutes: 30, reviewWindowMinutes: 120, depositType: "FIXED", depositValue: 5000 }, ownerActor);
  mem = new MemoryProvider();
});
afterAll(async () => { await prisma.$disconnect(); await owner.$disconnect(); });

const kinds = async () => (await owner.notification.findMany({ orderBy: { createdAt: "asc" }, select: { kind: true } })).map((n) => n.kind);

describe("emails de la Fase 5.1 (plantillas listas; se envían solo con proveedor activo)", () => {
  it("solicitud con transferencia → informada → confirmada: un email por evento, sin duplicados", async () => {
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, { now: NOW });
    expect(await kinds()).toEqual(expect.arrayContaining(["booking_awaiting_transfer", "owner_new_request"]));
    // Se procesa en cada paso, como lo hace la tarea programada: un aviso ya desactualizado no se envía.
    await processNotifications({ provider: mem, now: NOW });
    await reportTransferByLink(f.tenant.slug, booking.code, bookingAccessToken(booking.id), "445566", publicActor, later);
    await reportTransferByLink(f.tenant.slug, booking.code, bookingAccessToken(booking.id), "445566", publicActor, later).catch(() => undefined);
    expect((await kinds()).filter((k) => k === "owner_transfer_reported")).toHaveLength(1);
    await processNotifications({ provider: mem, now: later });
    const row = await owner.booking.findUniqueOrThrow({ where: { id: booking.id } });
    await confirmTransfer(f.ctx, { bookingId: booking.id, expectedVersion: row.version, receivedAmount: String(row.amountDue! / 100) }, ownerActor, later);

    const s1 = await processNotifications({ provider: mem, now: later });
    expect(s1.failed ?? 0).toBe(0);
    const s2 = await processNotifications({ provider: mem, now: later });
    expect(s2.claimed).toBe(0);
    const subjects = mem.sent.map((m) => `${m.to}: ${m.subject}`).join(" | ");
    const awaiting = mem.sent.find((m) => /no está confirmado/i.test(m.subject) && m.to === "jugador1@example.com")!;
    expect(awaiting.html).toContain("cancha.not51");
    expect(awaiting.html).not.toMatch(/devoluci[oó]n autom[aá]tica/i);
    expect(subjects).toMatch(/confirmad/i);
    expect(mem.sent.some((m) => m.to === "dueno@not51.test" && /informó|informada/i.test(m.subject))).toBe(true);
  });

  it("rechazo, incidencia y vencimiento generan su email; los avisos internos no dependen del proveedor", async () => {
    const a = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, { now: NOW });
    const b = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "22:00"), 60, 2), publicActor, { now: NOW });
    const ra = await owner.booking.findUniqueOrThrow({ where: { id: a.booking.id } });
    await rejectTransfer(f.ctx, { bookingId: a.booking.id, expectedVersion: ra.version, reason: "No recibimos la transferencia", moneyReceived: true, receivedAmount: "5000" }, ownerActor, later);
    await openIncident(f.ctx, { bookingId: b.booking.id, kind: "OTHER", notes: "Revisar" }, ownerActor);
    await owner.booking.update({ where: { id: b.booking.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expirePendingBookings();
    const k = await kinds();
    expect(k).toEqual(expect.arrayContaining(["booking_cancelled", "owner_payment_incident", "booking_expired"]));
    // Sin proveedor (EMAIL_PROVIDER desactivado) los emails quedan pendientes, pero el aviso interno existe igual.
    expect(await owner.inboxNotification.count({ where: { tenantId: f.tenant.id } })).toBeGreaterThan(0);
    await processNotifications({ provider: mem, now: later });
    expect(mem.sent.some((m) => /rechaz|cancelad/i.test(m.subject))).toBe(true);
    expect(mem.sent.some((m) => /venci/i.test(m.subject))).toBe(true);
    expect(mem.sent.some((m) => /incidencia/i.test(m.subject))).toBe(true);
  });
});
