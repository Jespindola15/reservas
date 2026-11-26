import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getAuth } from "@/lib/auth/auth";
import { withSystem } from "@/lib/db/tenant-context";
import { createBooking } from "@/modules/booking/service";
import { bookingAccessToken, reportTransferByLink } from "@/modules/booking/public-access";
import { enqueue, KIND_PRIORITY, PLAYER_KINDS, OWNER_KINDS, ACCOUNT_KINDS, ADMIN_KINDS } from "@/modules/notifications/outbox";
import { applyDeliveryEvents, webhookAuthorized } from "@/modules/notifications/delivery";
import { processNotifications, scheduleTimedNotifications } from "@/modules/notifications/processor";
import { BrevoProvider, MemoryProvider, sanitizeError } from "@/modules/notifications/providers";
import { capFor, quotaUsage, releaseQuota, reserveQuota, quotaDay } from "@/modules/notifications/quota";
import { renderNotification } from "@/modules/notifications/render";
import { confirmTransfer, rejectTransfer, updatePaymentSettings } from "@/modules/payments/transfers";
import { registerPlayer, sendPlayerOnboardingEmails } from "@/modules/player/account";
import { emailDashboard, retryEmail, sendTestEmail } from "@/modules/platform/emails";
import { createTenant } from "@/modules/platform/service";
import { DAY, NOW, at, makeTenant, makeUser, onlineInput, owner, publicActor, resetDb, type Fixture } from "../support/fixtures";

let f: Fixture;
let mem: MemoryProvider;
let ownerActor: { type: "USER"; userId: string };
const later = new Date(NOW.getTime() + 60_000);

const rows = () => owner.notification.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, kind: true, status: true, attempts: true, lastError: true, recipient: true, priority: true, provider: true } });
const setQuotaUsed = (n: number) =>
  owner.$executeRawUnsafe(`INSERT INTO rate_limits (key, window_start, count) VALUES ('email-quota:${quotaDay()}', now(), ${n}) ON CONFLICT (key) DO UPDATE SET count = ${n}`);

beforeEach(async () => {
  await resetDb();
  f = await makeTenant("mail6");
  await owner.tenant.update({ where: { id: f.tenant.id }, data: { contactEmail: "dueno@mail6.test", notifyOwner: true, contactPhone: "11 5555-0000" } });
  const u = await makeUser("dueno@mail6.test", { tenantId: f.tenant.id, role: "OWNER" });
  ownerActor = { type: "USER", userId: u.id };
  mem = new MemoryProvider();
});
afterAll(async () => {
  await prisma.$disconnect();
  await owner.$disconnect();
});

describe("Brevo (API transaccional, sin llamar a la red real)", () => {
  const msg = { to: "a@example.com", subject: "Hola", html: "<p>h</p>", text: "h", idempotencyKey: "6f1c2b7e-1d1a-4a59-9d1e-3b0f6f6a0a11", replyTo: "club@example.com", tag: "booking_confirmed" };

  it("envía con api-key, remitente, idempotencyKey, etiqueta y respuesta al complejo", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messageId: "<abc@smtp-relay.mailin.fr>" }), { status: 201 }));
    const p = new BrevoProvider("xkeysib-secreta-123", { email: "turnup@gmail.com", name: "TURNUP" }, fetchMock as unknown as typeof fetch);
    expect(await p.send(msg)).toEqual({ ok: true, providerMessageId: "<abc@smtp-relay.mailin.fr>" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-secreta-123");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ sender: { email: "turnup@gmail.com", name: "TURNUP" }, to: [{ email: "a@example.com" }], replyTo: { email: "club@example.com" }, subject: "Hola", tags: ["booking_confirmed"], headers: { idempotencyKey: msg.idempotencyKey } });
    expect(body.htmlContent).toBe("<p>h</p>");
    expect(body.textContent).toBe("h");
  });

  it("clasifica las respuestas: temporal, permanente, cuenta caída y duplicado", async () => {
    const make = (status: number, body: unknown) => new BrevoProvider("xkeysib-k", { email: "a@b.co", name: "T" }, (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch);
    expect(await make(429, { code: "too_many_requests" }).send(msg)).toMatchObject({ ok: false, retryable: true });
    expect(await make(503, {}).send(msg)).toMatchObject({ ok: false, retryable: true });
    expect(await make(400, { code: "invalid_parameter", message: "email is not valid" }).send(msg)).toMatchObject({ ok: false, retryable: false });
    expect(await make(401, { code: "unauthorized", message: "Key not found" }).send(msg)).toMatchObject({ ok: false, providerDown: true });
    expect(await make(400, { code: "not_enough_credits", message: "Insufficient credits" }).send(msg)).toMatchObject({ ok: false, providerDown: true });
    expect(await make(400, { code: "duplicate_parameter", message: "dup" }).send(msg)).toMatchObject({ ok: true, duplicate: true });
    const net = new BrevoProvider("xkeysib-k", { email: "a@b.co", name: "T" }, (async () => { throw new Error("ECONNRESET xkeysib-filtrada-999"); }) as unknown as typeof fetch);
    const r = await net.send(msg);
    expect(r).toMatchObject({ ok: false, retryable: true });
    expect(JSON.stringify(r)).not.toContain("xkeysib-filtrada");
    expect(sanitizeError("api-key xkeysib-abc123-def para pepe@gmail.com")).not.toMatch(/xkeysib-abc|pepe@gmail/);
  });
});

describe("cupo diario persistente con reserva para lo crítico", () => {
  it("cada prioridad respeta su tope y la crítica usa el cupo completo", async () => {
    const limit = 300;
    expect(capFor(1, limit)).toBe(300);
    expect(capFor(5, limit)).toBeLessThan(capFor(4, limit));
    expect(capFor(4, limit)).toBeLessThan(capFor(2, limit));
    await setQuotaUsed(capFor(5, limit));
    expect(await reserveQuota(5)).toBeNull();
    expect(await reserveQuota(1)).toBe(capFor(5, limit) + 1);
    await releaseQuota();
    expect((await quotaUsage()).used).toBe(capFor(5, limit));
  });

  it("es atómico: 40 reservas simultáneas nunca superan el tope", async () => {
    const cap = capFor(5);
    await setQuotaUsed(cap - 10);
    const res = await Promise.all(Array.from({ length: 40 }, () => reserveQuota(5)));
    expect(res.filter((r) => r !== null)).toHaveLength(10);
    expect((await quotaUsage()).used).toBe(cap);
  });

  it("sin cupo: lo útil se aplaza al día siguiente, los recordatorios se descartan y lo crítico sale", async () => {
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, { now: NOW });
    await withSystem(async (tx) => {
      await enqueue(tx, { tenantId: f.tenant.id, kind: "booking_reminder_2h", recipient: "jugador1@example.com", dedupeKey: "t:rem", bookingId: booking.id, payload: { startsAt: booking.startsAt.toISOString() } });
    });
    await setQuotaUsed(capFor(2)); // agotado para todo salvo prioridad 1
    const s = await processNotifications({ provider: mem, now: NOW });
    const r = await rows();
    expect(r.find((x) => x.kind === "booking_reminder_2h")).toMatchObject({ status: "SKIPPED", lastError: "quota_exhausted" });
    const deferred = r.filter((x) => x.kind !== "booking_reminder_2h");
    expect(deferred.every((x) => x.status === "PENDING" && x.attempts === 0 && x.lastError?.startsWith("quota_exhausted"))).toBe(true);
    expect(s.deferred).toBe(deferred.length);
    expect(mem.sent).toHaveLength(0);
    // Un email crítico (verificación) sí sale con el cupo reservado.
    await withSystem((tx) => enqueue(tx, { tenantId: null, kind: "admin_test", recipient: "dueno@mail6.test", dedupeKey: "t:crit" }));
    await processNotifications({ provider: mem, now: NOW });
    expect(mem.sent.map((m) => m.subject)).toEqual(["Correo de prueba de TURNUP"]);
  });
});

describe("procesamiento confiable", () => {
  it("si la cuenta del proveedor no puede enviar, se corta el lote sin gastar intentos ni cupo y se avisa una vez", async () => {
    await makeUser("super@mail6.test", { platformRole: "SUPERADMIN" });
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, { now: NOW });
    mem.failNext(1, true, "brevo 401 unauthorized", true);
    const s = await processNotifications({ provider: mem, now: NOW });
    expect(s.providerDown).toBe(true);
    const r = await rows();
    const booking = r.filter((x) => !x.kind.startsWith("admin_"));
    expect(booking.every((x) => x.status === "PENDING" && x.attempts === 0)).toBe(true);
    expect(r.filter((x) => x.kind === "admin_email_failures")).toHaveLength(1);
    expect((await quotaUsage()).used).toBe(0);
    // La reserva existe igual: el correo nunca bloquea la operación.
    expect(await owner.booking.count()).toBe(1);
    // Una segunda caída el mismo día no genera otra alerta.
    await owner.$executeRawUnsafe(`UPDATE notifications SET next_attempt_at = now() - interval '1 second' WHERE status = 'PENDING'`);
    mem.failNext(1, true, "brevo 401 unauthorized", true);
    await processNotifications({ provider: mem, now: NOW });
    expect((await rows()).filter((x) => x.kind === "admin_email_failures")).toHaveLength(1);
  });

  it("registra proveedor e id del mensaje y usa la prioridad para el orden", async () => {
    await withSystem(async (tx) => {
      await enqueue(tx, { tenantId: null, kind: "admin_test", recipient: "dueno@mail6.test", dedupeKey: "t:1" });
    });
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, { now: NOW });
    await processNotifications({ provider: mem, now: NOW, batchSize: 1 });
    expect(mem.sent[0]!.subject).toBe("Correo de prueba de TURNUP"); // prioridad 1 primero
    const sent = (await rows()).find((x) => x.status === "SENT")!;
    expect(sent.provider).toBe("memory");
    expect(sent.priority).toBe(KIND_PRIORITY.admin_test);
  });

  it("webhook: solo avanza el estado de entrega y exige el secreto", async () => {
    await withSystem((tx) => enqueue(tx, { tenantId: null, kind: "admin_test", recipient: "dueno@mail6.test", dedupeKey: "t:w" }));
    await processNotifications({ provider: mem, now: NOW });
    const n = await owner.notification.findFirstOrThrow({ where: { dedupeKey: "t:w" } });
    await owner.notification.update({ where: { id: n.id }, data: { providerMessageId: "<m1@relay>" } });
    expect(await applyDeliveryEvents([{ event: "delivered", "message-id": "<m1@relay>" }])).toBe(1);
    await applyDeliveryEvents([{ event: "deferred", "message-id": "<m1@relay>" }]); // tardío: no retrocede
    expect((await owner.notification.findUniqueOrThrow({ where: { id: n.id } })).deliveryStatus).toBe("delivered");
    await applyDeliveryEvents([{ event: "hard_bounce", "message-id": "<otro@relay>" }]);
    expect((await owner.notification.findUniqueOrThrow({ where: { id: n.id } })).deliveryStatus).toBe("delivered");
    const secret = "s".repeat(32);
    expect(webhookAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(webhookAuthorized(`Basic ${Buffer.from(`brevo:${secret}`).toString("base64")}`, secret)).toBe(true);
    expect(webhookAuthorized("Bearer otro", secret)).toBe(false);
    expect(webhookAuthorized(null, secret)).toBe(false);
  });
});

describe("eventos de reserva y transferencias", () => {
  beforeEach(async () => {
    await updatePaymentSettings(f.ctx, { alias: "cancha.mail6", holderName: "Complejo Mail SRL", transferWindowMinutes: 30, reviewWindowMinutes: 120, depositType: "FIXED", depositValue: 500 }, ownerActor);
  });

  it("transferencia: instrucciones → informada (jugador y complejo) → pago aprobado, sin duplicar la confirmación", async () => {
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, { now: NOW });
    await processNotifications({ provider: mem, now: NOW });
    await reportTransferByLink(f.tenant.slug, booking.code, bookingAccessToken(booking.id), "112233", publicActor, later);
    await processNotifications({ provider: mem, now: later });
    const row = await owner.booking.findUniqueOrThrow({ where: { id: booking.id } });
    await confirmTransfer(f.ctx, { bookingId: booking.id, expectedVersion: row.version, receivedAmount: String(row.amountDue! / 100) }, ownerActor, later);
    await processNotifications({ provider: mem, now: later });
    const toPlayer = mem.sent.filter((m) => m.to === "jugador1@example.com").map((m) => m.subject);
    expect(toPlayer).toEqual(["Transferí para confirmar tu turno", "Transferencia informada", "Pago aprobado: tu turno está confirmado"]);
    const approved = mem.sent.find((m) => m.subject.startsWith("Pago aprobado"))!;
    // Datos de la reserva, seña, saldo, estado, contacto y formatos argentinos.
    for (const t of ["Precio total", "Seña", "Saldo a pagar en el complejo", "Confirmada", "Código", "Duración", "11 5555-0000"]) expect(approved.html).toContain(t);
    expect(approved.text).toMatch(/Fecha: \w{3} \d{2}\/\d{2}\/\d{4}/);
    expect(approved.text).toMatch(/Horario: \d{2}:\d{2} a \d{2}:\d{2}/);
    expect(approved.replyTo).toBe("dueno@mail6.test");
    // El email de instrucciones lleva los datos para transferir; ninguno incluye "devolución automática".
    const instr = mem.sent.find((m) => m.subject === "Transferí para confirmar tu turno")!;
    expect(instr.html).toContain("cancha.mail6");
    for (const m of mem.sent) expect(m.html).not.toMatch(/devoluci[oó]n autom[aá]tica|undefined|NaN|\bnull\b/);
  });

  it("rechazo de la transferencia: un solo email de pago rechazado", async () => {
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, { now: NOW });
    const row = await owner.booking.findUniqueOrThrow({ where: { id: booking.id } });
    await rejectTransfer(f.ctx, { bookingId: booking.id, expectedVersion: row.version, reason: "No llegó el dinero", moneyReceived: false }, ownerActor, later);
    await processNotifications({ provider: mem, now: later });
    const subjects = mem.sent.filter((m) => m.to === "jugador1@example.com").map((m) => m.subject);
    expect(subjects).toContain("No se pudo verificar tu pago");
    expect(subjects.filter((s) => /cancelad|rechazad/i.test(s))).toHaveLength(0);
  });

  it("el complejo elige qué avisos recibir: los apagados no se envían", async () => {
    await owner.tenant.update({ where: { id: f.tenant.id }, data: { ownerEmailMuted: ["owner_new_request"] } });
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, { now: NOW });
    await processNotifications({ provider: mem, now: NOW });
    expect((await rows()).find((r) => r.kind === "owner_new_request")).toMatchObject({ status: "SKIPPED", lastError: "owner_muted" });
    expect(mem.sent.some((m) => m.to === "dueno@mail6.test")).toBe(false);
  });
});

describe("recordatorios de 24 h y 2 h", () => {
  it("solo reservas confirmadas, una vez por horario, nunca turnos pasados", async () => {
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, { now: NOW });
    const start = booking.startsAt.getTime();
    await owner.booking.update({ where: { id: booking.id }, data: { createdAt: new Date(start - 3 * 86_400_000) } });
    const pending = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "22:00"), 60, 2), publicActor, { now: NOW });
    await owner.booking.update({ where: { id: pending.booking.id }, data: { status: "PENDING", expiresAt: new Date(start - 86_400_000), createdAt: new Date(start - 3 * 86_400_000) } });

    const t24 = new Date(start - 23 * 3_600_000);
    await scheduleTimedNotifications(t24);
    await scheduleTimedNotifications(t24);
    const t2 = new Date(start - 90 * 60_000);
    await scheduleTimedNotifications(t2);
    await scheduleTimedNotifications(new Date(start + 60_000)); // ya empezó: nada
    const rem = (await rows()).filter((r) => r.kind.startsWith("booking_reminder"));
    expect(rem.map((r) => r.kind).sort()).toEqual(["booking_reminder_24h", "booking_reminder_2h"]);

    // Si el envío se atrasa hasta después del inicio, se descarta.
    await processNotifications({ provider: mem, now: new Date(start + 60_000) });
    expect((await rows()).filter((r) => r.kind.startsWith("booking_reminder")).every((r) => r.status === "SKIPPED")).toBe(true);
  });

  it("el jugador con cuenta puede desactivar los recordatorios", async () => {
    const player = await makeUser("jugador1@example.com");
    await owner.playerProfile.create({ data: { userId: player.id, notifyReminders: false } });
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, { now: NOW });
    await owner.booking.update({ where: { id: booking.id }, data: { playerUserId: player.id, createdAt: new Date(booking.startsAt.getTime() - 86_400_000 * 3) } });
    await scheduleTimedNotifications(new Date(booking.startsAt.getTime() - 90 * 60_000));
    await processNotifications({ provider: mem, now: new Date(booking.startsAt.getTime() - 89 * 60_000) });
    expect((await rows()).find((r) => r.kind === "booking_reminder_2h")).toMatchObject({ status: "SKIPPED", lastError: "player_no_reminders" });
  });
});

describe("cuentas: bienvenida, verificación y superadmin", () => {
  it("registro: bienvenida + verificación; el enlace verifica la cuenta y no bloquea a quien no verificó", async () => {
    const { userId } = await registerPlayer({ name: "Ana Gómez", email: "ana@example.com", password: "clave-segura-123", acceptTerms: true }, "203.0.113.7");
    await sendPlayerOnboardingEmails(userId, "ana@example.com");
    const r = await rows();
    expect(r.map((x) => x.kind).sort()).toEqual(["email_verification", "player_welcome"]);
    expect(r.find((x) => x.kind === "email_verification")!.priority).toBe(1);
    // Sin verificar, igual puede ingresar.
    const login = await getAuth().api.signInEmail({ body: { email: "ana@example.com", password: "clave-segura-123" }, asResponse: true });
    expect(login.status).toBe(200);
    await processNotifications({ provider: mem, now: new Date() });
    const verify = mem.sent.find((m) => m.subject === "Confirmá tu email")!;
    const url = verify.text.match(/https?:\/\/\S+verify-email\S+/)![0];
    expect(mem.sent.some((m) => /Bienvenido\/a a TURNUP, Ana/.test(m.subject))).toBe(true);
    const res = await getAuth().handler(new Request(url));
    expect([200, 302]).toContain(res.status);
    expect((await owner.user.findUniqueOrThrow({ where: { id: userId } })).emailVerified).toBe(true);
    // Un nuevo pedido para una cuenta ya verificada no envía nada.
    await withSystem((tx) => enqueue(tx, { tenantId: null, kind: "email_verification", recipient: "ana@example.com", dedupeKey: "t:again", payload: { sealedUrl: "x" } }));
    await processNotifications({ provider: mem, now: new Date() });
    expect((await rows()).find((x) => x.kind === "email_verification" && x.status === "SKIPPED")?.lastError).toBe("already_verified");
  });

  it("nuevo complejo: avisa a los demás superadmins; panel, reintento seguro y prueba a dirección autorizada", async () => {
    const a = await makeUser("super1@mail6.test", { platformRole: "SUPERADMIN" });
    await makeUser("super2@mail6.test", { platformRole: "SUPERADMIN" });
    const su = { id: a.id, name: "Super", email: "super1@mail6.test", platformRole: "SUPERADMIN" as const, twoFactorEnabled: true };
    await createTenant(su, { slug: "nuevo-mail6", name: "Nuevo Mail6" });
    const created = (await rows()).filter((r) => r.kind === "admin_tenant_created");
    expect(created.map((r) => r.recipient)).toEqual(["super2@mail6.test"]);

    await processNotifications({ provider: mem, now: new Date() });
    expect(mem.sent.find((m) => m.to === "super2@mail6.test")!.html).toContain("Nuevo Mail6");

    // Reintento: solo FAILED/SKIPPED y nunca de emails con enlace secreto.
    const n = await owner.notification.findFirstOrThrow({ where: { kind: "admin_tenant_created" } });
    await owner.notification.update({ where: { id: n.id }, data: { status: "FAILED" } });
    await retryEmail(su, n.id);
    expect((await owner.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("PENDING");
    await withSystem((tx) => enqueue(tx, { tenantId: null, kind: "password_reset", recipient: "x@example.com", dedupeKey: "t:pr" }));
    const pr = await owner.notification.findFirstOrThrow({ where: { dedupeKey: "t:pr" } });
    await owner.notification.update({ where: { id: pr.id }, data: { status: "FAILED" } });
    await expect(retryEmail(su, pr.id)).rejects.toMatchObject({ code: "EMAIL_NOT_RETRYABLE" });

    await expect(sendTestEmail(su, "cualquiera@example.com")).rejects.toMatchObject({ code: "EMAIL_RECIPIENT_NOT_ALLOWED" });
    const d = await emailDashboard(su, {});
    expect(d.usage.limit).toBe(300);
    expect(d.rows.length).toBeGreaterThan(0);
    // El panel no expone contenido ni enlaces: solo metadatos.
    expect(JSON.stringify(d.rows)).not.toMatch(/sealed|token|payload/);
  });
});

describe("plantillas", () => {
  it("todos los tipos tienen prioridad y ninguno queda sin plantilla", () => {
    for (const k of [...PLAYER_KINDS, ...OWNER_KINDS, ...ACCOUNT_KINDS, ...ADMIN_KINDS]) expect(KIND_PRIORITY[k]).toBeGreaterThanOrEqual(1);
  });

  it("los datos de un complejo nunca se usan para un aviso de otro (aislamiento)", async () => {
    const other = await makeTenant("otro6");
    const { booking } = await createBooking(other.ctx, onlineInput(other.court.id, at(DAY, "20:00")), publicActor, { now: NOW });
    const r = await withSystem((tx) => renderNotification(tx, { id: "x", tenantId: f.tenant.id, kind: "booking_confirmed", recipient: "a@example.com", bookingId: booking.id, payload: null }, NOW));
    expect(r).toEqual({ send: false, reason: "booking_missing" });
  });
});
