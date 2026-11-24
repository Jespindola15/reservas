import { hashPassword } from "better-auth/crypto";
import sharp from "sharp";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withPlayer } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/http";
import { parseOrThrow } from "@/lib/validation";
import { sniffImageType } from "@/modules/courts/service";

/**
 * Cuenta de JUGADOR. Es un usuario común (platformRole USER) sin membresías: no tiene
 * acceso a ningún panel. Registrarse acá nunca otorga permisos sobre un complejo.
 */

export const PLAYER_SPORTS = ["FOOTBALL_5", "FOOTBALL_7", "FOOTBALL_8", "FOOTBALL_11", "PADEL", "OTHER"] as const;

const phone = z.string().trim().max(30).regex(/^[0-9+()\s.-]*$/, "Teléfono inválido").optional().transform((v) => v || null);
const city = z.string().trim().max(80).optional().transform((v) => (v && v.length >= 2 ? v : null));

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().trim().toLowerCase().max(254),
  password: z.string().min(12).max(128),
  phone,
  city,
  acceptTerms: z.literal(true),
  website: z.string().max(0).optional(), // campo trampa
});

export async function registerPlayer(input: z.input<typeof registerSchema>, ip: string) {
  const data = parseOrThrow(registerSchema, input);
  await enforceRateLimit(`player-register:ip:${ip}`, ip === "unknown" ? { window: 3600, max: 100 } : { window: 3600, max: 5 });
  const exists = await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } });
  if (exists) throw new AppError("EMAIL_TAKEN");
  const hash = await hashPassword(data.password);
  // users/accounts no tienen RLS (los maneja Better Auth); el perfil sí (contexto de jugador).
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { email: data.email, name: data.name }, select: { id: true } });
    await tx.account.create({ data: { userId: u.id, accountId: u.id, providerId: "credential", password: hash } });
    return u;
  });
  await withPlayer(user.id, (tx) => tx.playerProfile.create({ data: { userId: user.id, phone: data.phone, city: data.city } }));
  return { userId: user.id };
}

export async function getPlayerProfile(userId: string) {
  return withPlayer(userId, async (tx) => {
    const p = await tx.playerProfile.findUnique({
      where: { userId },
      select: { phone: true, city: true, favoriteSports: true, notifyEmail: true, notifyReminders: true, avatarUpdatedAt: true },
    });
    // Usuarios creados antes de la Fase 4 (p. ej. dueños) no tienen perfil: se crea vacío al usarlo.
    return p ?? { phone: null, city: null, favoriteSports: [] as string[], notifyEmail: true, notifyReminders: true, avatarUpdatedAt: null };
  });
}

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone,
  city,
  favoriteSports: z.array(z.enum(PLAYER_SPORTS)).max(6).default([]),
  notifyEmail: z.boolean(),
  notifyReminders: z.boolean(),
});

export async function updatePlayerProfile(userId: string, input: z.input<typeof profileSchema>) {
  const { name, ...data } = parseOrThrow(profileSchema, input);
  await prisma.user.update({ where: { id: userId }, data: { name } });
  await withPlayer(userId, (tx) => tx.playerProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data }));
}

/** Foto de perfil opcional: se recorta a 256×256 WebP y se le quitan los metadatos. */
export async function setPlayerAvatar(userId: string, bytes: Uint8Array | null) {
  if (bytes === null) {
    await withPlayer(userId, (tx) => tx.playerProfile.updateMany({ where: { userId }, data: { avatar: null, avatarUpdatedAt: null } }));
    return;
  }
  if (bytes.length === 0 || bytes.length > 1_572_864 || !sniffImageType(bytes)) throw new AppError("IMAGE_INVALID");
  let out: Buffer;
  try {
    out = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).rotate().resize({ width: 256, height: 256, fit: "cover", position: "attention" }).webp({ quality: 80 }).toBuffer();
  } catch {
    throw new AppError("IMAGE_INVALID");
  }
  const avatar = new Uint8Array(out);
  await withPlayer(userId, (tx) =>
    tx.playerProfile.upsert({ where: { userId }, create: { userId, avatar, avatarUpdatedAt: new Date() }, update: { avatar, avatarUpdatedAt: new Date() } }),
  );
}

/** Solo el propio jugador puede leer su foto (RLS por app.player_id). */
export async function getPlayerAvatar(userId: string) {
  const p = await withPlayer(userId, (tx) => tx.playerProfile.findUnique({ where: { userId }, select: { avatar: true } }));
  return p?.avatar ?? null;
}
