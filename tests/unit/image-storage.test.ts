import { afterEach, describe, expect, it, vi } from "vitest";

/** Sin R2 configurado, producción rechaza subir imágenes (no hay alternativa silenciosa a PostgreSQL). */
describe("almacenamiento de imágenes", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  async function fresh(env: Record<string, string>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    return import("@/lib/storage/images");
  }

  it("producción sin R2: la subida falla con un error claro", async () => {
    const m = await fresh({ NODE_ENV: "production", IMAGE_STORAGE: "database", ALLOW_DB_IMAGES: "false", NEXT_PHASE: "phase-production-build" });
    expect(() => m.uploadStore()).toThrowError(expect.objectContaining({ code: "IMAGE_STORAGE_REQUIRED" }));
  });

  it("producción con R2: devuelve el almacenamiento de objetos", async () => {
    const m = await fresh({ NODE_ENV: "production", IMAGE_STORAGE: "object", S3_ENDPOINT: "https://cuenta.r2.cloudflarestorage.com", S3_BUCKET: "turnup-imagenes", S3_ACCESS_KEY_ID: "x", S3_SECRET_ACCESS_KEY: "y", NEXT_PHASE: "phase-production-build" });
    expect(m.uploadStore()).toBeInstanceOf(m.S3ObjectStore);
  });

  it("IMAGE_STORAGE=object sin credenciales: la configuración se rechaza al iniciar", async () => {
    const m = await fresh({ NODE_ENV: "production", IMAGE_STORAGE: "object", S3_ENDPOINT: "", S3_BUCKET: "", NEXT_PHASE: "phase-production-build" });
    expect(() => m.uploadStore()).toThrowError(/IMAGE_STORAGE=object requiere/);
  });
});
