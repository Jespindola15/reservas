import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as bookRoute } from "@/app/api/public/[slug]/bookings/route";
import { getAuth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import { createBooking, MAX_ACTIVE_ONLINE_PER_CUSTOMER } from "@/modules/booking/service";
import { DAY, NOW, at, makeTenant, makeUser, onlineInput, owner, publicActor, resetDb, type Fixture } from "../support/fixtures";
import { totp } from "../support/totp";

const ORIGIN = process.env.BETTER_AUTH_URL!;
const PASS = "contraseña-segura-123";

function call(path: string, body: unknown, opts: { ip?: string; cookie?: string } = {}) {
  return getAuth().handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-real-ip": opts.ip ?? "203.0.113.9", ...(opts.cookie ? { cookie: opts.cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
}
const cookiesOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
async function withPassword(email: string, platformRole?: "SUPERADMIN") {
  const u = await makeUser(email, { platformRole });
  await owner.account.create({ data: { userId: u.id, accountId: u.id, providerId: "credential", password: await hashPassword(PASS) } });
  return u;
}

let f: Fixture;
beforeEach(async () => {
  await resetDb();
  f = await makeTenant("seg31");
});
afterAll(async () => {
  await prisma.$disconnect();
  await owner.$disconnect();
});

describe("verificación en dos pasos (TOTP)", () => {
  it("alta completa: contraseña → QR → código; después el login exige el segundo factor", async () => {
    const u = await withPassword("sa@seg31.test", "SUPERADMIN");
    const login = await call("/sign-in/email", { email: "sa@seg31.test", password: PASS });
    const cookie = cookiesOf(login);
    expect((await call("/two-factor/enable", { password: "incorrecta-1234567" }, { cookie })).status).not.toBe(200);
    const en = await call("/two-factor/enable", { password: PASS }, { cookie });
    expect(en.status).toBe(200);
    const { totpURI, backupCodes } = await en.json();
    expect(backupCodes.length).toBeGreaterThanOrEqual(8);
    const secret = new URL(totpURI).searchParams.get("secret")!;
    // El secreto no queda en claro en la base.
    const stored = await owner.twoFactor.findFirstOrThrow({ where: { userId: u.id } });
    expect(stored.secret).not.toContain(secret);
    expect((await owner.user.findUniqueOrThrow({ where: { id: u.id } })).twoFactorEnabled).toBe(false);
    expect((await call("/two-factor/verify-totp", { code: "000000" }, { cookie })).status).not.toBe(200);
    expect((await call("/two-factor/verify-totp", { code: totp(secret) }, { cookie })).status).toBe(200);
    expect((await owner.user.findUniqueOrThrow({ where: { id: u.id } })).twoFactorEnabled).toBe(true);

    // Nuevo login: la contraseña sola no alcanza.
    const l2 = await call("/sign-in/email", { email: "sa@seg31.test", password: PASS });
    expect(l2.status).toBe(200);
    expect((await l2.json()).twoFactorRedirect).toBe(true);
    const pending = cookiesOf(l2);
    expect(pending).not.toMatch(/session_token=[^;]+/);
    expect((await call("/two-factor/verify-totp", { code: "123456" }, { cookie: pending })).status).not.toBe(200);
    const ok = await call("/two-factor/verify-totp", { code: totp(secret) }, { cookie: pending });
    expect(ok.status).toBe(200);
    expect(cookiesOf(ok)).toMatch(/session_token=/);
    // Código de respaldo: sirve una sola vez.
    const l3 = cookiesOf(await call("/sign-in/email", { email: "sa@seg31.test", password: PASS }));
    expect((await call("/two-factor/verify-backup-code", { code: backupCodes[0] }, { cookie: l3 })).status).toBe(200);
    const l4 = cookiesOf(await call("/sign-in/email", { email: "sa@seg31.test", password: PASS }));
    expect((await call("/two-factor/verify-backup-code", { code: backupCodes[0] }, { cookie: l4 })).status).not.toBe(200);
  });

  it("usuarios sin 2FA (dueños, empleados) ingresan como siempre", async () => {
    await withPassword("dueno@seg31.test");
    const r = await call("/sign-in/email", { email: "dueno@seg31.test", password: PASS });
    expect(r.status).toBe(200);
    expect(cookiesOf(r)).toMatch(/session_token=/);
  });
});

describe("límites de inicio de sesión", () => {
  it("varios empleados detrás de la misma IP no se bloquean entre sí; una cuenta atacada sí", async () => {
    for (let i = 0; i < 12; i++) await withPassword(`empleado${i}@seg31.test`);
    const ip = "198.51.100.77";
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await call("/sign-in/email", { email: `empleado${i}@seg31.test`, password: PASS }, { ip })).status);
    expect(codes.every((c) => c === 200)).toBe(true);
    // Fuerza bruta contra una cuenta, rotando IPs: corta a los 10 intentos.
    const attack: number[] = [];
    for (let i = 0; i < 12; i++) attack.push((await call("/sign-in/email", { email: "empleado0@seg31.test", password: `mala-${i}-xxxxxxx` }, { ip: `192.0.2.${i + 1}` })).status);
    expect(attack.slice(0, 9).every((c) => c === 401)).toBe(true);
    expect(attack.slice(-2)).toEqual([429, 429]);
  });
});

describe("reservas falsas", () => {
  it(`un jugador no puede tener más de ${MAX_ACTIVE_ONLINE_PER_CUSTOMER} reservas online activas en un complejo`, async () => {
    const hours = ["08:00", "09:30", "18:00", "19:30", "21:00"];
    for (let i = 0; i < MAX_ACTIVE_ONLINE_PER_CUSTOMER; i++) {
      await createBooking(f.ctx, { ...onlineInput(f.court.id, at(DAY, hours[i]!), 90, 50 + i), customer: { name: "Mismo Jugador", phone: "11 4000-1234", email: "mismo@example.com" } }, publicActor, { now: NOW });
    }
    await expect(
      createBooking(f.ctx, { ...onlineInput(f.court.id, at(DAY, hours[4]!), 90, 99), customer: { name: "Mismo Jugador", phone: "11 4000-1234", email: "mismo@example.com" } }, publicActor, { now: NOW }),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "LIMIT_REACHED");
    // Otro jugador sí puede.
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, hours[4]!), 90, 7), publicActor, { now: NOW });
  });

  it("el campo trampa rechaza envíos automáticos sin crear nada", async () => {
    const body = { ...onlineInput(f.court.id, at(DAY, "20:00")), startsAt: at(DAY, "20:00").toISOString(), website: "http://spam.example" };
    const res = await bookRoute(new Request(`${ORIGIN}/api/public/seg31/bookings`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "203.0.113.200" }, body: JSON.stringify(body) }), { params: Promise.resolve({ slug: "seg31" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(await owner.booking.count()).toBe(0);
  });
});
