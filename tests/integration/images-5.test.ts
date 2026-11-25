import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { setObjectStoreForTests, type ObjectStore } from "@/lib/storage/images";
import { migrateImages } from "@/lib/storage/migrate";
import { makeTenant, owner, resetDb, type Fixture } from "../support/fixtures";

class MemoryStore implements ObjectStore {
  objects = new Map<string, { data: Uint8Array; contentType: string }>();
  corrupt = false;
  async put(key: string, data: Uint8Array, contentType: string) { this.objects.set(key, { data: this.corrupt ? new Uint8Array([1, 2, 3]) : new Uint8Array(data), contentType }); }
  async get(key: string) { return this.objects.get(key) ?? null; }
  async delete(key: string) { this.objects.delete(key); }
}

let f: Fixture;
let store: MemoryStore;
const bytes = new Uint8Array(Buffer.from("RIFF....WEBPVP8 imagen de prueba"));

beforeEach(async () => {
  await resetDb();
  f = await makeTenant("img5");
  store = new MemoryStore();
  setObjectStoreForTests(store);
  await owner.tenantAsset.create({ data: { tenantId: f.tenant.id, kind: "LOGO", storage: "DATABASE", data: bytes, contentType: "image/webp", sizeBytes: bytes.length } });
  await owner.courtImage.create({ data: { tenantId: f.tenant.id, courtId: f.court.id, storage: "DATABASE", data: bytes, contentType: "image/webp", sizeBytes: bytes.length } });
});
afterEach(() => setObjectStoreForTests(undefined));
afterAll(async () => { await prisma.$disconnect(); await owner.$disconnect(); });

describe("migración de imágenes a almacenamiento de objetos (Supabase Storage)", () => {
  it("simulación no escribe nada; ejecución copia, verifica y conserva los bytes; --free-db los vacía", async () => {
    const lines: string[] = [];
    await migrateImages({ execute: false, freeDb: false, log: (l) => lines.push(l) });
    expect(store.objects.size).toBe(0);
    expect(JSON.parse(lines[0]!)).toMatchObject({ mode: "dry-run", tenantAssets: 1, courtImages: 1 });

    const r = await migrateImages({ execute: true, freeDb: false, log: () => undefined });
    expect(r).toMatchObject({ processed: 2, failed: [] });
    const keys = [...store.objects.keys()];
    expect(keys.every((k) => k.startsWith(`tenants/${f.tenant.id}/`))).toBe(true);
    const asset = await owner.tenantAsset.findFirstOrThrow({ where: { tenantId: f.tenant.id } });
    expect(asset.storage).toBe("OBJECT");
    expect(asset.data).not.toBeNull(); // respaldo hasta --free-db

    const freed = await migrateImages({ execute: false, freeDb: true, log: () => undefined });
    expect(freed.processed).toBe(2);
    expect((await owner.tenantAsset.findFirstOrThrow({ where: { tenantId: f.tenant.id } })).data).toBeNull();
    expect((await owner.courtImage.findFirstOrThrow({ where: { tenantId: f.tenant.id } })).data).toBeNull();
  });

  it("si la copia no coincide, no se marca ni se borra nada", async () => {
    store.corrupt = true;
    const r = await migrateImages({ execute: true, freeDb: false, log: () => undefined });
    expect(r.failed).toHaveLength(2);
    const asset = await owner.tenantAsset.findFirstOrThrow({ where: { tenantId: f.tenant.id } });
    expect(asset).toMatchObject({ storage: "DATABASE" });
    expect(asset.data).not.toBeNull();
  });

  it("--free-db no vacía bytes si el objeto desapareció del bucket", async () => {
    await migrateImages({ execute: true, freeDb: false, log: () => undefined });
    store.objects.clear();
    const r = await migrateImages({ execute: false, freeDb: true, log: () => undefined });
    expect(r.failed).toHaveLength(2);
    expect((await owner.tenantAsset.findFirstOrThrow({ where: { tenantId: f.tenant.id } })).data).not.toBeNull();
  });
});

describe("cupo de imágenes por complejo", () => {
  it("no se puede superar la cantidad máxima de imágenes del complejo", async () => {
    const { TENANT_IMAGE_MAX_COUNT } = await import("@/lib/storage/quota");
    const { addTenantAsset } = await import("@/modules/tenant/branding");
    const rows = Array.from({ length: TENANT_IMAGE_MAX_COUNT - 2 }, () => ({ tenantId: f.tenant.id, courtId: f.court.id, storage: "OBJECT" as const, objectKey: `tenants/${f.tenant.id}/courts/x/${crypto.randomUUID()}.webp`, contentType: "image/webp", sizeBytes: 1000 }));
    await owner.courtImage.createMany({ data: rows });
    const sharp = (await import("sharp")).default;
    const png = new Uint8Array(await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 200, b: 10 } } }).png().toBuffer());
    await expect(addTenantAsset(f.ctx, "GALLERY", png, { type: "SYSTEM", userId: null })).rejects.toMatchObject({ code: "LIMIT_REACHED" });
  });
});
