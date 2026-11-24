import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createBooking } from "@/modules/booking/service";
import { publicTenantContext } from "@/modules/tenant/public";
import { setTenantStatus } from "@/modules/platform/service";
import { archiveTenant, changeTenantOwner, extendTrial, listTenantsAdmin, unarchiveTenant } from "@/modules/platform/tenants";
import { anonymizeImpact, anonymizeUser, getUserDetail, listUsers, reactivateUser, revokeUserSessions, suspendUser } from "@/modules/platform/users";
import { DAY, NOW, at, makeTenant, makeUser, onlineInput, owner, publicActor, resetDb, type Fixture } from "../support/fixtures";

let f: Fixture;
let admin: Awaited<ReturnType<typeof makeUser>>;

async function session(userId: string) {
  return owner.session.create({ data: { userId, token: `tok-${userId}-${Math.random()}`, expiresAt: new Date(Date.now() + 86_400_000) } });
}

beforeEach(async () => {
  await resetDb();
  f = await makeTenant("adm5");
  admin = await makeUser("root@adm5.test", { platformRole: "SUPERADMIN" });
});
afterAll(async () => { await prisma.$disconnect(); await owner.$disconnect(); });

describe("superadmin: usuarios", () => {
  it("suspender cierra sesiones al instante y bloquea el ingreso; reactivar lo habilita", async () => {
    const u = await makeUser("jugador@adm5.test");
    await session(u.id);
    const r = await suspendUser(admin, u.id, "Uso indebido reiterado");
    expect(r.sessionsRevoked).toBe(1);
    expect(await owner.session.count({ where: { userId: u.id } })).toBe(0);
    const row = await owner.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row).toMatchObject({ isDisabled: true, suspendedReason: "Uso indebido reiterado" });
    // isDisabled hace que getCurrentUser y el inicio de sesión lo rechacen (ver E2E de suspensión).
    await reactivateUser(admin, u.id);
    expect((await owner.user.findUniqueOrThrow({ where: { id: u.id } })).isDisabled).toBe(false);
    expect(await owner.auditLog.count({ where: { entityId: u.id, action: { startsWith: "platform.user." } } })).toBe(2);
  });

  it("protege al último superadmin y a uno mismo; exige motivo", async () => {
    await expect(suspendUser(admin, admin.id, "Prueba de autosuspensión")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await makeUser("root2@adm5.test", { platformRole: "SUPERADMIN" });
    // Con dos superadmins se puede suspender al otro…
    await suspendUser(admin, other.id, "Cuenta comprometida");
    // …pero no al último activo (otro superadmin intenta suspender al único que queda).
    await reactivateUser(admin, other.id);
    await owner.user.update({ where: { id: admin.id }, data: { isDisabled: true } });
    await expect(suspendUser(other, admin.id, "x".repeat(10))).rejects.toMatchObject({ code: "ALREADY_PROCESSED" });
    await owner.user.update({ where: { id: admin.id }, data: { isDisabled: false } });
    await owner.user.update({ where: { id: other.id }, data: { isDisabled: true } });
    const third = await makeUser("root3@adm5.test", { platformRole: "SUPERADMIN" });
    await owner.user.update({ where: { id: third.id }, data: { isDisabled: true } });
    await expect(suspendUser(third, admin.id, "Intento de dejar sin superadmin")).rejects.toMatchObject({ code: "LAST_SUPERADMIN" });
    const plain = await makeUser("p@adm5.test");
    await expect(suspendUser(admin, plain.id, "no")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    // Un usuario común no puede usar estas funciones.
    await expect(listUsers(plain, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("el detalle nunca expone contraseñas, tokens ni secretos", async () => {
    const u = await makeUser("detalle@adm5.test", { tenantId: f.tenant.id, role: "ADMIN" });
    await session(u.id);
    const d = await getUserDetail(admin, u.id);
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/tok-|password|secret|token/i);
    expect(d.sessions).toBe(1);
    expect(d.user.memberships[0]!.role).toBe("ADMIN");
    const list = await listUsers(admin, { tipo: "admin" });
    expect(list.rows.map((r) => r.id)).toContain(u.id);
  });

  it("eliminar = anonimizar: muestra el impacto, exige resolver reservas futuras y conserva el historial", async () => {
    const u = await makeUser("baja@adm5.test");
    await owner.playerProfile.create({ data: { userId: u.id, phone: "1155550000" } });
    const { booking } = await createBooking(f.ctx, { ...onlineInput(f.court.id, at(DAY, "20:00")), playerUserId: u.id }, publicActor, { now: NOW });
    const impact = await anonymizeImpact(admin, u.id, NOW);
    expect(impact.futureBookings).toBe(1);
    expect(impact.blockers.length).toBe(1);
    await expect(anonymizeUser(admin, u.id, "baja@adm5.test", NOW)).rejects.toMatchObject({ code: "USER_HAS_FUTURE_BOOKINGS" });
    await owner.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED", cancelledAt: NOW } });
    await expect(anonymizeUser(admin, u.id, "otro@mail.com", NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await anonymizeUser(admin, u.id, "BAJA@adm5.test", NOW);
    const row = await owner.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.email).not.toContain("baja@");
    expect(row).toMatchObject({ name: "Usuario eliminado", isDisabled: true });
    expect(await owner.playerProfile.count({ where: { userId: u.id } })).toBe(0);
    // La reserva (historial del complejo) sigue existiendo, desvinculada.
    expect(await owner.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ playerUserId: null, status: "CANCELLED" });
  });

  it("no se puede eliminar al único dueño de un complejo", async () => {
    const o = await makeUser("unico@adm5.test", { tenantId: f.tenant.id, role: "OWNER" });
    await expect(anonymizeUser(admin, o.id, "unico@adm5.test", NOW)).rejects.toMatchObject({ code: "OWNER_REASSIGN_REQUIRED" });
    expect(await revokeUserSessions(admin, o.id)).toBe(0);
  });
});

describe("superadmin: complejos", () => {
  it("suspender con motivo oculta el complejo y bloquea reservas nuevas; archivar exige suspender y confirmar", async () => {
    await setTenantStatus(admin, f.tenant.id, "SUSPENDED", "Falta de pago");
    expect((await owner.tenant.findUniqueOrThrow({ where: { id: f.tenant.id } })).suspendedReason).toBe("Falta de pago");
    await expect(publicTenantContext(f.tenant.slug)).rejects.toMatchObject({ code: "TENANT_SUSPENDED" });
    await expect(archiveTenant(admin, f.tenant.id, "otro-slug")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await archiveTenant(admin, f.tenant.id, f.tenant.slug);
    // Archivado no se reactiva directo (primero se desarchiva) y sus datos siguen.
    await expect(setTenantStatus(admin, f.tenant.id, "ACTIVE", "intento")).rejects.toMatchObject({ code: "TENANT_NOT_FOUND" });
    expect(await owner.court.count({ where: { tenantId: f.tenant.id } })).toBeGreaterThan(0);
    const list = await listTenantsAdmin(admin, { estado: "archivado" });
    expect(list.rows.map((r) => r.id)).toContain(f.tenant.id);
    await unarchiveTenant(admin, f.tenant.id);
    await setTenantStatus(admin, f.tenant.id, "ACTIVE", "regularizado");
    await expect(publicTenantContext(f.tenant.slug)).resolves.toBeTruthy();
  });

  it("archivar un complejo activo no se permite", async () => {
    await expect(archiveTenant(admin, f.tenant.id, f.tenant.slug)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("cambio de dueño: el anterior queda como administrador; extensión de prueba", async () => {
    const old = await makeUser("viejo@adm5.test", { tenantId: f.tenant.id, role: "OWNER" });
    await makeUser("nuevo@adm5.test");
    await changeTenantOwner(admin, f.tenant.id, "NUEVO@adm5.test");
    const ms = await owner.membership.findMany({ where: { tenantId: f.tenant.id }, include: { user: true } });
    expect(ms.find((m) => m.user.email === "nuevo@adm5.test")?.role).toBe("OWNER");
    expect(ms.find((m) => m.userId === old.id)?.role).toBe("ADMIN");
    await expect(changeTenantOwner(admin, f.tenant.id, "nadie@adm5.test")).rejects.toMatchObject({ code: "NOT_FOUND" });

    const plan = await owner.plan.create({ data: { code: "prueba-adm5", name: "Prueba", priceAmount: 0 } });
    const end = new Date(Date.now() + 3 * 86_400_000);
    await owner.subscription.create({ data: { tenantId: f.tenant.id, planId: plan.id, status: "TRIAL", currentPeriodStart: new Date(), currentPeriodEnd: end } });
    const newEnd = await extendTrial(admin, f.tenant.id, 10);
    expect(Math.round((newEnd.getTime() - end.getTime()) / 86_400_000)).toBe(10);
    await expect(extendTrial(admin, f.tenant.id, 200)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
