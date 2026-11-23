import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/tenant-context";
import { authorizeTenantAccess, listMyTenants } from "@/modules/access/authorize";
import { changeBookingStatus, createBlock, createBooking, rescheduleBooking } from "@/modules/booking/service";
import { getDayAvailability } from "@/modules/booking/availability";
import { publicTenantContext } from "@/modules/tenant/public";
import { assignTenantAdmin, createTenant, listTenantsForPlatform, setTenantStatus } from "@/modules/platform/service";
import {
  DAY,
  NOW,
  appRole,
  at,
  makeTenant,
  makeUser,
  onlineInput,
  owner,
  publicActor,
  resetDb,
  type Fixture,
} from "../support/fixtures";

const opts = { now: NOW };

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

let A: Fixture;
let B: Fixture;

beforeEach(async () => {
  await resetDb();
  A = await makeTenant("complejo-a");
  B = await makeTenant("complejo-b");
});

afterAll(async () => {
  await prisma.$disconnect();
  await owner.$disconnect();
  await appRole.$disconnect();
});

describe("manipulación de IDs de otro complejo", () => {
  it("no se puede reservar una cancha de B usando el contexto de A", async () => {
    await expectCode(
      createBooking(A.ctx, onlineInput(B.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts),
      "COURT_NOT_FOUND",
    );
    expect(await owner.booking.count()).toBe(0);
  });

  it("no se puede cancelar, confirmar ni reprogramar una reserva de B desde A", async () => {
    const b = await createBooking(B.ctx, onlineInput(B.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    await expectCode(
      changeBookingStatus(A.ctx, { bookingId: b.booking.id, to: "CANCELLED", expectedVersion: 1 }, publicActor, opts),
      "BOOKING_NOT_FOUND",
    );
    await expectCode(
      rescheduleBooking(
        A.ctx,
        { bookingId: b.booking.id, startsAt: at(DAY, "22:00"), durationMinutes: 90, expectedVersion: 1 },
        publicActor,
        opts,
      ),
      "BOOKING_NOT_FOUND",
    );
    const still = await owner.booking.findUniqueOrThrow({ where: { id: b.booking.id } });
    expect(still.status).toBe("CONFIRMED");
  });

  it("no se puede mover una reserva propia a una cancha de otro complejo", async () => {
    const a = await createBooking(A.ctx, onlineInput(A.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    await expectCode(
      rescheduleBooking(
        A.ctx,
        { bookingId: a.booking.id, startsAt: at(DAY, "20:00"), durationMinutes: 90, courtId: B.court.id, expectedVersion: 1 },
        publicActor,
        opts,
      ),
      "COURT_NOT_FOUND",
    );
  });

  it("no se puede bloquear una cancha de B desde A", async () => {
    await expectCode(
      createBlock(
        A.ctx,
        { courtId: B.court.id, startsAt: at(DAY, "19:00"), endsAt: at(DAY, "20:00"), reason: "intento" },
        publicActor,
        opts,
      ),
      "COURT_NOT_FOUND",
    );
  });

  it("la disponibilidad de A nunca incluye canchas de B, aunque se pida su id", async () => {
    const day = await getDayAvailability(A.ctx, { operatingDate: DAY, durationMinutes: 60, courtId: B.court.id }, opts);
    expect(day.courts).toHaveLength(0);
  });
});

describe("Row Level Security (rol de la app con SQL directo)", () => {
  it("sin contexto de tenant, el rol de la app no ve datos", async () => {
    await createBooking(A.ctx, onlineInput(A.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    const courts = await appRole.court.count();
    const bookings = await appRole.booking.count();
    const tenants = await appRole.tenant.count();
    expect({ courts, bookings, tenants }).toEqual({ courts: 0, bookings: 0, tenants: 0 });
  });

  it("con contexto de A, una consulta SIN filtro de tenant solo devuelve datos de A", async () => {
    await createBooking(A.ctx, onlineInput(A.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    await createBooking(B.ctx, onlineInput(B.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    const seen = await withTenant(A.ctx, (tx) => tx.booking.findMany({ select: { tenantId: true } }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.tenantId).toBe(A.tenant.id);
    const courts = await withTenant(A.ctx, (tx) => tx.court.findMany({ select: { tenantId: true } }));
    expect(new Set(courts.map((c) => c.tenantId))).toEqual(new Set([A.tenant.id]));
  });

  it("con contexto de A, insertar filas con tenantId de B es rechazado por la base", async () => {
    await expect(
      withTenant(A.ctx, (tx) =>
        tx.court.create({ data: { tenantId: B.tenant.id, name: "Intrusa", sport: "FOOTBALL" } }),
      ),
    ).rejects.toThrow();
    expect(await owner.court.count({ where: { name: "Intrusa" } })).toBe(0);
  });

  it("con contexto de A, un UPDATE masivo no toca filas de B", async () => {
    await withTenant(A.ctx, (tx) => tx.court.updateMany({ data: { description: "tocada" } }));
    expect(await owner.court.count({ where: { tenantId: B.tenant.id, description: "tocada" } })).toBe(0);
    expect(await owner.court.count({ where: { tenantId: A.tenant.id, description: "tocada" } })).toBe(2);
  });

  it("las variables de contexto no se filtran a la siguiente transacción del pool", async () => {
    await withTenant(A.ctx, (tx) => tx.court.count());
    const rows = await prisma.$queryRaw<{ t: string | null }[]>`SELECT current_setting('app.tenant_id', true) AS t`;
    expect(rows[0]!.t ?? "").toBe("");
  });
});

describe("barreras de la base de datos", () => {
  it("SQL directo con el rol dueño tampoco puede insertar reservas solapadas", async () => {
    await createBooking(A.ctx, onlineInput(A.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    const customer = await owner.customer.findFirstOrThrow({ where: { tenantId: A.tenant.id } });
    await expect(
      owner.$executeRaw`
        INSERT INTO bookings (tenant_id, court_id, customer_id, code, status, source, starts_at, ends_at,
                              duration_minutes, currency, customer_name)
        VALUES (${A.tenant.id}::uuid, ${A.court.id}::uuid, ${customer.id}::uuid, 'RAWSQL01', 'CONFIRMED', 'MANUAL',
                ${at(DAY, "21:00")}, ${at(DAY, "22:00")}, 60, 'ARS', 'raw')`,
    ).rejects.toThrow(/exclusion|23P01|conflicting/i);
  });

  it("la base rechaza una reserva que mezcle complejo A con cancha de B (FK compuesta)", async () => {
    const customer = await owner.customer.create({
      data: { tenantId: A.tenant.id, contactKey: "x@y.z", name: "X" },
    });
    await expect(
      owner.$executeRaw`
        INSERT INTO bookings (tenant_id, court_id, customer_id, code, status, source, starts_at, ends_at,
                              duration_minutes, currency, customer_name)
        VALUES (${A.tenant.id}::uuid, ${B.court.id}::uuid, ${customer.id}::uuid, 'RAWSQL02', 'CONFIRMED', 'MANUAL',
                ${at(DAY, "21:00")}, ${at(DAY, "22:00")}, 60, 'ARS', 'raw')`,
    ).rejects.toThrow(/foreign key|23503/i);
  });

  it("el rol de la app no puede escribir court_allocations directamente", async () => {
    await expect(
      withTenant(A.ctx, (tx) =>
        tx.$executeRaw`INSERT INTO court_allocations (tenant_id, court_id, starts_at, ends_at, block_id)
                       VALUES (${A.tenant.id}::uuid, ${A.court.id}::uuid, now(), now() + interval '1 hour', gen_random_uuid())`,
      ),
    ).rejects.toThrow(/permission denied|42501/i);
    await expect(
      withTenant(A.ctx, (tx) => tx.$executeRaw`DELETE FROM court_allocations`),
    ).rejects.toThrow(/permission denied|42501/i);
  });

  it("la auditoría es de solo inserción para la app", async () => {
    await createBooking(A.ctx, onlineInput(A.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts);
    await expect(withTenant(A.ctx, (tx) => tx.$executeRaw`UPDATE audit_logs SET action = 'x'`)).rejects.toThrow(
      /permission denied|42501/i,
    );
    await expect(withTenant(A.ctx, (tx) => tx.$executeRaw`DELETE FROM audit_logs`)).rejects.toThrow(
      /permission denied|42501/i,
    );
  });

  it("CHECK: la duración guardada debe coincidir con el intervalo", async () => {
    const customer = await owner.customer.create({ data: { tenantId: A.tenant.id, contactKey: "c@d.e", name: "C" } });
    await expect(
      owner.$executeRaw`
        INSERT INTO bookings (tenant_id, court_id, customer_id, code, status, source, starts_at, ends_at,
                              duration_minutes, currency, customer_name)
        VALUES (${A.tenant.id}::uuid, ${A.court.id}::uuid, ${customer.id}::uuid, 'RAWSQL03', 'CONFIRMED', 'MANUAL',
                ${at(DAY, "08:00")}, ${at(DAY, "09:00")}, 90, 'ARS', 'raw')`,
    ).rejects.toThrow(/check|23514/i);
  });
});

describe("usuarios sin permisos", () => {
  it("un usuario sin membresía no accede al panel de un complejo", async () => {
    const stranger = await makeUser("extrano@example.com");
    await expectCode(authorizeTenantAccess(stranger, "complejo-a", "booking.read"), "FORBIDDEN");
  });

  it("el dueño de A no accede al panel de B", async () => {
    const ownerA = await makeUser("duenio-a@example.com", { tenantId: A.tenant.id, role: "OWNER" });
    const access = await authorizeTenantAccess(ownerA, "complejo-a", "court.manage");
    expect(access.ctx.tenantId).toBe(A.tenant.id);
    await expectCode(authorizeTenantAccess(ownerA, "complejo-b", "booking.read"), "FORBIDDEN");
  });

  it("STAFF puede gestionar reservas pero no bloqueos ni canchas", async () => {
    const staff = await makeUser("staff@example.com", { tenantId: A.tenant.id, role: "STAFF" });
    await expect(authorizeTenantAccess(staff, "complejo-a", "booking.manage")).resolves.toBeDefined();
    await expectCode(authorizeTenantAccess(staff, "complejo-a", "block.manage"), "FORBIDDEN");
    await expectCode(authorizeTenantAccess(staff, "complejo-a", "court.manage"), "FORBIDDEN");
  });

  it("listar mis complejos devuelve solo los propios", async () => {
    const u = await makeUser("multi@example.com", { tenantId: A.tenant.id, role: "ADMIN" });
    const mine = await listMyTenants(u.id);
    expect(mine.map((t) => t.slug)).toEqual(["complejo-a"]);
  });

  it("un complejo suspendido no recibe reservas ni da acceso al panel", async () => {
    const ownerA = await makeUser("duenio-a2@example.com", { tenantId: A.tenant.id, role: "OWNER" });
    await owner.tenant.update({ where: { id: A.tenant.id }, data: { status: "SUSPENDED" } });
    await expectCode(publicTenantContext("complejo-a"), "TENANT_SUSPENDED");
    await expectCode(
      createBooking(A.ctx, onlineInput(A.court.id, at(DAY, "20:00"), 90, 1), publicActor, opts),
      "TENANT_SUSPENDED",
    );
    await expectCode(authorizeTenantAccess(ownerA, "complejo-a", "booking.read"), "TENANT_SUSPENDED");
  });

  it("un usuario común no puede usar operaciones de superadministrador", async () => {
    const u = await makeUser("comun@example.com", { tenantId: A.tenant.id, role: "OWNER" });
    await expectCode(createTenant(u, { slug: "nuevo-complejo", name: "Nuevo" }), "FORBIDDEN");
    await expectCode(listTenantsForPlatform(u), "FORBIDDEN");
    await expectCode(setTenantStatus(u, B.tenant.id, "SUSPENDED", "x"), "FORBIDDEN");
  });
});

describe("superadministrador", () => {
  it("crea complejos, asigna administradores y queda auditado", async () => {
    const sa = await makeUser("root@example.com", { platformRole: "SUPERADMIN" });
    const t = await createTenant(sa, { slug: "nuevo-complejo", name: "Nuevo" });
    const res = await assignTenantAdmin(sa, {
      tenantId: t.id,
      email: "Duenio@Nuevo.com",
      name: "Dueño Nuevo",
      role: "OWNER",
      initialPassword: "una-clave-larga-segura-123",
    });
    expect(res.created).toBe(true);
    const account = await owner.account.findFirstOrThrow({ where: { userId: res.userId } });
    expect(account.password).toBeTruthy();
    expect(account.password).not.toContain("una-clave");
    const logs = await owner.auditLog.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => [l.action, l.actorType])).toEqual([
      ["platform.tenant.created", "PLATFORM_ADMIN"],
      ["platform.membership.assigned", "PLATFORM_ADMIN"],
    ]);
    await setTenantStatus(sa, t.id, "SUSPENDED", "falta de pago");
    expect((await owner.tenant.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("SUSPENDED");
  });

  it("rechaza slugs reservados y duplicados", async () => {
    const sa = await makeUser("root2@example.com", { platformRole: "SUPERADMIN" });
    await expectCode(createTenant(sa, { slug: "admin", name: "Admin" }), "VALIDATION_ERROR");
    await expectCode(createTenant(sa, { slug: "complejo-a", name: "Duplicado" }), "VALIDATION_ERROR");
    await expectCode(createTenant(sa, { slug: "Con Espacios!", name: "Inválido" }), "VALIDATION_ERROR");
    await expectCode(createTenant(sa, { slug: "valido-slug", name: "X" }), "VALIDATION_ERROR");
    expect(await owner.tenant.count({ where: { slug: "valido-slug" } })).toBe(0);
  });
});
