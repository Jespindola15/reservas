import sharp, { type OutputInfo, type Sharp } from "sharp";
import { AwsClient } from "aws4fetch";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/** Objetivo de peso por imagen: 100–200 KB cuando se puede sin degradar demasiado la calidad. */
export const IMAGE_TARGET_BYTES = 200 * 1024;

/**
 * Codifica a WebP buscando quedar por debajo de IMAGE_TARGET_BYTES: baja la calidad en pasos y, si no
 * alcanza, reduce el tamaño. Nunca baja de calidad 55 ni de 960 px de ancho (las fotos se verían mal);
 * en ese caso se guarda la mejor versión posible aunque supere el objetivo.
 */
export async function encodeWithinBudget(
  input: Uint8Array,
  shape: (s: Sharp, width: number) => Sharp,
  opts: { maxWidth: number; startQuality?: number; target?: number },
): Promise<{ data: Buffer; contentType: "image/webp"; width: number; height: number }> {
  const target = opts.target ?? IMAGE_TARGET_BYTES;
  const widths = [opts.maxWidth, Math.round(opts.maxWidth * 0.8), Math.max(960, Math.round(opts.maxWidth * 0.64))].filter((w, i, a) => a.indexOf(w) === i && w <= opts.maxWidth);
  const qualities = [opts.startQuality ?? 80, 72, 64, 55];
  let best: { data: Buffer; info: OutputInfo } | null = null;
  for (const w of widths) {
    for (const q of qualities) {
      const out = await shape(sharp(input, { limitInputPixels: 40_000_000, failOn: "error" }).rotate(), w).webp({ quality: q, effort: 4 }).toBuffer({ resolveWithObject: true });
      if (!best || out.data.length < best.data.length) best = out;
      if (out.data.length <= target) return { data: out.data, contentType: "image/webp", width: out.info.width, height: out.info.height };
    }
  }
  return { data: best!.data, contentType: "image/webp", width: best!.info.width, height: best!.info.height };
}

/**
 * Procesa una foto de cancha (ya validada por firma de bytes): corrige la orientación, ELIMINA
 * metadatos (EXIF/GPS), limita a 1600 px y la convierte a WebP de ~100–200 KB.
 */
export async function optimizeImage(input: Uint8Array) {
  return encodeWithinBudget(input, (s, w) => s.resize({ width: w, height: w, fit: "inside", withoutEnlargement: true }), { maxWidth: 1600 });
}

/**
 * Almacenamiento de objetos compatible con S3. Hoy: Supabase Storage (protocolo S3). Cambiar de
 * proveedor (R2, AWS S3, MinIO, Backblaze) es cambiar variables de entorno, no código.
 */
export interface ObjectStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
  /** Comprobación liviana de que el almacenamiento responde (p. ej. proyecto gratuito pausado). */
  ping?(): Promise<boolean>;
}

/** Las claves incluyen un id nuevo en cada subida: el contenido de una URL nunca cambia. */
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

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
    if (!/^[a-z0-9/._-]{10,300}$/.test(key) || key.includes("..") || key.startsWith("/")) throw new Error("clave de objeto inválida");
    return `${this.endpoint.replace(/\/$/, "")}/${this.bucket}/${key}`;
  }

  async put(key: string, data: Uint8Array, contentType: string) {
    const res = await this.client.fetch(this.url(key), { method: "PUT", body: new Uint8Array(data), headers: { "Content-Type": contentType, "Cache-Control": IMMUTABLE_CACHE } });
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

  async ping() {
    try {
      const res = await this.client.fetch(`${this.endpoint.replace(/\/$/, "")}/${this.bucket}?list-type=2&max-keys=1`, { method: "GET", signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

/**
 * URL pública directa de una imagen comercial del catálogo (bucket público de solo lectura).
 * Así el navegador la descarga desde el CDN del proveedor y no pasa por las funciones de Netlify.
 * Si no hay URL pública configurada, la imagen se sirve a través de TURNUP.
 */
export function publicObjectUrl(key: string): string | null {
  const base = getEnv().IMAGE_PUBLIC_BASE_URL.replace(/\/$/, "");
  if (!base || !/^[a-z0-9/._-]{10,300}$/.test(key) || key.includes("..") || key.startsWith("/")) return null;
  return `${base}/${key}`;
}

let store: ObjectStore | null | undefined;

/** Store activo, o null si IMAGE_STORAGE=database (solo desarrollo y pruebas). */
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
 * Store para SUBIR imágenes nuevas. En producción las imágenes van solo al almacenamiento de objetos
 * (Supabase Storage): si no está configurado, la subida se rechaza con un error claro (nunca se
 * guardan bytes en PostgreSQL como alternativa silenciosa). Si el proveedor falla al subir, la
 * operación falla y no se borra la imagen anterior.
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
