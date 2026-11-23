import { withTenant, type TenantContext } from "@/lib/db/tenant-context";

/** Bloqueos de mantenimiento vigentes o futuros. */
export async function listUpcomingBlocks(ctx: TenantContext, now: Date = new Date()) {
  return withTenant(ctx, (tx) =>
    tx.availabilityBlock.findMany({
      where: { tenantId: ctx.tenantId, endsAt: { gt: now } },
      orderBy: { startsAt: "asc" },
      take: 100,
      select: { id: true, startsAt: true, endsAt: true, reason: true, court: { select: { name: true } } },
    }),
  );
}
