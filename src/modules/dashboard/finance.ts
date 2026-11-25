import { withTenant, type TenantContext } from "@/lib/db/tenant-context";
import { localMidnight, todayIn } from "@/modules/booking/time";

/**
 * Finanzas del complejo. Solo cuenta como ingreso el dinero REGISTRADO por el equipo
 * (pagos cargados a mano o transferencias verificadas). Las transferencias informadas por
 * jugadores y todavía no verificadas se muestran aparte y NO se suman.
 */
export const METHOD_LABEL: Record<string, string> = { CASH: "Efectivo", TRANSFER: "Transferencia", CARD: "Tarjeta", MERCADOPAGO_MANUAL: "Mercado Pago (manual)", OTHER: "Otro" };
export const KIND_LABEL: Record<string, string> = { DEPOSIT: "Seña", PAYMENT: "Pago", REFUND: "Devolución" };

export async function getFinance(ctx: TenantContext, tz: string, period: { from?: string; to?: string }, now: Date = new Date()) {
  const today = todayIn(tz, now);
  const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && localMidnight(d, tz) ? d : undefined);
  const from = valid(period.from) ?? `${today.slice(0, 7)}-01`;
  const to = valid(period.to) ?? today;
  const start = localMidnight(from, tz)!.toJSDate();
  const end = localMidnight(to, tz)!.plus({ days: 1 }).toJSDate();
  return withTenant(ctx, async (tx) => {
    const payments = await tx.bookingPayment.findMany({
      where: { tenantId: ctx.tenantId, paidAt: { gte: start, lt: end } },
      orderBy: { paidAt: "desc" },
      take: 500,
      select: { id: true, kind: true, method: true, amount: true, paidAt: true, note: true, booking: { select: { id: true, code: true, customerName: true } } },
    });
    const pending = await tx.booking.aggregate({
      where: { tenantId: ctx.tenantId, status: "PENDING", paymentStatus: "TRANSFER_REPORTED" },
      _sum: { amountDue: true },
      _count: { _all: true },
    });
    const incidents = await tx.paymentIncident.count({ where: { tenantId: ctx.tenantId, status: "OPEN" } });
    const sign = (p: { kind: string; amount: number }) => (p.kind === "REFUND" ? -p.amount : p.amount);
    const byMethod = new Map<string, number>();
    for (const p of payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + sign(p));
    return {
      from, to,
      total: payments.reduce((a, p) => a + sign(p), 0),
      deposits: payments.filter((p) => p.kind === "DEPOSIT").reduce((a, p) => a + p.amount, 0),
      refunds: payments.filter((p) => p.kind === "REFUND").reduce((a, p) => a + p.amount, 0),
      byMethod: [...byMethod.entries()].map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount),
      payments,
      truncated: payments.length === 500,
      pendingReview: { count: pending._count._all, amount: pending._sum.amountDue ?? 0 },
      openIncidents: incidents,
    };
  });
}
