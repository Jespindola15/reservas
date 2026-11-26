import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withPlayer } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/http";
import { parseOrThrow } from "@/lib/validation";

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
      select: { phone: true, city: true, favoriteSports: true, notifyEmail: true, notifyReminders: true },
    });
    // Usuarios creados antes de la Fase 4 (p. ej. dueños) no tienen perfil: se crea vacío al usarlo.
    return p ?? { phone: null, city: null, favoriteSports: [] as string[], notifyEmail: true, notifyReminders: true };
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

/**
 * Emails de alta del jugador: bienvenida (prioridad baja) y verificación de email (crítica).
 * Nunca hace fallar el registro: si algo falla, la cuenta ya existe y se puede reenviar la
 * verificación desde el perfil.
 */
export async function sendPlayerOnboardingEmails(userId: string, email: string) {
  const { withSystem } = await import("@/lib/db/tenant-context");
  const { enqueue } = await import("@/modules/notifications/outbox");
  await withSystem((tx) => enqueue(tx, { tenantId: null, kind: "player_welcome", recipient: email, dedupeKey: `welcome:player:${userId}` }));
  await requestEmailVerification(email);
}

/** Pide a Better Auth el enlace de verificación (firmado, 24 h); el email sale por la cola. */
export async function requestEmailVerification(email: string) {
  const { getAuth } = await import("@/lib/auth/auth");
  await getAuth().api.sendVerificationEmail({ body: { email, callbackURL: "/perfil?verificado=1" } });
}
