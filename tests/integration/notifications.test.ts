import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { changeBookingStatus, createBooking, rescheduleBooking } from "@/modules/booking/service";
import { processNotifications, scheduleTimedNotifications, MAX_ATTEMPTS } from "@/modules/notifications/processor";
import { MemoryProvider, ResendProvider, sanitizeError } from "@/modules/notifications/providers";
import { DAY, NOW, at, makeTenant, makeUser, onlineInput, owner, publicActor, resetDb, type Fixture } from "../support/fixtures";

const opts = { now: NOW };
let f: Fixture;
let mem: MemoryProvider;

async function notifs() {
  return owner.notification.findMany({ orderBy: { createdAt: "asc" }, select: { kind: true, recipient: true, status: true, attempts: true, dedupeKey: true, lastError: true, payload: true } });
}
/** Vuelve a dejar disponibles los reintentos programados (simula el paso del tiempo). */
async function makeDue() {
  await owner.$executeRawUnsafe(`UPDATE notifications SET next_attempt_at = now() - interval '1 second' WHERE status = 'PENDING'`);
}

beforeEach(async () => {
  await resetDb();
  f = await makeTenant("notif");
  await owner.tenant.update({ where: { id: f.tenant.id }, data: { contactEmail: "Dueno@Complejo.test", notifyOwner: true } });
  mem = new MemoryProvider();
});
afterAll(async () => {
  await prisma.$disconnect();
  await owner.$disconnect();
});

describe("outbox de notificaciones", () => {
  it("una reserva online genera aviso al jugador y al dueño, y se envían una sola vez", async () => {
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    const rows = await notifs();
    expect(rows.map((r) => r.kind).sort()).toEqual(["booking_confirmed", "owner_new_request"].sort());
    expect(rows.find((r) => r.kind === "owner_new_request")!.recipient).toBe("dueno@complejo.test");

    const s1 = await processNotifications({ provider: mem, now: NOW });
    expect(s1.sent).toBe(2);
    const s2 = await processNotifications({ provider: mem, now: NOW });
    expect(s2.claimed).toBe(0);
    expect(mem.sent).toHaveLength(2);
    const toPlayer = mem.sent.find((m) => m.to === "jugador1@example.com")!;
    expect(toPlayer.subject).toMatch(/confirmad/i);
    expect(toPlayer.html).toContain("TURNUP");
    // El enlace de seguimiento se arma al enviar y nunca queda guardado en la base.
    expect(toPlayer.html).toMatch(/\/notif\/reserva\//);
    for (const r of await notifs()) expect(r.payload).toBeNull();
  });

  it("los eventos repetidos no duplican notificaciones (clave de deduplicación única)", async () => {
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    await owner.$transaction(async (tx) => {
      const { enqueueBookingEvent } = await import("@/modules/notifications/outbox");
      await enqueueBookingEvent(tx, f.tenant.id, booking.id, { type: "created" });
      await enqueueBookingEvent(tx, f.tenant.id, booking.id, { type: "created" });
    });
    expect((await notifs()).length).toBe(2);
  });

  it("procesadores simultáneos no envían dos veces la misma notificación (SKIP LOCKED)", async () => {
    for (let i = 0; i < 6; i++) await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, ["08:00", "09:30", "18:00", "19:30", "21:00", "22:30"][i]!), 90, i + 1), publicActor, opts);
    const total = (await notifs()).length;
    const results = await Promise.all([1, 2, 3, 4].map(() => processNotifications({ provider: mem, now: NOW, batchSize: 5 })));
    const again = await processNotifications({ provider: mem, now: NOW });
    const sent = results.reduce((a, r) => a + r.sent, 0) + again.sent;
    expect(sent).toBe(total);
    expect(mem.sent).toHaveLength(total);
    expect(new Set(mem.sent.map((m) => m.idempotencyKey)).size).toBe(total);
  });

  it("errores temporales se reintentan con espera; los definitivos quedan FAILED sin bloquear la reserva", async () => {
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    mem.failNext(2, true, "503 upstream");
    const s1 = await processNotifications({ provider: mem, now: NOW });
    expect(s1.retried).toBe(2);
    let rows = await notifs();
    expect(rows.every((r) => r.status === "PENDING" && r.attempts === 1 && r.lastError === "503 upstream")).toBe(true);
    // Todavía no venció la espera: no se reintenta.
    expect((await processNotifications({ provider: mem, now: NOW })).claimed).toBe(0);
    await makeDue();
    expect((await processNotifications({ provider: mem, now: NOW })).sent).toBe(2);

    // Error permanente (p. ej. 422 dirección inválida): no se reintenta.
    await owner.notification.updateMany({ data: { status: "PENDING", nextAttemptAt: new Date(0), attempts: 0 } });
    mem.failNext(2, false, "422 invalid recipient");
    const s3 = await processNotifications({ provider: mem, now: NOW });
    expect(s3.failed).toBe(2);
    rows = await notifs();
    expect(rows.every((r) => r.status === "FAILED")).toBe(true);
    expect(await owner.booking.count()).toBe(1);
  });

  it(`deja de reintentar después de ${MAX_ATTEMPTS} intentos`, async () => {
    await createBooking(f.ctx, { ...onlineInput(f.court.id, at(DAY, "20:00")), customer: { name: "Sin dueño", phone: "11 4444-0000", email: "x@example.com" } }, publicActor, opts);
    await owner.tenant.update({ where: { id: f.tenant.id }, data: { notifyOwner: false } });
    await owner.notification.deleteMany({ where: { kind: "owner_new_request" } });
    mem.failNext(MAX_ATTEMPTS + 2, true, "timeout");
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await makeDue();
      await processNotifications({ provider: mem, now: NOW });
    }
    const [row] = await notifs();
    expect(row!.status).toBe("FAILED");
    expect(row!.attempts).toBe(MAX_ATTEMPTS);
  });

  it("respeta la configuración: sin notificaciones o sin proveedor, se marcan SKIPPED", async () => {
    await owner.tenant.update({ where: { id: f.tenant.id }, data: { notificationsEnabled: false } });
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    await processNotifications({ provider: mem, now: NOW });
    expect(mem.sent).toHaveLength(0);
    expect((await notifs()).every((r) => r.status === "SKIPPED")).toBe(true);

    await resetDb();
    f = await makeTenant("notif2");
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    const s = await processNotifications({ provider: null, now: NOW });
    expect(s.skipped).toBeGreaterThan(0);
    expect((await notifs()).every((r) => r.status === "SKIPPED" && r.lastError === "email_disabled")).toBe(true);
  });

  it("un aviso viejo no se envía si la reserva cambió (p. ej. cancelada antes de enviar)", async () => {
    const t = await makeTenant("aprob", { requiresApproval: true });
    const { booking } = await createBooking(t.ctx, onlineInput(t.court.id, at(DAY, "20:00")), publicActor, opts);
    const admin = await makeUser("admin@aprob.test", { tenantId: t.tenant.id, role: "ADMIN" });
    await changeBookingStatus({ tenantId: t.tenant.id, userId: admin.id }, { bookingId: booking.id, to: "CANCELLED", expectedVersion: booking.version }, { type: "USER", userId: admin.id }, opts);
    await processNotifications({ provider: mem, now: NOW });
    const rows = await notifs();
    expect(rows.find((r) => r.kind === "booking_requested")!.status).toBe("SKIPPED");
    expect(rows.find((r) => r.kind === "booking_cancelled")!.status).toBe("SENT");
  });

  it("reprogramar avisa al jugador y el recordatorio se programa una sola vez por horario", async () => {
    const admin = await makeUser("admin@notif.test", { tenantId: f.tenant.id, role: "ADMIN" });
    const actx = { tenantId: f.tenant.id, userId: admin.id };
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    const moved = await rescheduleBooking(actx, { bookingId: booking.id, courtId: f.court2.id, startsAt: at(DAY, "21:30"), durationMinutes: 90, expectedVersion: booking.version }, { type: "USER", userId: admin.id }, opts);
    expect((await notifs()).some((r) => r.kind === "booking_rescheduled")).toBe(true);

    // La reserva se hizo con menos de 26 h: no hay recordatorio de 24 h, solo el de 2 h.
    await owner.booking.update({ where: { id: booking.id }, data: { createdAt: new Date(moved.startsAt.getTime() - 10 * 3_600_000) } });
    const before = new Date(moved.startsAt.getTime() - 2 * 3_600_000 + 60_000);
    await scheduleTimedNotifications(before);
    await scheduleTimedNotifications(before);
    const reminders = (await notifs()).filter((r) => r.kind.startsWith("booking_reminder"));
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.kind).toBe("booking_reminder_2h");
    expect(reminders[0]!.dedupeKey).toContain(moved.startsAt.toISOString());
  });
});

describe("proveedores", () => {
  it("Resend: envía con Idempotency-Key y clasifica errores (sin llamar a la red real)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "re_123" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const p = new ResendProvider("re_test_key", "TURNUP <no-reply@turnup.invalid>");
      const ok = await p.send({ to: "a@example.com", subject: "s", html: "<p>h</p>", text: "h", idempotencyKey: "n-1" });
      expect(ok).toEqual({ ok: true, providerMessageId: "re_123" });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.resend.com/emails");
      expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("n-1");

      fetchMock.mockResolvedValueOnce(new Response("{}", { status: 429 }));
      expect(await p.send({ to: "a@example.com", subject: "s", html: "h", text: "h", idempotencyKey: "n-2" })).toMatchObject({ ok: false, retryable: true });
      fetchMock.mockResolvedValueOnce(new Response('{"message":"invalid"}', { status: 422 }));
      expect(await p.send({ to: "a@example.com", subject: "s", html: "h", text: "h", idempotencyKey: "n-3" })).toMatchObject({ ok: false, retryable: false });
      fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
      expect(await p.send({ to: "a@example.com", subject: "s", html: "h", text: "h", idempotencyKey: "n-4" })).toMatchObject({ ok: false, retryable: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("los errores guardados no contienen claves ni tokens", () => {
    const out = sanitizeError("fail re_abcdefghijklmnop Bearer xyz.abc token=SECRET123 https://x.test/restablecer?token=abcdefabcdef");
    expect(out).not.toMatch(/re_abcdefghijklmnop|SECRET123|abcdefabcdef|xyz\.abc/);
  });
});
