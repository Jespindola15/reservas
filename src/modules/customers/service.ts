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

/** Frecuente = 4 o más visitas en los últimos 90 días. Inactivo = sin turnos en 60 días. */
export const FREQUENT_MIN_VISITS = 4;
const FREQUENT_WINDOW_DAYS = 90;
const INACTIVE_DAYS = 60;
export const CUSTOMER_FILTERS = ["all", "frequent", "inactive", "noshow"] as const;

export async function listCustomers(
  ctx: TenantContext,
  input: { q?: string; page?: number; filter?: string },
  now: Date = new Date(),
) {
  const f = parseOrThrow(
    z.object({
      q: z.string().trim().max(80).optional(),
      page: z.coerce.number().int().min(1).max(1000).default(1),
      filter: z.enum(CUSTOMER_FILTERS).catch("all").default("all"),
    }),
    input,
  );
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
    if (f.filter === "frequent") {
      const since = new Date(now.getTime() - FREQUENT_WINDOW_DAYS * 86_400_000);
      const freq = await tx.booking.groupBy({
        by: ["customerId"],
        where: { tenantId: ctx.tenantId, startsAt: { gte: since, lt: now }, status: { in: ["CONFIRMED", "COMPLETED"] } },
        _count: { _all: true },
        having: { customerId: { _count: { gte: FREQUENT_MIN_VISITS } } },
      });
      where.id = { in: freq.map((r) => r.customerId) };
    } else if (f.filter === "inactive") {
      const since = new Date(now.getTime() - INACTIVE_DAYS * 86_400_000);
      where.bookings = { none: { startsAt: { gte: since } } };
    } else if (f.filter === "noshow") {
      where.bookings = { some: { status: "NO_SHOW" } };
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
    const visits = ids.length
      ? await tx.booking.groupBy({
          by: ["customerId"],
          where: { tenantId: ctx.tenantId, customerId: { in: ids }, status: { in: ["CONFIRMED", "COMPLETED"] }, startsAt: { lt: now } },
          _count: { _all: true },
          _max: { startsAt: true },
        })
      : [];
    const visitsBy = new Map(visits.map((v) => [v.customerId, v]));
    const paid = ids.length ? await paidByCustomer(tx, ctx.tenantId, ids) : new Map<string, number>();
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
        visits: visitsBy.get(r.id)?._count._all ?? 0,
        lastVisitAt: visitsBy.get(r.id)?._max.startsAt ?? null,
        totalPaid: paid.get(r.id) ?? 0,
      })),
    };
  });
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/** Neto abonado (pagos + señas − devoluciones) por cliente, en centavos. */
async function paidByCustomer(tx: Tx, tenantId: string, customerIds: string[]) {
  const rows = await tx.$queryRaw<{ customer_id: string; net: bigint }[]>`
    SELECT b.customer_id, SUM(CASE WHEN p.kind = 'REFUND' THEN -p.amount ELSE p.amount END)::bigint AS net
    FROM booking_payments p
    JOIN bookings b ON b.tenant_id = p.tenant_id AND b.id = p.booking_id
    WHERE p.tenant_id = ${tenantId}::uuid AND b.customer_id = ANY(${customerIds}::uuid[])
    GROUP BY b.customer_id`;
  return new Map(rows.map((r) => [r.customer_id, Number(r.net)]));
}

/**
 * Posibles duplicados: clientes del mismo complejo que comparten teléfono
 * (últimos 10 dígitos) o email. No se fusionan solos: solo se señalan.
 */
export async function findDuplicateCustomers(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => {
    const rows = await tx.$queryRaw<{ key: string; ids: string[]; names: string[] }[]>`
      WITH k AS (
        SELECT id, name, 'tel:' || right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) AS key
        FROM customers
        WHERE tenant_id = ${ctx.tenantId}::uuid AND length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 8
        UNION ALL
        SELECT id, name, 'mail:' || lower(trim(email)) AS key
        FROM customers
        WHERE tenant_id = ${ctx.tenantId}::uuid AND email IS NOT NULL AND email <> ''
      )
      SELECT key, array_agg(id::text ORDER BY name) AS ids, array_agg(name ORDER BY name) AS names
      FROM k GROUP BY key HAVING count(DISTINCT id) > 1
      ORDER BY key LIMIT 50`;
    // Un mismo par puede coincidir por teléfono y por email: se muestra una vez.
    const seen = new Set<string>();
    const groups: { reason: "phone" | "email"; customers: { id: string; name: string }[] }[] = [];
    for (const r of rows) {
      const sig = [...new Set(r.ids)].sort().join(",");
      if (seen.has(sig)) continue;
      seen.add(sig);
      const uniq = new Map<string, string>();
      r.ids.forEach((id, i) => uniq.set(id, r.names[i]!));
      groups.push({ reason: r.key.startsWith("tel:") ? "phone" : "email", customers: [...uniq].map(([id, name]) => ({ id, name })) });
    }
    return groups;
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
    const now = new Date();
    const visited = bookings.filter((b) => (b.status === "CONFIRMED" || b.status === "COMPLETED") && b.startsAt < now);
    const paid = await paidByCustomer(tx, ctx.tenantId, [customerId]);
    return {
      customer,
      bookings,
      stats: {
        visits: visited.length,
        lastVisitAt: visited[0]?.startsAt ?? null,
        totalPaid: paid.get(customerId) ?? 0,
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
