import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createBooking } from "@/modules/booking/service";
import { suspendUser } from "@/modules/platform/users";
import { DAY, NOW, at, makeTenant, makeUser, onlineInput, owner, publicActor, resetDb, type Fixture } from "../support/fixtures";

let f: Fixture;
beforeEach(async () => { await resetDb(); f = await makeTenant("sec51"); });
afterAll(async () => { await prisma.$disconnect(); await owner.$disconnect(); });

/** Cada acción del servidor exportada debe autorizar ANTES de hacer nada (no alcanza con ocultar el botón). */
function exportedActions(path: string) {
  const src = readFileSync(path, "utf8");
  return [...src.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)].map((m) => ({ name: m[1]!, body: m[2]! }));
}

describe("seguridad Fase 5.1", () => {
  it("todas las acciones del superadmin exigen superadmin con 2FA", () => {
    const acts = exportedActions("src/app/admin/actions.ts");
    expect(acts.length).toBeGreaterThan(10);
    for (const a of acts) expect(a.body, a.name).toMatch(/requireSuperadmin\(\)/);
  });

  it("las acciones de cobros y transferencias del panel exigen el permiso correspondiente", () => {
    for (const a of exportedActions("src/app/panel/[slug]/transferencias/actions.ts")) {
      expect(a.body, a.name).toMatch(/requireTenant\(slug, "(payments\.verify|payments\.configure|booking\.manage)"\)/);
    }
    const settings = exportedActions("src/app/panel/[slug]/transferencias/actions.ts").find((a) => a.name === "savePaymentSettingsAction")!;
    expect(settings.body).toContain('"payments.configure"');
  });

  it("un usuario suspendido no puede reservar como usuario autenticado", async () => {
    const admin = await makeUser("root@sec51.test", { platformRole: "SUPERADMIN" });
    const player = await makeUser("jug@sec51.test");
    await suspendUser(admin, player.id, "Prueba de seguridad");
    await expect(createBooking(f.ctx, { ...onlineInput(f.court.id, at(DAY, "20:00")), playerUserId: player.id }, publicActor, { now: NOW }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await owner.booking.count({ where: { tenantId: f.tenant.id } })).toBe(0);
  });
});
