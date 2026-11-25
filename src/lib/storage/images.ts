import sharp from "sharp";
import { AwsClient } from "aws4fetch";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Procesa una imagen subida (ya validada por firma de bytes):
 *  - corrige la orientación y ELIMINA metadatos (EXIF/GPS de fotos de celular);
 *  - limita a 1600 px y convierte a WebP (calidad 80): menos peso, misma nitidez;
 *  - rechaza imágenes gigantes en píxeles (bombas de descompresión).
 */
export async function optimizeImage(input: Uint8Array): Promise<{ data: Buffer; contentType: "image/webp"; width: number; height: number }> {
  const { data, info } = await sharp(input, { limitInputPixels: 40_000_000, failOn: "error" })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  return { data, contentType: "image/webp", width: info.width, height: info.height };
}

/** Almacenamiento compatible con S3 (Cloudflare R2, AWS S3, MinIO). */
export interface ObjectStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: AwsClient;
  constructor(
    private readonly endpoint: string,
    private readonly bucket: string,
    accessKeyId: string,
    secretAccessKey: string,
    region: string,
    fetchImpl?: typeof fetch,
  ) {
    this.client = new AwsClient({ accessKeyId, secretAccessKey, region, service: "s3", ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  }

  private url(key: string) {
    if (!/^[a-z0-9/._-]{10,300}$/.test(key)) throw new Error("clave de objeto inválida");
    return `${this.endpoint.replace(/\/$/, "")}/${this.bucket}/${key}`;
  }

  async put(key: string, data: Uint8Array, contentType: string) {
    const res = await this.client.fetch(this.url(key), { method: "PUT", body: new Uint8Array(data), headers: { "Content-Type": contentType } });
    if (!res.ok) throw new Error(`object put ${res.status}`);
  }

  async get(key: string) {
    const res = await this.client.fetch(this.url(key), { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`object get ${res.status}`);
    return { data: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  }

  async delete(key: string) {
    const res = await this.client.fetch(this.url(key), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`object delete ${res.status}`);
  }
}

let store: ObjectStore | null | undefined;

/** Store activo, o null si IMAGE_STORAGE=database (comportamiento por defecto, compatible con la Fase 2). */
export function getObjectStore(): ObjectStore | null {
  if (store !== undefined) return store;
  const env = getEnv();
  store =
    env.IMAGE_STORAGE === "object"
      ? new S3ObjectStore(env.S3_ENDPOINT, env.S3_BUCKET, env.S3_ACCESS_KEY_ID, env.S3_SECRET_ACCESS_KEY, env.S3_REGION)
      : null;
  return store;
}

/**
 * Store para SUBIR imágenes nuevas. En producción las imágenes van solo a R2: si no está configurado,
 * la subida se rechaza con un error claro (nunca se guardan bytes en PostgreSQL como alternativa
 * silenciosa). Si R2 falla al subir, la operación falla y no se borra la imagen anterior.
 */
export function uploadStore(): ObjectStore | null {
  const s = getObjectStore();
  if (s) return s;
  const env = getEnv();
  if (env.NODE_ENV === "production" && env.ALLOW_DB_IMAGES !== "true") {
    throw new AppError("IMAGE_STORAGE_REQUIRED");
  }
  return null;
}

/** Para pruebas: inyectar un store en memoria. */
export function setObjectStoreForTests(s: ObjectStore | null | undefined) {
  store = s;
}

export async function deleteObjectQuietly(key: string) {
  try {
    await getObjectStore()?.delete(key);
  } catch (e) {
    logger.warn("storage.delete_failed", { error: e instanceof Error ? e.message : String(e) });
  }
}
