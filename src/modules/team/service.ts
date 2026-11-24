import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { activePlanLimits } from "@/modules/platform/plans";
import type { MembershipRole } from "@/generated/prisma/client";
import { audit, type Actor } from "@/lib/audit";
import { isRaised, isUniqueViolation } from "@/lib/db/errors";
import { prisma } from "@/lib/db/prisma";
import { withSystem, withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { seal } from "@/lib/security/sealed";
import { parseOrThrow } from "@/lib/validation";
import { enqueue } from "@/modules/notifications/outbox";

/**
 * Equipo del complejo. Reglas (aplicadas en la app Y en la base por el trigger
 * memberships_guard):
 *  - OWNER: invita/gestiona ADMIN y STAFF.
 *  - ADMIN: invita/gestiona solo STAFF; no puede crear otros ADMIN.
 *  - STAFF: no gestiona el equipo.
 *  - Nadie cambia su propia membresía. El rol OWNER solo lo da la plataforma.
 */

const INVITATION_DAYS = 7;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function assignable(actorRole: MembershipRole): MembershipRole[] {
  return actorRole === "OWNER" ? ["ADMIN", "STAFF"] : actorRole === "ADMIN" ? ["STAFF"] : [];
}

export function canManage(actorRole: MembershipRole, targetRole: MembershipRole) {
  return assignable(actorRole).includes(targetRole);
}

function mapGuard(e: unknown): unknown {
  if (isRaised(e, "membership_self_change")) return new AppError("FORBIDDEN", { reason: "self" });
  if (isRaised(e, "membership_owner_forbidden") || isRaised(e, "membership_forbidden")) return new AppError("FORBIDDEN");
  return e;
}

export async function listTeam(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => {
    const members = await tx.membership.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: { id: true, role: true, isActive: true, createdAt: true, userId: true, user: { select: { name: true, email: true } } },
    });
    const invitations = await tx.invitation.findMany({
      where: { tenantId: ctx.tenantId, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    });
    return { members, invitations };
  });
}

async function planMemberLimit(ctx: TenantContext): Promise<number | null> {
  return withTenant(ctx, async (tx) => (await activePlanLimits(tx, ctx.tenantId)).maxMembers);
}

export const inviteSchema = z.object({
  email: z.email().max(254).transform((e) => e.trim().toLowerCase()),
  role: z.enum(["ADMIN", "STAFF"]),
});

/** Crea una invitación (token de 256 bits; se guarda solo su hash) y encola el email. */
export async function inviteMember(ctx: TenantContext, actorRole: MembershipRole, input: z.input<typeof inviteSchema>, actor: Actor) {
  const data = parseOrThrow(inviteSchema, input);
  if (!canManage(actorRole, data.role)) throw new AppError("FORBIDDEN");
  const limit = await planMemberLimit(ctx);
  const token = randomBytes(32).toString("base64url");
  const sealedToken = await seal(token);
  try {
    return await withTenant(ctx, async (tx) => {
      const existing = await tx.membership.findFirst({ where: { tenantId: ctx.tenantId, user: { email: data.email } }, select: { id: true } });
      if (existing) throw new AppError("VALIDATION_ERROR", { reason: "already_member" });
      if (limit !== null) {
        const used =
          (await tx.membership.count({ where: { tenantId: ctx.tenantId, isActive: true, role: { not: "OWNER" } } })) +
          (await tx.invitation.count({ where: { tenantId: ctx.tenantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }));
        if (used >= limit) throw new AppError("LIMIT_REACHED", { reason: "plan_members" });
      }
      const inv = await tx.invitation.create({
        data: {
          tenantId: ctx.tenantId,
          email: data.email,
          role: data.role,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
          invitedByUserId: actor.userId,
        },
        select: { id: true },
      });
      await enqueue(tx, { tenantId: ctx.tenantId, kind: "team_invitation", recipient: data.email, dedupeKey: `invitation:${inv.id}`, payload: { sealedToken } });
      await audit(tx, { tenantId: ctx.tenantId, actor, action: "team.invitation.created", entityType: "invitation", entityId: inv.id, metadata: { role: data.role } });
      return { id: inv.id, token };
    });
  } catch (e) {
    if (isUniqueViolation(e, "invitations_one_open_per_email")) throw new AppError("VALIDATION_ERROR", { reason: "already_invited" });
    throw e;
  }
}

export async function revokeInvitation(ctx: TenantContext, actorRole: MembershipRole, invitationId: string, actor: Actor) {
  parseOrThrow(z.uuid(), invitationId);
  return withTenant(ctx, async (tx) => {
    const inv = await tx.invitation.findFirst({ where: { id: invitationId, tenantId: ctx.tenantId, acceptedAt: null, revokedAt: null }, select: { role: true } });
    if (!inv) throw new AppError("NOT_FOUND");
    if (!canManage(actorRole, inv.role)) throw new AppError("FORBIDDEN");
    await tx.invitation.updateMany({ where: { id: invitationId, tenantId: ctx.tenantId }, data: { revokedAt: new Date() } });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "team.invitation.revoked", entityType: "invitation", entityId: invitationId });
  });
}

/** Cambio de rol o activación. Auditado como cambio de permisos. */
export async function updateMember(
  ctx: TenantContext,
  actorRole: MembershipRole,
  input: { membershipId: string; role?: MembershipRole; isActive?: boolean },
  actor: Actor,
) {
  parseOrThrow(z.uuid(), input.membershipId);
  try {
    return await withTenant(ctx, async (tx) => {
      const m = await tx.membership.findFirst({ where: { id: input.membershipId, tenantId: ctx.tenantId }, select: { id: true, role: true, isActive: true, userId: true } });
      if (!m) throw new AppError("NOT_FOUND");
      if (m.userId === actor.userId) throw new AppError("FORBIDDEN", { reason: "self" });
      if (!canManage(actorRole, m.role)) throw new AppError("FORBIDDEN");
      if (input.role && !canManage(actorRole, input.role)) throw new AppError("FORBIDDEN");
      const data = { ...(input.role ? { role: input.role } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) };
      await tx.membership.update({ where: { id: m.id }, data });
      await audit(tx, {
        tenantId: ctx.tenantId,
        actor,
        action: "team.member.permissions_changed",
        entityType: "membership",
        entityId: m.id,
        metadata: { targetUserId: m.userId, from: { role: m.role, isActive: m.isActive }, to: { role: input.role ?? m.role, isActive: input.isActive ?? m.isActive } },
      });
      // Al desactivar, se cierran las sesiones abiertas de esa persona.
      if (input.isActive === false) await prisma.session.deleteMany({ where: { userId: m.userId } });
    });
  } catch (e) {
    throw mapGuard(e);
  }
}

/** Datos públicos de una invitación (para la pantalla de aceptación). */
export async function describeInvitation(token: string) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new AppError("INVALID_LINK");
  const inv = await withSystem((tx) =>
    tx.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { email: true, role: true, expiresAt: true, acceptedAt: true, revokedAt: true, tenant: { select: { name: true, status: true } } },
    }),
  );
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= new Date() || inv.tenant.status !== "ACTIVE") throw new AppError("INVALID_LINK");
  const userExists = Boolean(await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } }));
  return { email: inv.email, role: inv.role, tenantName: inv.tenant.name, userExists };
}

/**
 * Acepta una invitación (un solo uso, atómico). Si la persona ya tiene cuenta,
 * debe estar logueada con ESE email. Si no, se crea la cuenta con su contraseña.
 */
export async function acceptInvitation(
  token: string,
  who: { currentUser: { id: string; email: string } | null; newAccount?: { name: string; password: string } },
) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new AppError("INVALID_LINK");
  const newAccount = who.newAccount
    ? parseOrThrow(z.object({ name: z.string().trim().min(2).max(100), password: z.string().min(12).max(128) }), who.newAccount)
    : null;
  const passwordHash = newAccount ? await hashPassword(newAccount.password) : null;
  return withSystem(async (tx) => {
    const now = new Date();
    // UPDATE condicionado: dos aceptaciones simultáneas => solo una gana.
    const claimed = await tx.invitation.updateMany({
      where: { tokenHash: hashToken(token), acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
    });
    if (claimed.count !== 1) throw new AppError("INVALID_LINK");
    const inv = await tx.invitation.findUniqueOrThrow({ where: { tokenHash: hashToken(token) }, select: { id: true, tenantId: true, email: true, role: true } });

    let userId: string;
    const existing = await tx.user.findUnique({ where: { email: inv.email }, select: { id: true } });
    if (existing) {
      if (!who.currentUser || who.currentUser.id !== existing.id) throw new AppError("UNAUTHENTICATED", { reason: "login_as_invited_email" });
      userId = existing.id;
    } else {
      if (!newAccount || !passwordHash) throw new AppError("VALIDATION_ERROR", { reason: "account_required" });
      const user = await tx.user.create({ data: { email: inv.email, name: newAccount.name, emailVerified: true }, select: { id: true } });
      await tx.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: passwordHash } });
      userId = user.id;
    }
    const m = await tx.membership.upsert({
      where: { tenantId_userId: { tenantId: inv.tenantId, userId } },
      create: { tenantId: inv.tenantId, userId, role: inv.role },
      update: {},
      select: { id: true },
    });
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedUserId: userId } });
    await audit(tx, { tenantId: inv.tenantId, actor: { type: "USER", userId }, action: "team.invitation.accepted", entityType: "membership", entityId: m.id, metadata: { role: inv.role, invitationId: inv.id } });
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: inv.tenantId }, select: { slug: true } });
    return { slug: tenant.slug, createdAccount: !existing };
  });
}
