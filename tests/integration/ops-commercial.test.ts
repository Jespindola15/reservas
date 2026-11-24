import { execSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import { POST as tickRoute } from "@/app/api/internal/jobs/tick/route";
import { GET as healthRoute } from "@/app/api/health/route";
import { getMonthSummary } from "@/modules/booking/admin-queries";
import { createBooking } from "@/modules/booking/service";
import { createCourt, createScheduleException, replaceWeeklySchedule } from "@/modules/courts/service";
import { csvCell, exportBookingsCsv, exportCustomersCsv } from "@/modules/exports/csv";
import { cleanup, runJob, tick } from "@/modules/jobs/runner";
import { assignSubscription, listAuditLogs, listPlans, savePlan } from "@/modules/platform/plans";
import { DAY, NOW, at, makeTenant, makeUser, onlineInput, owner, publicActor, resetDb, TZ, type Fixture } from "../support/fixtures";

const SECRET = "test-cron-secret-0123456789abcdef";
const opts = { now: NOW };
let f: Fixture;

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}
const req = (url: string, init: RequestInit = {}) => new Request(`http://localhost:3100${url}`, { ...init, headers: { "x-real-ip": "203.0.113.50", ...(init.headers ?? {}) } });

beforeAll(() => {
  process.env.CRON_SECRET = SECRET;
});
beforeEach(async () => {
  await resetDb();
  f = await makeTenant("ops");
});
afterAll(async () => {
  await prisma.$disconnect();
  await owner.$disconnect();
});

describe("endpoints internos", () => {
  it("la tarea programada exige el secreto y es idempotente", async () => {
    expect((await tickRoute(req("/api/internal/jobs/tick", { method: "POST" }))).status).toBe(401);
    expect((await tickRoute(req("/api/internal/jobs/tick", { method: "POST", headers: { authorization: "Bearer otro-secreto-del-mismo-largo-xxxx" } }))).status).toBe(401);
    const ok = await tickRoute(req("/api/internal/jobs/tick", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.ok).toBe(true);
    expect(Object.keys(body.result)).toEqual(["expire", "schedule", "send", "cleanup"]);
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });

  it("salud: sin secreto solo el estado; con secreto el detalle, sin datos personales", async () => {
    await tick();
    const pub = await healthRoute(req("/api/health"));
    expect(pub.status).toBe(200);
    expect(Object.keys(await pub.json())).toEqual(["status"]);
    const priv = await (await healthRoute(req("/api/health", { headers: { authorization: `Bearer ${SECRET}` } }))).json();
    expect(priv.status).toBe("ok");
    expect(priv.db.latencyMs).toBeGreaterThanOrEqual(0);
    expect(priv.jobs.map((j: { name: string }) => j.name)).toContain("tick");
    expect(JSON.stringify(priv)).not.toMatch(/@|postgresql:|secret/i);
  });
});

describe("jobs y limpieza", () => {
  it("ticks simultáneos no duplican vencimientos ni emails", async () => {
    const t = await makeTenant("pend", { requiresApproval: true });
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { pendingExpirationMinutes: 15 } });
    const { booking } = await createBooking(t.ctx, onlineInput(t.court.id, at(DAY, "20:00")), publicActor, opts);
    await owner.$executeRaw`UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = ${booking.id}::uuid`;
    const results = await Promise.all([tick(), tick(), tick()]);
    expect(results.every((r) => r.expire.ok && r.send.ok)).toBe(true);
    expect((await owner.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("EXPIRED");
    const expired = await owner.notification.findMany({ where: { kind: "booking_expired" } });
    expect(expired).toHaveLength(1);
    expect(expired[0]!.status).toBe("SENT");
    expect(await owner.auditLog.count({ where: { action: "booking.status.expired", entityId: booking.id } })).toBe(1);
  });

  it("una falla repetida queda registrada y cuenta fallas consecutivas", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await runJob("prueba_falla", async () => {
        throw new Error("boom postgresql://user:pass@host/db");
      });
      expect(r.ok).toBe(false);
    }
    const run = await owner.jobRun.findUniqueOrThrow({ where: { name: "prueba_falla" } });
    expect(run.consecutiveFailures).toBe(3);
    expect(run.lastError).not.toContain("pass@");
    await runJob("prueba_falla", async () => "ok");
    expect((await owner.jobRun.findUniqueOrThrow({ where: { name: "prueba_falla" } })).consecutiveFailures).toBe(0);
  });

  it("la limpieza borra solo lo vencido y nunca reservas ni auditoría", async () => {
    const u = await makeUser("x@ops.test");
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    const old = new Date(Date.now() - 400 * 86_400_000);
    await owner.rateLimit.create({ data: { key: "viejo", count: 1, windowStart: old } });
    await owner.rateLimit.create({ data: { key: "nuevo", count: 1, windowStart: new Date() } });
    await owner.session.create({ data: { userId: u.id, token: "s-vieja-0123456789", expiresAt: old } });
    await owner.session.create({ data: { userId: u.id, token: "s-viva-0123456789", expiresAt: new Date(Date.now() + 86_400_000) } });
    await owner.verification.create({ data: { identifier: "reset-password:x", value: "v", expiresAt: old } });
    await owner.notification.updateMany({ data: { status: "SENT", createdAt: old } });
    const audits = await owner.auditLog.count();
    const r = await cleanup();
    expect(r).toMatchObject({ rateLimits: 1, sessions: 1, verifications: 1, notifications: 1 });
    expect(await owner.notification.count()).toBe(0);
    expect(await owner.rateLimit.count()).toBe(1);
    expect(await owner.session.count()).toBe(1);
    expect(await owner.booking.count()).toBe(1);
    expect(await owner.auditLog.count()).toBe(audits);
  });
});

describe("superadministrador: planes, límites y auditoría", () => {
  it("solo un superadmin gestiona planes y ve la auditoría", async () => {
    const comun = await makeUser("comun@ops.test", { tenantId: f.tenant.id, role: "OWNER" });
    await expectCode(listPlans(comun), "FORBIDDEN");
    await expectCode(savePlan(comun, null, { code: "pro", name: "Pro", priceAmount: 1, maxCourts: null, maxMembers: null }), "FORBIDDEN");
    await expectCode(listAuditLogs(comun, {}), "FORBIDDEN");
  });

  it("asignar un plan aplica el límite de canchas sin borrar las existentes", async () => {
    const sa = await makeUser("sa@ops.test", { platformRole: "SUPERADMIN" });
    const dueno = await makeUser("d@ops.test", { tenantId: f.tenant.id, role: "OWNER" });
    const plan = await savePlan(sa, null, { code: "basico", name: "Básico", priceAmount: 15000, maxCourts: 1, maxMembers: 2 });
    await expectCode(savePlan(sa, null, { code: "basico", name: "Repetido", priceAmount: 0, maxCourts: null, maxMembers: null }), "VALIDATION_ERROR");
    const r = await assignSubscription(sa, { tenantId: f.tenant.id, planId: plan.id, status: "ACTIVE", currentPeriodStart: "2026-01-01", currentPeriodEnd: "2027-01-01" });
    expect(r.warnings.join()).toMatch(/2 canchas/);
    expect(await owner.court.count({ where: { tenantId: f.tenant.id } })).toBe(2);
    await expectCode(
      createCourt({ tenantId: f.tenant.id, userId: dueno.id }, { name: "Cancha 3", sport: "PADEL", slotStepMinutes: 30, allowedDurations: [60] } as never, { type: "USER", userId: dueno.id }),
      "LIMIT_REACHED",
    );
    // Reasignar cancela la suscripción viva anterior (queda como historial).
    await assignSubscription(sa, { tenantId: f.tenant.id, planId: plan.id, status: "TRIAL", currentPeriodStart: "2026-01-01", currentPeriodEnd: "2027-01-01" });
    expect(await owner.subscription.count({ where: { tenantId: f.tenant.id, status: "CANCELLED" } })).toBe(1);

    const logs = await listAuditLogs(sa, { action: "platform." });
    expect(logs.rows.map((l) => l.action)).toEqual(expect.arrayContaining(["platform.plan.created", "platform.subscription.assigned"]));
    expect(logs.rows.every((l) => l.action.startsWith("platform."))).toBe(true);
    const scoped = await listAuditLogs(sa, { tenantId: f.tenant.id, action: "platform.subscription" });
    expect(scoped.rows).toHaveLength(2);
    await expectCode(listAuditLogs(sa, { action: "x'; DROP TABLE users; --" }), "VALIDATION_ERROR");
  });
});

describe("exportaciones CSV", () => {
  it("escapa comillas y neutraliza fórmulas (CSV injection)", () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+54 11")).toBe(`"'+54 11"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell("normal")).toBe('"normal"');
  });

  it("exporta solo las reservas del complejo, con hora local, y queda auditado", async () => {
    const otro = await makeTenant("ajeno");
    await createBooking(f.ctx, { ...onlineInput(f.court.id, at(DAY, "20:00")), customer: { name: "=cmd|' /C calc'!A0", phone: "11 5555-0001", email: "a@example.com" } }, publicActor, opts);
    await createBooking(otro.ctx, onlineInput(otro.court.id, at(DAY, "20:00"), 90, 7), publicActor, opts);
    const dueno = await makeUser("d@ops.test", { tenantId: f.tenant.id, role: "OWNER" });
    const csv = await exportBookingsCsv({ tenantId: f.tenant.id, userId: dueno.id }, TZ, { from: DAY, to: DAY }, { type: "USER", userId: dueno.id });
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"${DAY} 20:00"`);
    expect(lines[1]).toContain(`"'=cmd|' /C calc'!A0"`);
    expect(csv).not.toContain("jugador7@example.com");
    const clientes = await exportCustomersCsv({ tenantId: f.tenant.id, userId: dueno.id }, { type: "USER", userId: dueno.id });
    expect(clientes).not.toContain("Jugador 7");
    expect(await owner.auditLog.count({ where: { action: "data.exported", tenantId: f.tenant.id } })).toBe(2);
  });
});

describe("calendario y cambios de horario", () => {
  it("resumen mensual agrupa por día local y marca cierres", async () => {
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, opts);
    await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "23:30"), 90, 2), publicActor, opts);
    const dueno = await makeUser("d@ops.test", { tenantId: f.tenant.id, role: "OWNER" });
    const actor = { type: "USER" as const, userId: dueno.id };
    await createScheduleException(f.ctx, { courtId: null, date: "2030-03-20", kind: "CLOSED", openMinute: null, closeMinute: null, reason: "Feriado" }, actor);
    const m = await getMonthSummary(f.ctx, TZ, "2030-03");
    expect(m.days[DAY]).toMatchObject({ total: 2 });
    expect(m.closed["2030-03-20"]).toBe("Feriado");
    expect(m.daysInMonth).toBe(31);
  });

  it("avisa cuántas reservas activas quedan fuera del nuevo horario sin modificarlas", async () => {
    const dueno = await makeUser("d@ops.test", { tenantId: f.tenant.id, role: "OWNER" });
    const actor = { type: "USER" as const, userId: dueno.id };
    const day = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString("en-CA", { timeZone: TZ });
    await owner.tenant.update({ where: { id: f.tenant.id }, data: { maxAdvanceDays: 60 } });
    const { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(day, "20:00")), publicActor);
    // Solo mañana: las reservas de la noche quedan afuera.
    const res = await replaceWeeklySchedule(f.ctx, [f.court.id], [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, openMinute: 480, closeMinute: 720 })), actor);
    expect(res.conflicts.count).toBe(1);
    expect(res.conflicts.sample[0]!.code).toBe(booking.code);
    expect((await owner.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("CONFIRMED");
    const ok = await createScheduleException(f.ctx, { courtId: f.court2.id, date: day, kind: "CLOSED", openMinute: null, closeMinute: null, reason: "Mantenimiento" }, actor);
    expect(ok.conflicts.count).toBe(0);
  });
});

describe("seguridad de la conexión de runtime", () => {
  it("la app se conecta con un rol sin BYPASSRLS y en UTC", async () => {
    const { inspectDbSafety } = await import("@/lib/db/safety");
    const s = await inspectDbSafety();
    expect(s).toMatchObject({ ok: true, role: "reservas_app" });
    expect(s.timezone.toUpperCase()).toMatch(/UTC/);
  });

  it("db/verify.sql pasa completo sobre la base de pruebas", async () => {
    const { readFile } = await import("node:fs/promises");
    const rows = await owner.$queryRawUnsafe<{ check_name: string; ok: boolean }[]>(await readFile("db/verify.sql", "utf8"));
    expect(rows.filter((r) => !r.ok).map((r) => r.check_name)).toEqual([]);
  });

  it("el seed de demostración se niega a correr contra una base remota", () => {
    let out = "";
    try {
      execSync("npx tsx prisma/seed.ts", { env: { ...process.env, NODE_ENV: "development", MIGRATION_DATABASE_URL: "postgresql://reservas_owner:x@ep-ejemplo.us-east-2.aws.neon.tech/turnup?sslmode=require" }, encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      out = String((e as { stderr?: string }).stderr ?? "");
    }
    expect(out).toContain("solo corre contra una base local");
  });
});

describe("integridad de migraciones", () => {
  it("la base migrada coincide exactamente con el esquema de Prisma (sin deriva)", () => {
    const out = execSync("npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code", {
      env: { ...process.env },
      encoding: "utf8",
    });
    expect(out).toMatch(/No difference detected|empty migration/i);
  });

  it("las restricciones críticas siguen existiendo (RLS y antisolapamiento)", async () => {
    const rls = await owner.$queryRaw<{ relname: string }[]>`SELECT relname FROM pg_class WHERE relrowsecurity AND relnamespace = 'public'::regnamespace`;
    const names = rls.map((r) => r.relname);
    for (const t of ["bookings", "court_allocations", "memberships", "invitations", "notifications", "audit_logs", "customers"]) expect(names).toContain(t);
    const ex = await owner.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_constraint WHERE contype = 'x' AND conrelid = 'court_allocations'::regclass`;
    expect(Number(ex[0]!.n)).toBeGreaterThanOrEqual(1);
  });
});
