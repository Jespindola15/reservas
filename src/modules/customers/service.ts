import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { audit, type Actor } from "@/lib/audit";
import { withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { AppError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";

/**
 * Clientes del complejo. Datos personales: solo visibles dentro del propio
 * tenant (filtro explícito + RLS). Las búsquedas neutralizan comodines LIKE.
 */
const PAGE_SIZE = 30;

export async function listCustomers(ctx: TenantContext, input: { q?: string; page?: number }) {
  const f = parseOrThrow(z.object({ q: z.string().trim().max(80).optional(), page: z.coerce.number().int().min(1).max(1000).default(1) }), input);
  const q = f.q?.replace(/[%_\\]/g, "").trim();
  const where: Prisma.CustomerWhereInput = { tenantId: ctx.tenantId };
  return withTenant(ctx, async (tx) => {
    if (q) {
      const digits = q.replace(/\D/g, "");
      // Teléfonos: se comparan solo los dígitos ("11 5555-0002" == "1155550002").
      const phoneIds =
        digits.length >= 3
          ? await tx.$queryRaw<{ id: string }[]>`
              SELECT id FROM customers
              WHERE tenant_id = ${ctx.tenantId}::uuid
                AND regexp_replace(coalesce(phone, ''), '\\D', '', 'g') LIKE '%' || ${digits} || '%'
              LIMIT 500`
          : [];
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        ...(phoneIds.length ? [{ id: { in: phoneIds.map((r) => r.id) } }] : []),
      ];
    }
    const total = await tx.customer.count({ where });
    const rows = await tx.customer.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        _count: {
          select: {
            bookings: true,
          },
        },
        bookings: { orderBy: { startsAt: "desc" }, take: 1, select: { startsAt: true } },
      },
    });
    const ids = rows.map((r) => r.id);
    const cancelled = ids.length
      ? await tx.booking.groupBy({
          by: ["customerId"],
          where: { tenantId: ctx.tenantId, customerId: { in: ids }, status: { in: ["CANCELLED", "NO_SHOW"] } },
          _count: { _all: true },
        })
      : [];
    const cancelledBy = new Map(cancelled.map((c) => [c.customerId, c._count._all]));
    return {
      total,
      page: f.page,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      rows: rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        bookings: r._count.bookings,
        cancellations: cancelledBy.get(r.id) ?? 0,
        lastBookingAt: r.bookings[0]?.startsAt ?? null,
      })),
    };
  });
}

export async function getCustomer(ctx: TenantContext, customerId: string) {
  parseOrThrow(z.uuid(), customerId);
  return withTenant(ctx, async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { id: customerId, tenantId: ctx.tenantId },
      select: { id: true, name: true, phone: true, email: true, notes: true, createdAt: true },
    });
    if (!customer) throw new AppError("NOT_FOUND");
    const bookings = await tx.booking.findMany({
      where: { tenantId: ctx.tenantId, customerId },
      orderBy: { startsAt: "desc" },
      take: 100,
      select: { id: true, code: true, status: true, startsAt: true, durationMinutes: true, priceAmount: true, currency: true, cancelReason: true, court: { select: { name: true } } },
    });
    const by = (s: string[]) => bookings.filter((b) => s.includes(b.status)).length;
    return {
      customer,
      bookings,
      stats: {
        total: bookings.length,
        confirmed: by(["CONFIRMED", "COMPLETED"]),
        cancelled: by(["CANCELLED"]),
        noShow: by(["NO_SHOW"]),
        expiredOrRejected: by(["EXPIRED", "REJECTED"]),
      },
    };
  });
}

export async function updateCustomerNotes(ctx: TenantContext, customerId: string, notes: string, actor: Actor) {
  parseOrThrow(z.uuid(), customerId);
  const clean = parseOrThrow(z.string().max(2000), notes).trim();
  return withTenant(ctx, async (tx) => {
    const res = await tx.customer.updateMany({ where: { id: customerId, tenantId: ctx.tenantId }, data: { notes: clean || null } });
    if (res.count !== 1) throw new AppError("NOT_FOUND");
    await audit(tx, { tenantId: ctx.tenantId, actor, action: "customer.notes.updated", entityType: "customer", entityId: customerId, metadata: { length: clean.length } });
  });
}
