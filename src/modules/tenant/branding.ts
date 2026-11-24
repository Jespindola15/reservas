import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { audit, type Actor } from "@/lib/audit";
import { prisma } from "@/lib/db/prisma";
import { withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { deleteObjectQuietly, getObjectStore } from "@/lib/storage/images";
import { parseOrThrow } from "@/lib/validation";
import { sniffImageType } from "@/modules/courts/service";

/**
 * Personalización de la página pública: marca, redes, servicios, política de
 * cancelación e imágenes (logo, portada, galería). Todo queda aislado por
 * complejo (filtro explícito + RLS) y se valida igual que los CHECK de la BD.
 */

export const SERVICE_OPTIONS = [
  "Vestuarios",
  "Duchas",
  "Estacionamiento",
  "Buffet / bar",
  "Parrilla",
  "Wi-Fi",
  "Iluminación nocturna",
  "Alquiler de pelotas y paletas",
  "Techada",
  "Accesible",
  "Seguridad",
  "Escuelita / clases",
] as const;

const blankToNull = (v: string | undefined) => (v ? v : null);
const handle = z
  .string()
  .trim()
  .max(60)
  .transform((v) => v.replace(/^https?:\/\/(www\.)?(instagram|facebook)\.com\//i, "").replace(/^@/, "").replace(/\/+$/, ""))
  .refine((v) => v === "" || /^[A-Za-z0-9._-]{1,60}$/.test(v), "Usuario inválido")
  .optional()
  .transform(blankToNull);

export const brandingSchema = z.object({
  brandColor: z
    .string()
    .trim()
    .regex(/^(#[0-9a-fA-F]{6})?$/)
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null)),
  whatsapp: z.string().trim().max(30).regex(/^[0-9+()\s.-]*$/).optional().transform(blankToNull),
  instagram: handle,
  facebook: handle,
  website: z
    .union([z.literal(""), z.url({ protocol: /^https?$/ }).max(200)])
    .optional()
    .transform((v) => blankToNull(v)),
  services: z.array(z.enum(SERVICE_OPTIONS)).max(20).default([]),
  cancellationPolicy: z.string().trim().max(1000).optional().transform(blankToNull),
  publicListed: z.boolean(),
  city: z.string().trim().max(80).optional().transform((v) => (v && v.length >= 2 ? v : null)),
  depositType: z.enum(["NONE", "PERCENT", "FIXED"]).default("NONE"),
  /** PERCENT: 1–100. FIXED: pesos (se guarda en centavos). */
  depositValue: z.coerce.number().min(0).max(1_000_000).default(0),
  depositNote: z.string().trim().max(300).optional().transform(blankToNull),
  announcement: z.string().trim().max(200).optional().transform((v) => (v && v.length >= 3 ? v : null)),
  announcementUntil: z.union([z.literal(""), z.iso.date()]).optional().transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null)),
}).transform((d) => ({
  ...d,
  depositValue: d.depositType === "NONE" ? 0 : d.depositType === "PERCENT" ? Math.min(100, Math.round(d.depositValue)) : Math.round(d.depositValue * 100),
  announcementUntil: d.announcement ? d.announcementUntil : null,
}));
export type BrandingInput = z.input<typeof brandingSchema>;

export async function getBranding(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
      select: {
        slug: true, name: true, brandColor: true, whatsapp: true, instagram: true, facebook: true, website: true,
        services: true, cancellationPolicy: true, publicListed: true,
        city: true, depositType: true, depositValue: true, depositNote: true, announcement: true, announcementUntil: true, currency: true,
      },
    });
    const assets = await tx.tenantAsset.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, kind: true, width: true, height: true, sizeBytes: true },
    });
    return { ...t, assets };
  });
}

export async function updateBranding(ctx: TenantContext, input: BrandingInput, actor: Actor) {
  const data = parseOrThrow(brandingSchema, input);
  return withTenant(ctx, async (tx) => {
    await tx.tenant.update({ where: { id: ctx.tenantId }, data });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "tenant.branding.updated", entityType: "tenant", entityId: ctx.tenantId, metadata: { ...data, cancellationPolicy: data.cancellationPolicy ? data.cancellationPolicy.length : 0 } });
  });
}

// ------------------------------------------------------------------ Imágenes

export const ASSET_KINDS = ["LOGO", "COVER", "GALLERY"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const MAX_GALLERY = 8;
export const MAX_ASSET_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_STORED_BYTES = 2_000_000; // = CHECK tenant_assets_size

/** Recorte y optimización por tipo: el logo es cuadrado, la portada apaisada. */
export async function processAsset(kind: AssetKind, input: Uint8Array) {
  const base = sharp(input, { limitInputPixels: 40_000_000, failOn: "error" }).rotate();
  const pipeline =
    kind === "LOGO"
      ? base.resize({ width: 512, height: 512, fit: "cover", position: "attention" })
      : kind === "COVER"
        ? base.resize({ width: 1600, height: 600, fit: "cover", position: "attention", withoutEnlargement: false })
        : base.resize({ width: 1600, height: 1200, fit: "inside", withoutEnlargement: true });
  const { data, info } = await pipeline.webp({ quality: kind === "LOGO" ? 85 : 78 }).toBuffer({ resolveWithObject: true });
  return { data, contentType: "image/webp" as const, width: info.width, height: info.height };
}

export async function addTenantAsset(ctx: TenantContext, kind: AssetKind, bytes: Uint8Array, actor: Actor) {
  parseOrThrow(z.enum(ASSET_KINDS), kind);
  if (bytes.length === 0 || bytes.length > MAX_ASSET_UPLOAD_BYTES) throw new AppError("IMAGE_INVALID");
  if (!sniffImageType(bytes)) throw new AppError("IMAGE_INVALID");
  let img;
  try {
    img = await processAsset(kind, bytes);
  } catch {
    throw new AppError("IMAGE_INVALID");
  }
  if (img.data.length > MAX_STORED_BYTES) throw new AppError("IMAGE_INVALID");
  if (kind === "GALLERY") {
    const n = await withTenant(ctx, (tx) => tx.tenantAsset.count({ where: { tenantId: ctx.tenantId, kind } }));
    if (n >= MAX_GALLERY) throw new AppError("LIMIT_REACHED", { resource: "gallery", max: MAX_GALLERY });
  }
  const store = getObjectStore();
  const objectKey = store ? `tenants/${ctx.tenantId}/brand/${kind.toLowerCase()}/${randomUUID()}.webp` : null;
  if (store && objectKey) await store.put(objectKey, img.data, img.contentType);
  const replaced: string[] = [];
  try {
    const created = await withTenant(ctx, async (tx) => {
      if (kind !== "GALLERY") {
        // Logo y portada son únicos: el nuevo reemplaza al anterior.
        const old = await tx.tenantAsset.findMany({ where: { tenantId: ctx.tenantId, kind }, select: { id: true, objectKey: true } });
        await tx.tenantAsset.deleteMany({ where: { tenantId: ctx.tenantId, kind } });
        old.forEach((o) => o.objectKey && replaced.push(o.objectKey));
      } else if ((await tx.tenantAsset.count({ where: { tenantId: ctx.tenantId, kind } })) >= MAX_GALLERY) {
        throw new AppError("LIMIT_REACHED", { resource: "gallery", max: MAX_GALLERY });
      }
      const sortOrder = kind === "GALLERY" ? await tx.tenantAsset.count({ where: { tenantId: ctx.tenantId, kind } }) : 0;
      const row = await tx.tenantAsset.create({
        data: {
          tenantId: ctx.tenantId,
          kind,
          storage: objectKey ? "OBJECT" : "DATABASE",
          data: objectKey ? null : new Uint8Array(img.data),
          objectKey,
          contentType: img.contentType,
          sizeBytes: img.data.length,
          width: img.width,
          height: img.height,
          sortOrder,
        },
        select: { id: true },
      });
      await audit(tx, { tenantId: ctx.tenantId, actor, action: "tenant.asset.added", entityType: "tenant", entityId: ctx.tenantId, metadata: { assetId: row.id, kind, bytes: img.data.length, original: bytes.length } });
      return row;
    });
    for (const k of replaced) await deleteObjectQuietly(k);
    return created;
  } catch (e) {
    if (objectKey) await deleteObjectQuietly(objectKey);
    throw e;
  }
}

export async function deleteTenantAsset(ctx: TenantContext, assetId: string, actor: Actor) {
  parseOrThrow(z.uuid(), assetId);
  const key = await withTenant(ctx, async (tx) => {
    const a = await tx.tenantAsset.findFirst({ where: { id: assetId, tenantId: ctx.tenantId }, select: { kind: true, objectKey: true } });
    if (!a) throw new AppError("NOT_FOUND");
    await tx.tenantAsset.deleteMany({ where: { id: assetId, tenantId: ctx.tenantId } });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "tenant.asset.deleted", entityType: "tenant", entityId: ctx.tenantId, metadata: { assetId, kind: a.kind } });
    return a.objectKey;
  });
  if (key) await deleteObjectQuietly(key);
}

export async function getTenantAsset(ctx: TenantContext, assetId: string): Promise<{ contentType: string; data: Uint8Array } | null> {
  parseOrThrow(z.uuid(), assetId);
  const a = await withTenant(ctx, (tx) =>
    tx.tenantAsset.findFirst({ where: { id: assetId, tenantId: ctx.tenantId }, select: { contentType: true, data: true, objectKey: true } }),
  );
  if (!a) return null;
  if (a.data) return { contentType: a.contentType, data: a.data };
  if (a.objectKey) {
    const obj = await getObjectStore()?.get(a.objectKey);
    return obj ? { contentType: a.contentType, data: obj.data } : null;
  }
  return null;
}

// ------------------------------------------------------------------ Directorio

export type DirectoryEntry = { slug: string; name: string; address: string | null; sports: string[]; courtCount: number; logoAssetId: string | null };

/** Complejos activos que aceptaron aparecer en la portada (solo datos públicos). */
export async function listPublicDirectory(limit = 60): Promise<DirectoryEntry[]> {
  const rows = await prisma.$queryRaw<{ slug: string; name: string; address: string | null; sports: string[]; court_count: number; logo_asset_id: string | null }[]>`
    SELECT slug, name, address, sports, court_count, logo_asset_id FROM app_public_directory(${limit}::integer)`;
  return rows.map((r) => ({ slug: r.slug, name: r.name, address: r.address, sports: r.sports, courtCount: r.court_count, logoAssetId: r.logo_asset_id }));
}
