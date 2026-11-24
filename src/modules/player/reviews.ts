import { z } from "zod";
import { audit, type Actor } from "@/lib/audit";
import { prisma } from "@/lib/db/prisma";
import { withPlatformAdmin, withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";
import type { AuthUser } from "@/modules/access/authorize";
import { assertSuperadmin } from "@/modules/platform/plans";
import { publicTenantContext } from "@/modules/tenant/public";
import { findPlayerBooking } from "./bookings";

/**
 * Opiniones VERIFICADAS: solo de reservas propias efectivamente jugadas (confirmadas y
 * terminadas o marcadas como jugadas), una por reserva, dentro de los 90 días.
 * El complejo puede responder y denunciar, pero NO borrar ni ocultar: eso lo decide la
 * moderación de TURNUP (superadmin), para evitar que se oculten críticas legítimas.
 */

const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

export const reviewSchema = z.object({
  bookingId: z.uuid(),
  rating: z.coerce.number().int().min(1).max(5),
  comment: text(1000),
});

export async function createReview(userId: string, input: z.input<typeof reviewSchema>, now: Date = new Date()) {
  const data = parseOrThrow(reviewSchema, input);
  const b = await findPlayerBooking(userId, data.bookingId, now);
  if (!b.canReview) throw new AppError("REVIEW_NOT_ALLOWED");
  const ctx: TenantContext = { tenantId: b.tenantId, userId };
  try {
    return await withTenant(ctx, async (tx) => {
      const r = await tx.review.create({
        data: { tenantId: b.tenantId, bookingId: b.id, playerUserId: userId, rating: data.rating, comment: data.comment },
        select: { id: true },
      });
      await audit(tx, { tenantId: b.tenantId, actor: { type: "USER", userId }, action: "review.created", entityType: "review", entityId: r.id, metadata: { rating: data.rating } });
      return r;
    });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") throw new AppError("REVIEW_NOT_ALLOWED");
    throw e;
  }
}

export type PublicReview = { id: string; rating: number; comment: string | null; reply: string | null; repliedAt: Date | null; createdAt: Date; author: string };

export async function listPublicReviews(slug: string, limit = 20): Promise<PublicReview[]> {
  const rows = await prisma.$queryRaw<{ id: string; rating: number; comment: string | null; reply: string | null; replied_at: Date | null; created_at: Date; author: string }[]>`
    SELECT * FROM app_public_reviews(${slug}, ${limit}::integer)`;
  return rows.map((r) => ({ id: r.id, rating: Number(r.rating), comment: r.comment, reply: r.reply, repliedAt: r.replied_at, createdAt: r.created_at, author: r.author || "Jugador" }));
}

// -------------------------------------------------------------- Complejo

export async function listTenantReviews(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => {
    const rows = await tx.review.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, rating: true, comment: true, reply: true, repliedAt: true, status: true, createdAt: true,
        booking: { select: { code: true, customerName: true, startsAt: true } },
        _count: { select: { reports: { where: { resolvedAt: null } } } },
      },
    });
    const agg = await tx.review.aggregate({ where: { tenantId: ctx.tenantId, status: "PUBLISHED" }, _avg: { rating: true }, _count: true });
    return { rows, avg: agg._avg.rating, count: agg._count };
  });
}

export async function replyToReview(ctx: TenantContext, reviewId: string, reply: string, actor: Actor) {
  const data = parseOrThrow(z.object({ reviewId: z.uuid(), reply: z.string().trim().min(2).max(1000) }), { reviewId, reply });
  await withTenant(ctx, async (tx) => {
    const res = await tx.review.updateMany({ where: { id: data.reviewId, tenantId: ctx.tenantId }, data: { reply: data.reply, repliedAt: new Date() } });
    if (res.count !== 1) throw new AppError("NOT_FOUND");
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "review.replied", entityType: "review", entityId: data.reviewId, metadata: { length: data.reply.length } });
  });
}

const reportSchema = z.object({ reviewId: z.uuid(), reason: z.string().trim().min(3).max(300) });

export async function reportReviewAsComplex(ctx: TenantContext, reviewId: string, reason: string, actor: Actor & { userId: string }) {
  const data = parseOrThrow(reportSchema, { reviewId, reason });
  await withTenant(ctx, async (tx) => {
    const r = await tx.review.findFirst({ where: { id: data.reviewId, tenantId: ctx.tenantId }, select: { id: true } });
    if (!r) throw new AppError("NOT_FOUND");
    await tx.reviewReport.upsert({
      where: { reviewId_reporterUserId: { reviewId: r.id, reporterUserId: actor.userId } },
      create: { tenantId: ctx.tenantId, reviewId: r.id, reporterUserId: actor.userId, reporterKind: "COMPLEX", reason: data.reason },
      update: { reason: data.reason, resolvedAt: null, resolution: null },
    });
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "review.reported", entityType: "review", entityId: r.id, metadata: { by: "complex" } });
  });
}

/** Denuncia de un jugador con sesión sobre una opinión publicada (contenido ofensivo, falso, etc.). */
export async function reportReviewAsPlayer(userId: string, slug: string, reviewId: string, reason: string) {
  const data = parseOrThrow(reportSchema, { reviewId, reason });
  const ctx = await publicTenantContext(slug);
  await withTenant({ ...ctx, userId }, async (tx) => {
    const r = await tx.review.findFirst({ where: { id: data.reviewId, tenantId: ctx.tenantId, status: "PUBLISHED" }, select: { id: true } });
    if (!r) throw new AppError("NOT_FOUND");
    await tx.reviewReport.upsert({
      where: { reviewId_reporterUserId: { reviewId: r.id, reporterUserId: userId } },
      create: { tenantId: ctx.tenantId, reviewId: r.id, reporterUserId: userId, reporterKind: "PLAYER", reason: data.reason },
      update: {},
    });
  });
}

// -------------------------------------------------------------- Moderación (superadmin)

export async function listOpenReports(user: AuthUser) {
  assertSuperadmin(user);
  return withPlatformAdmin(user.id, (tx) =>
    tx.reviewReport.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true, reason: true, reporterKind: true, createdAt: true,
        review: { select: { id: true, rating: true, comment: true, reply: true, status: true } },
        tenant: { select: { name: true, slug: true } },
      },
    }),
  );
}

export async function moderateReview(user: AuthUser, reviewId: string, decision: "HIDE" | "KEEP" | "RESTORE", note: string) {
  const actor = assertSuperadmin(user);
  const data = parseOrThrow(z.object({ reviewId: z.uuid(), decision: z.enum(["HIDE", "KEEP", "RESTORE"]), note: z.string().trim().max(300) }), { reviewId, decision, note });
  await withPlatformAdmin(user.id, async (tx) => {
    const r = await tx.review.findUnique({ where: { id: data.reviewId }, select: { tenantId: true } });
    if (!r) throw new AppError("NOT_FOUND");
    if (data.decision !== "KEEP") await tx.review.update({ where: { id: data.reviewId }, data: { status: data.decision === "HIDE" ? "HIDDEN" : "PUBLISHED" } });
    await tx.reviewReport.updateMany({ where: { reviewId: data.reviewId, resolvedAt: null }, data: { resolvedAt: new Date(), resolution: `${data.decision}${data.note ? `: ${data.note}` : ""}` } });
    await audit(tx, { tenantId: r.tenantId, actor, action: "review.moderated", entityType: "review", entityId: data.reviewId, metadata: { decision: data.decision } });
  });
}
