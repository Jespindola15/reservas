import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { listPublicDirectory, updateBranding, getBranding } from "@/modules/tenant/branding";
import { makeTenant, makeUser, owner, resetDb } from "../support/fixtures";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); await owner.$disconnect(); });

describe("portada: listado público de complejos", () => {
  it("muestra solo activos con canchas que no se excluyeron, y solo datos públicos", async () => {
    const a = await makeTenant("dira31");
    const b = await makeTenant("dirb31");
    const c = await makeTenant("dirc31");
    await owner.tenant.update({ where: { id: c.tenant.id }, data: { status: "SUSPENDED" } });
    let list = await listPublicDirectory();
    expect(list.map((x) => x.slug).sort()).toEqual([a.tenant.slug, b.tenant.slug].sort());
    expect(Object.keys(list[0]!).sort()).toEqual(["address", "courtCount", "logoAssetId", "name", "slug", "sports"]);
    expect(list[0]!.courtCount).toBeGreaterThan(0);

    const u = await makeUser("d@dir31.test", { tenantId: b.tenant.id, role: "OWNER" });
    await updateBranding(b.ctx, { publicListed: false, services: ["Duchas"], brandColor: "#FF0000", instagram: "@miclub" }, { type: "USER", userId: u.id });
    list = await listPublicDirectory();
    expect(list.map((x) => x.slug)).toEqual([a.tenant.slug]);
    const br = await getBranding(b.ctx);
    expect(br).toMatchObject({ brandColor: "#ff0000", instagram: "miclub", services: ["Duchas"], publicListed: false });

    await owner.court.updateMany({ where: { tenantId: a.tenant.id }, data: { isActive: false } });
    expect(await listPublicDirectory()).toEqual([]);
  });
});

import sharp from "sharp";
import { addTenantAsset, deleteTenantAsset, getTenantAsset, MAX_GALLERY } from "@/modules/tenant/branding";
import { getOnboarding, markOnboardingStep } from "@/modules/tenant/onboarding";

describe("imágenes de marca y puesta en marcha", () => {
  it("recorta/optimiza, reemplaza el logo, limita la galería y aísla por complejo", async () => {
    const a = await makeTenant("asa31");
    const b = await makeTenant("asb31");
    const u = await makeUser("o@as31.test", { tenantId: a.tenant.id, role: "OWNER" });
    const actor = { type: "USER" as const, userId: u.id };
    const jpg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#3366ff" } }).jpeg().toBuffer();
    const l1 = await addTenantAsset(a.ctx, "LOGO", new Uint8Array(jpg), actor);
    const l2 = await addTenantAsset(a.ctx, "LOGO", new Uint8Array(jpg), actor);
    const rows = await owner.tenantAsset.findMany({ where: { tenantId: a.tenant.id, kind: "LOGO" } });
    expect(rows.map((r) => r.id)).toEqual([l2.id]);
    expect(rows[0]).toMatchObject({ width: 512, height: 512, contentType: "image/webp" });
    expect(await getTenantAsset(a.ctx, l1.id)).toBeNull();
    const cover = await addTenantAsset(a.ctx, "COVER", new Uint8Array(jpg), actor);
    expect(await owner.tenantAsset.findUniqueOrThrow({ where: { id: cover.id } })).toMatchObject({ width: 1600, height: 600 });
    // Otro complejo no puede leer ni borrar la imagen.
    expect(await getTenantAsset(b.ctx, l2.id)).toBeNull();
    await expect(deleteTenantAsset(b.ctx, l2.id, actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Archivo que no es imagen.
    await expect(addTenantAsset(a.ctx, "GALLERY", new TextEncoder().encode("<svg onload=alert(1)>"), actor)).rejects.toMatchObject({ code: "IMAGE_INVALID" });
    for (let i = 0; i < MAX_GALLERY; i++) await addTenantAsset(a.ctx, "GALLERY", new Uint8Array(jpg), actor);
    await expect(addTenantAsset(a.ctx, "GALLERY", new Uint8Array(jpg), actor)).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    // El directorio expone el id del logo.
    expect((await listPublicDirectory()).find((d) => d.slug === a.tenant.slug)?.logoAssetId).toBe(l2.id);
  });

  it("puesta en marcha: se calcula con datos reales y se retoma", async () => {
    const a = await makeTenant("onb31");
    const u = await makeUser("o@onb31.test", { tenantId: a.tenant.id, role: "OWNER" });
    let o = await getOnboarding(a.ctx);
    expect(o.steps.find((s) => s.n === 3)!.done).toBe(true); // el fixture trae cancha
    expect(o.finished).toBe(false);
    await markOnboardingStep(a.ctx, 6, { type: "USER", userId: u.id });
    await markOnboardingStep(a.ctx, 2, { type: "USER", userId: u.id }); // no retrocede
    o = await getOnboarding(a.ctx);
    expect(o.tenant.onboardingStep).toBe(6);
    expect(o.steps.find((s) => s.n === 6)!.done).toBe(true);
    await expect(markOnboardingStep(a.ctx, 5, { type: "USER", userId: u.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await markOnboardingStep(a.ctx, 7, { type: "USER", userId: u.id });
    expect((await getOnboarding(a.ctx)).finished).toBe(true);
  });
});

describe("ubicación del complejo", () => {
  it("guarda provincia y coordenadas (ambas o ninguna) y el catálogo las expone; la base rechaza valores inválidos", async () => {
    const a = await makeTenant("ubi4");
    const u = await makeUser("o@ubi4.test", { tenantId: a.tenant.id, role: "OWNER" });
    const actor = { type: "USER" as const, userId: u.id };
    await updateBranding(a.ctx, { publicListed: true, province: "Santa Fe", city: "Rosario", latitude: "-32.9477123", longitude: "-60.6304" }, actor);
    const cat = (await (await import("@/modules/marketplace/catalog")).loadCatalog()).find((c) => c.slug === a.tenant.slug)!;
    expect(cat).toMatchObject({ province: "Santa Fe", city: "Rosario", latitude: -32.947712, longitude: -60.6304 });
    // Solo una coordenada: se guardan ambas en null.
    await updateBranding(a.ctx, { publicListed: true, latitude: "-32.9", longitude: "" }, actor);
    expect(await owner.tenant.findUniqueOrThrow({ where: { id: a.tenant.id }, select: { latitude: true, longitude: true } })).toEqual({ latitude: null, longitude: null });
    await expect(updateBranding(a.ctx, { publicListed: true, latitude: "95", longitude: "10" }, actor)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(updateBranding(a.ctx, { publicListed: true, province: "Narnia" as never }, actor)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(owner.tenant.update({ where: { id: a.tenant.id }, data: { latitude: 10, longitude: null } })).rejects.toThrow();
  });
});
