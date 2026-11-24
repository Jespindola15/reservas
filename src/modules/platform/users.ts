import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { withPlatformAdmin, type Tx } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";
import type { AuthUser } from "@/modules/access/authorize";
import { assertSuperadmin } from "./plans";

/**
 * Administración de USUARIOS por el superadministrador.
 * - Nunca se leen ni devuelven contraseñas, tokens de sesión, secretos de 2FA ni cuentas OAuth:
 *   las consultas seleccionan campos explícitos.
 * - Suspender = bloquear el ingreso (isDisabled) + cerrar todas las sesiones al instante.
 * - Eliminar = ANONIMIZAR (baja lógica): se borran los datos personales y credenciales, pero se
 *   conservan las reservas y pagos de los complejos (son su historial contable).
 * - El último superadministrador activo no se puede suspender ni anonimizar, y nadie puede
 *   suspenderse o anonimizarse a sí mismo desde acá.
 */

export const USER_TYPES = ["todos", "jugador", "dueno", "admin", "personal", "superadmin"] as const;
export const USER_STATES = ["todos", "activo", "suspendido", "anonimizado"] as const;
const PAGE = 25;

const reasonSchema = z.string().trim().min(5, "Indicá el motivo (mínimo 5 caracteres).").max(300);

function typeWhere(tipo: string): Prisma.UserWhereInput {
  switch (tipo) {
    case "superadmin": return { platformRole: "SUPERADMIN" };
    case "dueno": return { memberships: { some: { role: "OWNER", isActive: true } } };
    case "admin": return { memberships: { some: { role: "ADMIN", isActive: true } } };
    case "personal": return { memberships: { some: { role: "STAFF", isActive: true } } };
    case "jugador": return { playerProfile: { isNot: null } };
    default: return {};
  }
}
function stateWhere(estado: string): Prisma.UserWhereInput {
  switch (estado) {
    case "activo": return { isDisabled: false, anonymizedAt: null };
    case "suspendido": return { isDisabled: true, anonymizedAt: null };
    case "anonimizado": return { anonymizedAt: { not: null } };
    default: return {};
  }
}

export async function listUsers(user: AuthUser, f: { q?: string; tipo?: string; estado?: string; page?: string; orden?: string }) {
  assertSuperadmin(user);
  const tipo = (USER_TYPES as readonly string[]).includes(f.tipo ?? "") ? f.tipo! : "todos";
  const estado = (USER_STATES as readonly string[]).includes(f.estado ?? "") ? f.estado! : "todos";
  const page = Math.max(1, Math.min(1000, Number(f.page) || 1));
  const q = f.q?.trim().slice(0, 80);
  const where: Prisma.UserWhereInput = {
    AND: [
      typeWhere(tipo),
      stateWhere(estado),
      q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {},
    ],
  };
  const orderBy: Prisma.UserOrderByWithRelationInput = f.orden === "nombre" ? { name: "asc" } : f.orden === "antiguos" ? { createdAt: "asc" } : { createdAt: "desc" };
  return withPlatformAdmin(user.id, async (tx) => {
    const [total, rows] = await Promise.all([
      tx.user.count({ where }),
      tx.user.findMany({
        where,
        orderBy,
        skip: (page - 1) * PAGE,
        take: PAGE,
        select: {
          id: true, name: true, email: true, platformRole: true, isDisabled: true, suspendedAt: true, anonymizedAt: true, createdAt: true,
          twoFactorEnabled: true,
          playerProfile: { select: { userId: true } },
          memberships: { where: { isActive: true }, select: { role: true, tenant: { select: { slug: true, name: true } } } },
        },
      }),
    ]);
    return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE)), tipo, estado, q: q ?? "" };
  });
}

export async function getUserDetail(user: AuthUser, userId: string, now: Date = new Date()) {
  assertSuperadmin(user);
  parseOrThrow(z.uuid(), userId);
  return withPlatformAdmin(user.id, async (tx) => {
    const u = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, emailVerified: true, platformRole: true, isDisabled: true, suspendedAt: true, suspendedReason: true,
        anonymizedAt: true, twoFactorEnabled: true, createdAt: true, updatedAt: true,
        playerProfile: { select: { city: true, createdAt: true } },
        memberships: { select: { id: true, role: true, isActive: true, createdAt: true, tenant: { select: { id: true, slug: true, name: true, status: true } } } },
      },
    });
    if (!u) throw new AppError("NOT_FOUND");
    const [sessions, lastSession, bookingsTotal, bookingsFuture, activity] = await Promise.all([
      tx.session.count({ where: { userId, expiresAt: { gt: now } } }),
      // Solo la fecha: nunca el token, IP completa ni agente.
      tx.session.findFirst({ where: { userId }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
      tx.booking.count({ where: { playerUserId: userId } }),
      tx.booking.count({ where: { playerUserId: userId, startsAt: { gt: now }, status: { in: ["PENDING", "CONFIRMED"] } } }),
      tx.auditLog.findMany({
        where: { OR: [{ actorUserId: userId }, { entityType: "user", entityId: userId }] },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, action: true, createdAt: true, tenantId: true },
      }),
    ]);
    return { user: u, sessions, lastSeenAt: lastSession?.updatedAt ?? null, bookingsTotal, bookingsFuture, activity };
  });
}

/** Bloquea cambios peligrosos: a uno mismo y al último superadministrador activo. */
async function guardTarget(tx: Tx, actor: AuthUser, targetId: string, op: "suspend" | "anonymize") {
  if (targetId === actor.id) throw new AppError("FORBIDDEN", { reason: "self" });
  const t = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, email: true, platformRole: true, isDisabled: true, anonymizedAt: true } });
  if (!t) throw new AppError("NOT_FOUND");
  if (t.anonymizedAt) throw new AppError("ALREADY_PROCESSED");
  if (t.platformRole === "SUPERADMIN") {
    const others = await tx.user.count({ where: { platformRole: "SUPERADMIN", isDisabled: false, anonymizedAt: null, id: { not: t.id } } });
    if (others === 0) throw new AppError("LAST_SUPERADMIN");
    // Un superadministrador no se anonimiza desde el panel: primero se le quita el rol (fuera de la app).
    if (op === "anonymize") throw new AppError("FORBIDDEN", { reason: "superadmin" });
  }
  return t;
}

export async function suspendUser(user: AuthUser, userId: string, reason: string, now: Date = new Date()) {
  const actor = assertSuperadmin(user);
  parseOrThrow(z.uuid(), userId);
  const why = parseOrThrow(reasonSchema, reason);
  return withPlatformAdmin(user.id, async (tx) => {
    const t = await guardTarget(tx, user, userId, "suspend");
    if (t.isDisabled) throw new AppError("ALREADY_PROCESSED");
    await tx.user.update({ where: { id: userId }, data: { isDisabled: true, suspendedAt: now, suspendedReason: why } });
    // Cierre inmediato: además de borrar las sesiones, getCurrentUser rechaza a usuarios deshabilitados.
    const { count } = await tx.session.deleteMany({ where: { userId } });
    await audit(tx, { tenantId: null, actor, action: "platform.user.suspended", entityType: "user", entityId: userId, metadata: { reason: why, sessionsRevoked: count } });
    return { sessionsRevoked: count };
  });
}

export async function reactivateUser(user: AuthUser, userId: string) {
  const actor = assertSuperadmin(user);
  parseOrThrow(z.uuid(), userId);
  return withPlatformAdmin(user.id, async (tx) => {
    const res = await tx.user.updateMany({ where: { id: userId, isDisabled: true, anonymizedAt: null }, data: { isDisabled: false, suspendedAt: null, suspendedReason: null } });
    if (res.count !== 1) throw new AppError("ALREADY_PROCESSED");
    await audit(tx, { tenantId: null, actor, action: "platform.user.reactivated", entityType: "user", entityId: userId });
  });
}

export async function revokeUserSessions(user: AuthUser, userId: string) {
  const actor = assertSuperadmin(user);
  parseOrThrow(z.uuid(), userId);
  return withPlatformAdmin(user.id, async (tx) => {
    const { count } = await tx.session.deleteMany({ where: { userId } });
    await audit(tx, { tenantId: null, actor, action: "platform.user.sessions_revoked", entityType: "user", entityId: userId, metadata: { count } });
    return count;
  });
}

/** Lo que pasaría al anonimizar (para mostrarlo ANTES de confirmar). */
export async function anonymizeImpact(user: AuthUser, userId: string, now: Date = new Date()) {
  assertSuperadmin(user);
  parseOrThrow(z.uuid(), userId);
  return withPlatformAdmin(user.id, async (tx) => {
    const [futureBookings, pastBookings, reviews, favorites, soleOwnerOf, memberships] = await Promise.all([
      tx.booking.count({ where: { playerUserId: userId, startsAt: { gt: now }, status: { in: ["PENDING", "CONFIRMED"] } } }),
      tx.booking.count({ where: { playerUserId: userId, startsAt: { lte: now } } }),
      tx.review.count({ where: { playerUserId: userId } }),
      tx.playerFavorite.count({ where: { userId } }),
      tx.tenant.findMany({
        where: { memberships: { some: { userId, role: "OWNER", isActive: true }, none: { role: "OWNER", isActive: true, userId: { not: userId } } } },
        select: { slug: true, name: true },
      }),
      tx.membership.count({ where: { userId, isActive: true } }),
    ]);
    const blockers = [
      ...(futureBookings ? [`Tiene ${futureBookings} reserva(s) futura(s) activa(s): cancelalas o pedí al complejo que las resuelva.`] : []),
      ...soleOwnerOf.map((t) => `Es el único dueño de "${t.name}": asigná otro dueño antes.`),
    ];
    return { futureBookings, pastBookings, reviews, favorites, memberships, soleOwnerOf, blockers };
  });
}

/**
 * Baja con anonimización. Se borran credenciales (contraseña, 2FA, sesiones), perfil de jugador,
 * favoritos y accesos a complejos; nombre y email se reemplazan. Las reservas pasadas y sus pagos
 * QUEDAN (historial contable del complejo) desvinculadas de la cuenta. No es reversible.
 */
export async function anonymizeUser(user: AuthUser, userId: string, confirmEmail: string, now: Date = new Date()) {
  const actor = assertSuperadmin(user);
  parseOrThrow(z.uuid(), userId);
  return withPlatformAdmin(user.id, async (tx) => {
    const t = await guardTarget(tx, user, userId, "anonymize");
    if (confirmEmail.trim().toLowerCase() !== t.email.toLowerCase()) throw new AppError("VALIDATION_ERROR", { fields: ["confirmEmail"] });
    const impact = await tx.booking.count({ where: { playerUserId: userId, startsAt: { gt: now }, status: { in: ["PENDING", "CONFIRMED"] } } });
    if (impact > 0) throw new AppError("USER_HAS_FUTURE_BOOKINGS");
    const soleOwner = await tx.tenant.count({
      where: { memberships: { some: { userId, role: "OWNER", isActive: true }, none: { role: "OWNER", isActive: true, userId: { not: userId } } } },
    });
    if (soleOwner > 0) throw new AppError("OWNER_REASSIGN_REQUIRED");

    const sessions = await tx.session.deleteMany({ where: { userId } });
    await tx.account.deleteMany({ where: { userId } });
    await tx.twoFactor.deleteMany({ where: { userId } });
    await tx.playerFavorite.deleteMany({ where: { userId } });
    await tx.playerProfile.deleteMany({ where: { userId } });
    await tx.membership.updateMany({ where: { userId }, data: { isActive: false } });
    // Desvincula (no borra) sus reservas: el complejo conserva su historial.
    await tx.booking.updateMany({ where: { playerUserId: userId }, data: { playerUserId: null } });
    await tx.inboxNotification.deleteMany({ where: { userId } });
    await tx.user.update({
      where: { id: userId },
      data: { name: "Usuario eliminado", email: `eliminado-${userId}@anonimo.turnup.invalid`, image: null, emailVerified: false, isDisabled: true, anonymizedAt: now, suspendedReason: null },
    });
    await audit(tx, { tenantId: null, actor, action: "platform.user.anonymized", entityType: "user", entityId: userId, metadata: { sessionsRevoked: sessions.count } });
  });
}

/** Correo de recuperación de contraseña (el superadmin nunca ve ni define la contraseña). */
export async function sendPasswordRecovery(user: AuthUser, userId: string) {
  const actor = assertSuperadmin(user);
  parseOrThrow(z.uuid(), userId);
  const target = await withPlatformAdmin(user.id, (tx) => tx.user.findUnique({ where: { id: userId }, select: { email: true, isDisabled: true, anonymizedAt: true } }));
  if (!target || target.anonymizedAt) throw new AppError("NOT_FOUND");
  if (target.isDisabled) throw new AppError("FORBIDDEN", { reason: "suspended" });
  const { getAuth } = await import("@/lib/auth/auth");
  await getAuth().api.requestPasswordReset({ body: { email: target.email, redirectTo: "/restablecer" } });
  await withPlatformAdmin(user.id, (tx) => audit(tx, { tenantId: null, actor, action: "platform.user.password_recovery_sent", entityType: "user", entityId: userId }));
}

export async function updateUserName(user: AuthUser, userId: string, name: string) {
  const actor = assertSuperadmin(user);
  parseOrThrow(z.uuid(), userId);
  const n = parseOrThrow(z.string().trim().min(2).max(80), name);
  return withPlatformAdmin(user.id, async (tx) => {
    const res = await tx.user.updateMany({ where: { id: userId, anonymizedAt: null }, data: { name: n } });
    if (res.count !== 1) throw new AppError("NOT_FOUND");
    await audit(tx, { tenantId: null, actor, action: "platform.user.updated", entityType: "user", entityId: userId, metadata: { fields: ["name"] } });
  });
}
