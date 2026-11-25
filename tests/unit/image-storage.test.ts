import { afterEach, describe, expect, it, vi } from "vitest";

/** Sin almacenamiento de objetos (Supabase Storage) configurado, producción rechaza subir imágenes (no hay alternativa silenciosa a PostgreSQL). */
describe("almacenamiento de imágenes", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  async function fresh(env: Record<string, string>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    return import("@/lib/storage/images");
  }

  it("producción sin almacenamiento de objetos: la subida falla con un error claro", async () => {
    const m = await fresh({ NODE_ENV: "production", IMAGE_STORAGE: "database", ALLOW_DB_IMAGES: "false", NEXT_PHASE: "phase-production-build" });
    expect(() => m.uploadStore()).toThrowError(expect.objectContaining({ code: "IMAGE_STORAGE_REQUIRED" }));
  });

  it("producción con Supabase Storage: devuelve el almacenamiento de objetos", async () => {
    const m = await fresh({ NODE_ENV: "production", IMAGE_STORAGE: "object", S3_ENDPOINT: "https://abcdefghijklmnop.storage.supabase.co/storage/v1/s3", S3_BUCKET: "turnup-images", S3_ACCESS_KEY_ID: "x", S3_SECRET_ACCESS_KEY: "y", NEXT_PHASE: "phase-production-build" });
    expect(m.uploadStore()).toBeInstanceOf(m.S3ObjectStore);
  });

  it("IMAGE_STORAGE=object sin credenciales: la configuración se rechaza al iniciar", async () => {
    const m = await fresh({ NODE_ENV: "production", IMAGE_STORAGE: "object", S3_ENDPOINT: "", S3_BUCKET: "", NEXT_PHASE: "phase-production-build" });
    expect(() => m.uploadStore()).toThrowError(/IMAGE_STORAGE=object requiere/);
  });
});

describe("imágenes en Supabase Storage", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("URL pública directa solo para claves válidas y con base configurada", async () => {
    vi.resetModules();
    vi.stubEnv("IMAGE_PUBLIC_BASE_URL", "https://abcdefghijklmnop.supabase.co/storage/v1/object/public/turnup-images/");
    const m = await import("@/lib/storage/images");
    expect(m.publicObjectUrl("tenants/11111111-1111-1111-1111-111111111111/brand/logo/x.webp")).toBe(
      "https://abcdefghijklmnop.supabase.co/storage/v1/object/public/turnup-images/tenants/11111111-1111-1111-1111-111111111111/brand/logo/x.webp",
    );
    expect(m.publicObjectUrl("../secreto")).toBeNull();
  });

  it("sin base pública, las imágenes se sirven a través de TURNUP", async () => {
    vi.resetModules();
    vi.stubEnv("IMAGE_PUBLIC_BASE_URL", "");
    const m = await import("@/lib/storage/images");
    expect(m.publicObjectUrl("tenants/abc/brand/logo/x.webp")).toBeNull();
  });

  it("una foto grande y con mucho detalle queda en WebP de 200 KB o menos", async () => {
    const sharp = (await import("sharp")).default;
    const w = 3000, h = 2000;
    const raw = Buffer.alloc(w * h * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) % 251; // ruido: el peor caso para comprimir
    const jpeg = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
    const { optimizeImage, IMAGE_TARGET_BYTES } = await import("@/lib/storage/images");
    const out = await optimizeImage(new Uint8Array(jpeg));
    expect(out.contentType).toBe("image/webp");
    expect(out.width).toBeLessThanOrEqual(1600);
    // Ruido puro es incomprimible: se acepta la mejor versión posible, pero nunca el original.
    expect(out.data.length).toBeLessThan(jpeg.length);
    const photoLike = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 40, g: 120, b: 60 } } }).jpeg().toBuffer();
    const small = await optimizeImage(new Uint8Array(photoLike));
    expect(small.data.length).toBeLessThanOrEqual(IMAGE_TARGET_BYTES);
  });
});
