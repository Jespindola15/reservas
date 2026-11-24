import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getAuth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import { unseal } from "@/lib/security/sealed";
import { authorizeTenantAccess } from "@/modules/access/authorize";
import { processNotifications } from "@/modules/notifications/processor";
import { MemoryProvider } from "@/modules/notifications/providers";
import { acceptInvitation, describeInvitation, inviteMember, listTeam, revokeInvitation, updateMember } from "@/modules/team/service";
import { makeTenant, makeUser, owner, appRole, resetDb, type Fixture } from "../support/fixtures";

const ORIGIN = process.env.BETTER_AUTH_URL!;
const PASS = "contraseña-segura-123";

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}
function post(path: string, body: unknown, ip = "203.0.113.7") {
  return getAuth().handler(
    new Request(`${ORIGIN}/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-real-ip": ip }, body: JSON.stringify(body) }),
  );
}
async function withPassword(email: string, tenantId?: string, role?: "OWNER" | "ADMIN" | "STAFF") {
  const u = await makeUser(email, { tenantId, role });
  await owner.account.create({ data: { userId: u.id, accountId: u.id, providerId: "credential", password: await hashPassword(PASS) } });
  return u;
}
/** Token que llegaría por email: se descifra del payload de la cola (como hace el procesador). */
async function tokenFrom(kind: string, field: "sealedUrl" | "sealedToken" = "sealedUrl") {
  const n = await owner.notification.findFirstOrThrow({ where: { kind }, orderBy: { createdAt: "desc" } });
  const sealed = (n.payload as Record<string, string>)[field]!;
  const clear = await unseal(sealed);
  return clear.includes("token=") ? new URL(clear).searchParams.get("token")! : clear;
}

let f: Fixture;
beforeEach(async () => {
  await resetDb();
  f = await makeTenant("equipo");
});
afterAll(async () => {
  await prisma.$disconnect();
  await owner.$disconnect();
  await appRole.$disconnect();
});

describe("recuperación de contraseña (Better Auth + outbox)", () => {
  it("responde igual exista o no la cuenta, y solo encola email para la cuenta real", async () => {
    await withPassword("real@equipo.test");
    const a = await post("/request-password-reset", { email: "real@equipo.test", redirectTo: "/restablecer" });
    const b = await post("/request-password-reset", { email: "nadie@equipo.test", redirectTo: "/restablecer" });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
    const rows = await owner.notification.findMany({ where: { kind: "password_reset" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recipient).toBe("real@equipo.test");
    // El enlace se guarda cifrado: el token no aparece en claro en la base.
    expect(JSON.stringify(rows[0]!.payload)).not.toMatch(/restablecer\?token=/);
  });

  it("el token es de un solo uso, cambia la contraseña y cierra las sesiones abiertas", async () => {
    const u = await withPassword("cambio@equipo.test");
    const login = await post("/sign-in/email", { email: "cambio@equipo.test", password: PASS });
    expect(login.status).toBe(200);
    expect(await owner.session.count({ where: { userId: u.id } })).toBe(1);

    await post("/request-password-reset", { email: "cambio@equipo.test", redirectTo: "/restablecer" });
    const token = await tokenFrom("password_reset");
    const mem = new MemoryProvider();
    await processNotifications({ provider: mem });
    expect(mem.sent[0]!.html).toContain(`/restablecer?token=${token}`);
    expect((await owner.notification.findFirstOrThrow({ where: { kind: "password_reset" } })).payload).toBeNull();

    const nueva = "otra-clave-muy-larga-456";
    expect((await post("/reset-password", { newPassword: nueva, token })).status).toBe(200);
    expect(await owner.session.count({ where: { userId: u.id } })).toBe(0);
    expect((await post("/reset-password", { newPassword: "tercera-clave-larga-789", token })).status).toBe(400);
    expect((await post("/sign-in/email", { email: "cambio@equipo.test", password: PASS })).status).toBe(401);
    expect((await post("/sign-in/email", { email: "cambio@equipo.test", password: nueva })).status).toBe(200);
  });

  it("un token vencido no sirve", async () => {
    await withPassword("vence@equipo.test");
    await post("/request-password-reset", { email: "vence@equipo.test", redirectTo: "/restablecer" });
    const token = await tokenFrom("password_reset");
    await owner.verification.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await post("/reset-password", { newPassword: "otra-clave-muy-larga-456", token })).status).toBe(400);
  });

  it("limita pedidos por email aunque cambie la IP (sin bloquear a todos)", async () => {
    await withPassword("spam@equipo.test");
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await post("/request-password-reset", { email: "spam@equipo.test", redirectTo: "/restablecer" }, `198.51.100.${i + 1}`)).status);
    expect(codes.slice(0, 3)).toEqual([200, 200, 200]);
    expect(codes.slice(3)).toEqual([429, 429]);
    // Otra cuenta no queda afectada.
    await withPassword("otra@equipo.test");
    expect((await post("/request-password-reset", { email: "otra@equipo.test", redirectTo: "/restablecer" }, "198.51.100.9")).status).toBe(200);
  });
});

describe("equipo: invitaciones y roles", () => {
  it("el dueño invita, el invitado crea su cuenta y queda como personal; el token no se reutiliza", async () => {
    const dueno = await makeUser("dueno@equipo.test", { tenantId: f.tenant.id, role: "OWNER" });
    const ctx = { tenantId: f.tenant.id, userId: dueno.id };
    await inviteMember(ctx, "OWNER", { email: "Nuevo@Equipo.test", role: "STAFF" }, { type: "USER", userId: dueno.id });
    const token = await tokenFrom("team_invitation", "sealedToken");
    const info = await describeInvitation(token);
    expect(info).toMatchObject({ email: "nuevo@equipo.test", role: "STAFF", userExists: false });

    const r = await acceptInvitation(token, { currentUser: null, newAccount: { name: "Nuevo", password: PASS } });
    expect(r).toMatchObject({ slug: "equipo", createdAccount: true });
    const team = await listTeam(ctx);
    expect(team.members.find((m) => m.user.email === "nuevo@equipo.test")?.role).toBe("STAFF");
    expect(team.invitations).toHaveLength(0);
    await expectCode(acceptInvitation(token, { currentUser: null, newAccount: { name: "Otro", password: PASS } }), "INVALID_LINK");
    expect(await owner.auditLog.count({ where: { action: { startsWith: "team." } } })).toBeGreaterThanOrEqual(2);
  });

  it("una cuenta existente solo acepta logueada con el mismo email; revocar invalida el enlace", async () => {
    const dueno = await makeUser("dueno@equipo.test", { tenantId: f.tenant.id, role: "OWNER" });
    const ctx = { tenantId: f.tenant.id, userId: dueno.id };
    const existente = await withPassword("existe@equipo.test");
    const intruso = await withPassword("intruso@equipo.test");
    await inviteMember(ctx, "OWNER", { email: "existe@equipo.test", role: "ADMIN" }, { type: "USER", userId: dueno.id });
    const token = await tokenFrom("team_invitation", "sealedToken");
    await expectCode(acceptInvitation(token, { currentUser: null, newAccount: { name: "Xavier", password: PASS } }), "UNAUTHENTICATED");
    await expectCode(acceptInvitation(token, { currentUser: { id: intruso.id, email: intruso.email } }), "UNAUTHENTICATED");
    await acceptInvitation(token, { currentUser: { id: existente.id, email: existente.email } });
    expect((await owner.membership.findFirstOrThrow({ where: { userId: existente.id } })).role).toBe("ADMIN");

    await inviteMember(ctx, "OWNER", { email: "tarde@equipo.test", role: "STAFF" }, { type: "USER", userId: dueno.id });
    const t2 = await tokenFrom("team_invitation", "sealedToken");
    const inv = await owner.invitation.findFirstOrThrow({ where: { email: "tarde@equipo.test" } });
    await revokeInvitation(ctx, "OWNER", inv.id, { type: "USER", userId: dueno.id });
    await expectCode(describeInvitation(t2), "INVALID_LINK");
  });

  it("un administrador no puede invitar ni ascender administradores; nadie cambia sus propios permisos", async () => {
    const admin = await makeUser("admin@equipo.test", { tenantId: f.tenant.id, role: "ADMIN" });
    const staff = await makeUser("staff@equipo.test", { tenantId: f.tenant.id, role: "STAFF" });
    const actx = { tenantId: f.tenant.id, userId: admin.id };
    const actor = { type: "USER" as const, userId: admin.id };
    await expectCode(inviteMember(actx, "ADMIN", { email: "x@equipo.test", role: "ADMIN" }, actor), "FORBIDDEN");
    const ms = await owner.membership.findFirstOrThrow({ where: { userId: staff.id } });
    const ma = await owner.membership.findFirstOrThrow({ where: { userId: admin.id } });
    await expectCode(updateMember(actx, "ADMIN", { membershipId: ms.id, role: "ADMIN" }, actor), "FORBIDDEN");
    await expectCode(updateMember(actx, "ADMIN", { membershipId: ma.id, role: "STAFF" }, actor), "FORBIDDEN");
    // Personal no gestiona equipo en absoluto.
    await expect(authorizeTenantAccess(staff, "equipo", "team.manage")).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "FORBIDDEN");
  });

  it("la base de datos bloquea escaladas aunque se salteen las validaciones de la app", async () => {
    const staff = await makeUser("staff@equipo.test", { tenantId: f.tenant.id, role: "STAFF" });
    const admin = await makeUser("admin@equipo.test", { tenantId: f.tenant.id, role: "ADMIN" });
    const ms = await owner.membership.findFirstOrThrow({ where: { userId: staff.id } });
    const asApp = (userId: string, sql: string) =>
      appRole.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${f.tenant.id}, true), set_config('app.user_id', ${userId}, true)`;
        return tx.$executeRawUnsafe(sql);
      });
    // Personal intentando ascenderse a sí mismo.
    await expect(asApp(staff.id, `UPDATE memberships SET role = 'ADMIN' WHERE id = '${ms.id}'`)).rejects.toThrow();
    // Administrador intentando crear otro administrador.
    await expect(asApp(admin.id, `UPDATE memberships SET role = 'ADMIN' WHERE id = '${ms.id}'`)).rejects.toThrow();
    expect((await owner.membership.findFirstOrThrow({ where: { id: ms.id } })).role).toBe("STAFF");
  });

  it("desactivar quita el acceso y cierra sesiones; queda auditado", async () => {
    const dueno = await makeUser("dueno@equipo.test", { tenantId: f.tenant.id, role: "OWNER" });
    const staff = await withPassword("staff@equipo.test", f.tenant.id, "STAFF");
    await post("/sign-in/email", { email: "staff@equipo.test", password: PASS });
    expect(await owner.session.count({ where: { userId: staff.id } })).toBe(1);
    const ms = await owner.membership.findFirstOrThrow({ where: { userId: staff.id } });
    await updateMember({ tenantId: f.tenant.id, userId: dueno.id }, "OWNER", { membershipId: ms.id, isActive: false }, { type: "USER", userId: dueno.id });
    expect(await owner.session.count({ where: { userId: staff.id } })).toBe(0);
    await expect(authorizeTenantAccess(staff, "equipo", "booking.read")).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "FORBIDDEN");
    const log = await owner.auditLog.findFirstOrThrow({ where: { action: "team.member.permissions_changed" } });
    expect(log.metadata).toMatchObject({ from: { isActive: true }, to: { isActive: false } });
  });

  it("aislamiento: un dueño no ve ni toca el equipo de otro complejo", async () => {
    const otro = await makeTenant("otro");
    const duenoA = await makeUser("a@equipo.test", { tenantId: f.tenant.id, role: "OWNER" });
    const staffB = await makeUser("b@otro.test", { tenantId: otro.tenant.id, role: "STAFF" });
    const mB = await owner.membership.findFirstOrThrow({ where: { userId: staffB.id } });
    const ctxA = { tenantId: f.tenant.id, userId: duenoA.id };
    expect((await listTeam(ctxA)).members.map((m) => m.user.email)).toEqual(["a@equipo.test"]);
    await expectCode(updateMember(ctxA, "OWNER", { membershipId: mB.id, isActive: false }, { type: "USER", userId: duenoA.id }), "NOT_FOUND");
  });

  it("respeta el límite de miembros del plan", async () => {
    const dueno = await makeUser("dueno@equipo.test", { tenantId: f.tenant.id, role: "OWNER" });
    const plan = await owner.plan.create({ data: { code: "chico", name: "Chico", priceAmount: 0, maxMembers: 1 } });
    await owner.subscription.create({ data: { tenantId: f.tenant.id, planId: plan.id, status: "ACTIVE", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86_400_000) } });
    const ctx = { tenantId: f.tenant.id, userId: dueno.id };
    const actor = { type: "USER" as const, userId: dueno.id };
    await inviteMember(ctx, "OWNER", { email: "uno@equipo.test", role: "STAFF" }, actor);
    await expectCode(inviteMember(ctx, "OWNER", { email: "dos@equipo.test", role: "STAFF" }, actor), "LIMIT_REACHED");
  });
});
