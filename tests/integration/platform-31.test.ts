import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/tenant-context";
import { processNotifications } from "@/modules/notifications/processor";
import { MemoryProvider } from "@/modules/notifications/providers";
import { computeMrr, platformOverview, recordSubscriptionPayment, tenantActivity } from "@/modules/platform/billing";
import { assignSubscription, savePlan } from "@/modules/platform/plans";
import { assignTenantAdmin } from "@/modules/platform/service";
import { makeTenant, makeUser, owner, resetDb } from "../support/fixtures";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); await owner.$disconnect(); });

describe("superadmin: métricas, cobro manual y bienvenida", () => {
  it("MRR solo de suscripciones activas vigentes", () => {
    const now = new Date("2030-01-15T00:00:00Z");
    const later = new Date("2030-02-15T00:00:00Z");
    const past = new Date("2030-01-01T00:00:00Z");
    expect(computeMrr([
      { status: "ACTIVE", currentPeriodEnd: later, plan: { priceAmount: 100 } },
      { status: "PAST_DUE", currentPeriodEnd: later, plan: { priceAmount: 50 } },
      { status: "TRIAL", currentPeriodEnd: later, plan: { priceAmount: 999 } },
      { status: "ACTIVE", currentPeriodEnd: past, plan: { priceAmount: 999 } },
    ], now)).toBe(150);
  });

  it("registra un pago, activa y extiende la suscripción, y no lo permite a quien no es superadmin", async () => {
    const f = await makeTenant("pl31");
    const sa = await makeUser("sa@pl31.test", { platformRole: "SUPERADMIN" });
    const plan = await savePlan(sa, null, { code: "pro31", name: "Pro", priceAmount: 2_000_000, maxCourts: null, maxMembers: null });
    const now = new Date();
    const end = new Date(now.getTime() + 3 * 86_400_000);
    await assignSubscription(sa, { tenantId: f.tenant.id, planId: plan.id, status: "TRIAL", currentPeriodStart: now.toISOString(), currentPeriodEnd: end.toISOString() });
    let o = await platformOverview(sa, now);
    expect(o).toMatchObject({ tenants: 1, active: 1, trial: 1, expiringSoon: 1, mrr: 0 });

    const r = await recordSubscriptionPayment(sa, { tenantId: f.tenant.id, amount: "20000", method: "TRANSFER", paidAt: now.toISOString(), periodStart: "2099-01-01", periodEnd: "2099-01-31" });
    expect(r.extendedTo?.toISOString()).toBe("2099-02-01T03:00:00.000Z");
    const sub = await owner.subscription.findUniqueOrThrow({ where: { id: r.subscriptionId! } });
    expect(sub.status).toBe("ACTIVE");
    o = await platformOverview(sa, now);
    expect(o).toMatchObject({ trial: 0, mrr: 2_000_000, collected30d: 2_000_000 });
    expect((await tenantActivity(sa, now)).lastPaymentAt.get(f.tenant.id)).toBeTruthy();

    const normal = await makeUser("u@pl31.test", { tenantId: f.tenant.id, role: "OWNER" });
    await expect(recordSubscriptionPayment(normal, { tenantId: f.tenant.id, amount: "1", method: "CASH", paidAt: now.toISOString(), periodStart: "2099-01-01", periodEnd: "2099-01-31" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordSubscriptionPayment(sa, { tenantId: f.tenant.id, amount: "-5", method: "CASH", paidAt: now.toISOString(), periodStart: "2099-01-01", periodEnd: "2099-01-31" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    // El complejo ve sus pagos de suscripción, otro complejo no.
    const g = await makeTenant("pl31b");
    expect(await withTenant(f.ctx, (tx) => tx.subscriptionPayment.count())).toBe(1);
    expect(await withTenant(g.ctx, (tx) => tx.subscriptionPayment.count())).toBe(0);
  });

  it("al asignar un dueño se encola UNA bienvenida y el email lleva a la puesta en marcha", async () => {
    const f = await makeTenant("wel31");
    const sa = await makeUser("sa@wel31.test", { platformRole: "SUPERADMIN" });
    const input = { tenantId: f.tenant.id, name: "Dueña Nueva", email: "nueva@wel31.test", role: "OWNER" as const, initialPassword: "una-clave-bien-larga-31" };
    await assignTenantAdmin(sa, input);
    await assignTenantAdmin(sa, { ...input, initialPassword: undefined });
    expect(await owner.notification.count({ where: { kind: "tenant_welcome" } })).toBe(1);
    const mem = new MemoryProvider();
    await processNotifications({ provider: mem });
    const mail = mem.sent.find((m) => m.to === "nueva@wel31.test")!;
    expect(mail.subject).toContain("Bienvenido a TURNUP");
    expect(mail.html).toContain(`/panel/${f.tenant.slug}/bienvenida`);
  });
});
