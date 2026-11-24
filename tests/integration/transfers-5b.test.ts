import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { authorizeTenantAccess } from "@/modules/access/authorize";
import { changeBookingStatus, createBooking } from "@/modules/booking/service";
import { listPlayerInbox, listTenantInbox, panelBadges, panelLink } from "@/modules/inbox/service";
import { expirePendingBookings } from "@/modules/jobs/expire-pending";
import { tick } from "@/modules/jobs/runner";
import { confirmTransfer, updatePaymentSettings } from "@/modules/payments/transfers";
import { reportTransferByLink, bookingAccessToken } from "@/modules/booking/public-access";
import { registerPlayer } from "@/modules/player/account";
import { DAY, NOW, at, makeTenant, makeUser, onlineInput, owner, publicActor, resetDb, type Fixture } from "../support/fixtures";

const opts = { now: NOW };
let f: Fixture;
let ownerActor: { type: "USER"; userId: string };

beforeEach(async () => {
  await resetDb();
  f = await makeTenant("tr5b");
  const u = await makeUser("dueno@tr5b.test", { tenantId: f.tenant.id, role: "OWNER" });
  ownerActor = { type: "USER", userId: u.id };
  await updatePaymentSettings(f.ctx, { alias: "complejo.mp", holderName: "Complejo SRL", transferWindowMinutes: 30, reviewWindowMinutes: 120, depositType: "FIXED", depositValue: 5000 }, ownerActor);
});
afterAll(async () => { await prisma.$disconnect(); await owner.$disconnect(); });

describe("Fase 5: transferencias — reglas adicionales", () => {
  it("la acción genérica 'Confirmar' no puede saltear la verificación del pago", async () => {
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    await expect(changeBookingStatus(f.ctx, { bookingId: booking.id, to: "CONFIRMED", expectedVersion: booking.version }, ownerActor, opts))
      .rejects.toMatchObject({ code: "TRANSFER_VERIFY_REQUIRED" });
    // Rechazar o cancelar sí se puede por la vía general.
    await changeBookingStatus(f.ctx, { bookingId: booking.id, to: "CANCELLED", expectedVersion: booking.version, reason: "Pedido del jugador" }, ownerActor, opts);
  });

  it("solo el dueño cambia datos bancarios; un administrador o personal no", async () => {
    const admin = await makeUser("admin@tr5b.test", { tenantId: f.tenant.id, role: "ADMIN" });
    const staff = await makeUser("staff@tr5b.test", { tenantId: f.tenant.id, role: "STAFF" });
    await expect(authorizeTenantAccess(admin, f.tenant.slug, "payments.configure")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(authorizeTenantAccess(staff, f.tenant.slug, "payments.verify")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(authorizeTenantAccess(admin, f.tenant.slug, "payments.verify")).resolves.toBeTruthy();
  });

  it("el jugador no puede confirmar su propia transferencia: informar no confirma", async () => {
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    const token = bookingAccessToken(booking.id);
    const r = await reportTransferByLink(f.tenant.slug, booking.code, token, "123456", publicActor, new Date(NOW.getTime() + 60_000));
    expect(r.status).toBe("reported");
    const row = await owner.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row).toMatchObject({ status: "PENDING", paymentStatus: "TRANSFER_REPORTED", paymentVerifiedAt: null, transferReference: "123456" });
    // Con un token inválido no se puede informar nada.
    await expect(reportTransferByLink(f.tenant.slug, booking.code, "x".repeat(43), null, publicActor, NOW)).rejects.toBeTruthy();
  });

  it("vencimiento de una transferencia informada avisa al complejo y al jugador; la alerta previa sale una sola vez", async () => {
    const { userId } = await registerPlayer({ name: "Ana Gómez", email: "ana@tr5b.test", password: "una-clave-de-jugador-1", acceptTerms: true }, "10.2.2.2");
    const a = await createBooking(f.ctx, { ...onlineInput(f.court.id, at(DAY, "20:00")), playerUserId: userId }, publicActor, opts);
    const b = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "22:00"), 60, 2), publicActor, opts);
    await reportTransferByLink(f.tenant.slug, a.booking.code, bookingAccessToken(a.booking.id), null, publicActor, new Date(NOW.getTime() + 60_000));
    await reportTransferByLink(f.tenant.slug, b.booking.code, bookingAccessToken(b.booking.id), null, publicActor, new Date(NOW.getTime() + 60_000));

    // b: le quedan 20 minutos (reales) de revisión -> alerta previa, una sola vez.
    await owner.booking.update({ where: { id: b.booking.id }, data: { expiresAt: new Date(Date.now() + 20 * 60_000) } });
    await tick();
    await tick();
    const inbox1 = await listTenantInbox(f.ctx, 50);
    expect(inbox1.rows.filter((n) => n.kind === "transfer_review_due")).toHaveLength(1);

    // a: venció sin revisar -> EXPIRED, aviso al complejo (puede haber dinero) y al jugador.
    await owner.booking.update({ where: { id: a.booking.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await expirePendingBookings();
    expect((await owner.booking.findUniqueOrThrow({ where: { id: a.booking.id } })).status).toBe("EXPIRED");
    const inbox2 = await listTenantInbox(f.ctx, 50);
    expect(inbox2.rows.some((n) => n.kind === "transfer_review_expired")).toBe(true);
    expect((await listPlayerInbox(userId)).rows.some((n) => n.kind === "booking_expired")).toBe(true);
    // Una reserva vencida ya no se puede confirmar (nunca se confirma un turno liberado).
    const row = await owner.booking.findUniqueOrThrow({ where: { id: a.booking.id } });
    await expect(confirmTransfer(f.ctx, { bookingId: a.booking.id, expectedVersion: row.version, receivedAmount: "50" }, ownerActor)).rejects.toMatchObject({ code: "ALREADY_PROCESSED" });
  });

  it("contadores de navegación y enlaces de avisos del panel", async () => {
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    await reportTransferByLink(f.tenant.slug, booking.code, bookingAccessToken(booking.id), null, publicActor, new Date(NOW.getTime() + 60_000));
    const badges = await panelBadges(f.ctx);
    expect(badges.transfers).toBe(1);
    expect(badges.unread).toBeGreaterThanOrEqual(2);
    expect(panelLink("mi-complejo", "/transferencias")).toBe("/panel/mi-complejo/transferencias");
    expect(panelLink("mi-complejo", null)).toBeNull();
  });
});
