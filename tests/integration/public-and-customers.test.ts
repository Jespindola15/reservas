import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/db/prisma";
import { bookingAccessToken, cancelBookingPublic, getPublicBooking, trackingPath } from "@/modules/booking/public-access";
import { createBooking } from "@/modules/booking/service";
import { getCustomer, listCustomers, updateCustomerNotes } from "@/modules/customers/service";
import { DAY, NOW, appRole, at, makeTenant, onlineInput, owner, publicActor, resetDb, type Fixture } from "../support/fixtures";

const opts = { now: NOW };

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

let f: Fixture;
let g: Fixture;

beforeEach(async () => {
  await resetDb();
  f = await makeTenant("publico-a");
  g = await makeTenant("publico-b");
});

afterAll(async () => {
  await prisma.$disconnect();
  await owner.$disconnect();
  await appRole.$disconnect();
});

describe("seguimiento público de la reserva", () => {
  it("con código + token muestra el estado sin datos personales completos", async () => {
    const r = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 7), publicActor, opts);
    const token = bookingAccessToken(r.booking.id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(trackingPath("publico-a", r.booking.code, r.booking.id)).toBe(`/publico-a/reserva/${r.booking.code}?t=${token}`);
    const view = await getPublicBooking("publico-a", r.booking.code, token, NOW);
    expect(view).toMatchObject({ code: r.booking.code, status: "CONFIRMED", firstName: "Jugador", canCancel: true });
    const json = JSON.stringify(view);
    expect(json).not.toContain("jugador7@example.com");
    expect(json).not.toContain("5555-0007");
  });

  it("conocer solo el código NO alcanza: token ausente, falso o de otra reserva da el mismo error", async () => {
    const r = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    const other = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "22:00"), 90, 2), publicActor, opts);
    await expectCode(getPublicBooking("publico-a", r.booking.code, ""), "INVALID_LINK");
    await expectCode(getPublicBooking("publico-a", r.booking.code, "A".repeat(43)), "INVALID_LINK");
    await expectCode(getPublicBooking("publico-a", r.booking.code, bookingAccessToken(other.booking.id)), "INVALID_LINK");
    await expectCode(getPublicBooking("publico-a", "ZZZZZZZZ", bookingAccessToken(r.booking.id)), "INVALID_LINK");
    await expectCode(cancelBookingPublic("publico-a", r.booking.code, "A".repeat(43), publicActor, NOW), "INVALID_LINK");
    // Enlace válido pero con el slug de OTRO complejo: tampoco.
    await expectCode(getPublicBooking("publico-b", r.booking.code, bookingAccessToken(r.booking.id)), "INVALID_LINK");
    expect((await owner.booking.findUniqueOrThrow({ where: { id: r.booking.id } })).status).toBe("CONFIRMED");
  });

  it("el jugador cancela con su enlace dentro del plazo; fuera de plazo no puede", async () => {
    const r = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    const token = bookingAccessToken(r.booking.id);
    // Plazo: 120 min antes del inicio.
    await expectCode(cancelBookingPublic("publico-a", r.booking.code, token, publicActor, at(DAY, "18:30")), "CANCELLATION_WINDOW_CLOSED");
    await cancelBookingPublic("publico-a", r.booking.code, token, publicActor, NOW);
    expect((await owner.booking.findUniqueOrThrow({ where: { id: r.booking.id } })).status).toBe("CANCELLED");
    expect(await owner.courtAllocation.count({ where: { bookingId: r.booking.id } })).toBe(0);
    await expectCode(cancelBookingPublic("publico-a", r.booking.code, token, publicActor, NOW), "BOOKING_CLOSED");
    expect(await owner.auditLog.count({ where: { entityId: r.booking.id, action: "booking.public_cancelled", actorType: "PUBLIC" } })).toBe(1);
    expect((await getPublicBooking("publico-a", r.booking.code, token, NOW)).canCancel).toBe(false);
  });

  it("una solicitud vencida figura como vencida y no se puede cancelar", async () => {
    const h = await makeTenant("publico-c", { requiresApproval: true });
    const r = await createBooking(h.ctx, onlineInput(h.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    await owner.$executeRaw`UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = ${r.booking.id}::uuid`;
    const token = bookingAccessToken(r.booking.id);
    expect((await getPublicBooking("publico-c", r.booking.code, token, NOW)).status).toBe("EXPIRED");
    await expectCode(cancelBookingPublic("publico-c", r.booking.code, token, publicActor, NOW), "BOOKING_EXPIRED");
  });
});

describe("clientes", () => {
  it("lista, busca por nombre/teléfono, cuenta cancelaciones y respeta el aislamiento", async () => {
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    const r2 = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "22:00"), 90, 2), publicActor, opts);
    await createBooking(g.ctx, onlineInput(g.court.id, at(DAY, "20:00"), 90, 3), publicActor, opts);
    await owner.booking.update({ where: { id: r2.booking.id }, data: { status: "CANCELLED" } });

    const all = await listCustomers(f.ctx, {});
    expect(all.total).toBe(2);
    expect(all.rows.map((r) => r.email).sort()).toEqual(["jugador1@example.com", "jugador2@example.com"]);
    expect(all.rows.find((r) => r.email === "jugador2@example.com")!.cancellations).toBe(1);
    expect((await listCustomers(f.ctx, { q: "jugador 1" })).total).toBe(1);
    expect((await listCustomers(f.ctx, { q: "5555-0002" })).total).toBe(1);
    expect((await listCustomers(f.ctx, { q: "%" })).total).toBe(2);
    // El cliente del complejo B no aparece en A, ni buscándolo.
    expect((await listCustomers(f.ctx, { q: "jugador3" })).total).toBe(0);
    const foreign = await owner.customer.findFirstOrThrow({ where: { tenantId: g.tenant.id } });
    await expectCode(getCustomer(f.ctx, foreign.id), "NOT_FOUND");
    await expectCode(updateCustomerNotes(f.ctx, foreign.id, "x", publicActor), "NOT_FOUND");
  });

  it("ficha del cliente con historial y observaciones auditadas", async () => {
    const r = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    await createBooking(f.ctx, onlineInput(f.court2.id, at("2030-03-06", "20:00"), 90, 1), publicActor, opts);
    const customerId = (await owner.booking.findUniqueOrThrow({ where: { id: r.booking.id } })).customerId;
    await updateCustomerNotes(f.ctx, customerId, "Prefiere cancha 2", publicActor);
    const d = await getCustomer(f.ctx, customerId);
    expect(d.customer.notes).toBe("Prefiere cancha 2");
    expect(d.stats.total).toBe(2);
    expect(await owner.auditLog.count({ where: { entityId: customerId, action: "customer.notes.updated" } })).toBe(1);
  });
});
