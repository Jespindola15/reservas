import type { Metadata } from "next";
import { fmtDate } from "@/lib/format";
import { notFound } from "next/navigation";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { withTenant } from "@/lib/db/tenant-context";
import { formatMoney } from "@/modules/booking/pricing";

export const metadata: Metadata = { title: "Plan y suscripción" };

const STATUS: Record<string, string> = { TRIAL: "Período de prueba", ACTIVE: "Activa", PAST_DUE: "Vencida (en período de gracia)", SUSPENDED: "Suspendida", CANCELLED: "Cancelada" };
const day = (d: Date) => fmtDate(d);

export default async function PlanPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await requireTenantPage(slug, "tenant.settings");
  if (!access) notFound();
  const { ctx } = access;
  const data = await withTenant(ctx, async (tx) => {
    const [subs, courts, members] = await Promise.all([
      tx.subscription.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { currentPeriodEnd: "desc" }, take: 6, select: { id: true, status: true, currentPeriodStart: true, currentPeriodEnd: true, plan: { select: { name: true, priceAmount: true, currency: true, maxCourts: true, maxMembers: true, description: true } } } }),
      tx.court.count({ where: { tenantId: ctx.tenantId } }),
      tx.membership.count({ where: { tenantId: ctx.tenantId, isActive: true, role: { not: "OWNER" } } }),
    ]);
    return { subs, courts, members };
  });
  const current = data.subs.find((s) => ["TRIAL", "ACTIVE", "PAST_DUE"].includes(s.status)) ?? null;
  const now = new Date();
  const daysLeft = current ? Math.ceil((current.currentPeriodEnd.getTime() - now.getTime()) / 86_400_000) : null;

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Negocio</p>
          <h1>Plan y suscripción</h1>
          <p className={ui.muted}>La suscripción a TURNUP se abona por fuera de la plataforma y la registra el equipo de TURNUP. Para cambiar de plan, contactanos.</p>
        </div>
      </header>
      {!current ? (
        <p className={`${ui.alert} ${ui.alertWarn}`}>No hay una suscripción vigente registrada.</p>
      ) : (
        <div className={ui.grid2}>
          <section className={ui.card} aria-labelledby="actual">
            <div className={ui.cardHeader}>
              <h2 id="actual">{current.plan.name}</h2>
              <span className={`${ui.badge} ${current.status === "PAST_DUE" ? ui.badgePENDING : ui.badgeCONFIRMED}`}>{STATUS[current.status]}</span>
            </div>
            <dl className={ui.dl}>
              <dt>Precio</dt><dd>{formatMoney(current.plan.priceAmount, current.plan.currency)} por mes</dd>
              <dt>Período</dt><dd>{day(current.currentPeriodStart)} al {day(current.currentPeriodEnd)}</dd>
              <dt>Vence</dt><dd className={daysLeft !== null && daysLeft <= 7 ? ui.textDanger : undefined}>{daysLeft !== null && daysLeft >= 0 ? `en ${daysLeft} día(s)` : "Vencido"}</dd>
            </dl>
            {current.plan.description ? <p className={ui.muted}>{current.plan.description}</p> : null}
          </section>
          <section className={ui.card} aria-labelledby="uso">
            <h2 id="uso">Uso del plan</h2>
            <dl className={ui.dl}>
              <dt>Canchas</dt><dd>{data.courts}{current.plan.maxCourts ? ` de ${current.plan.maxCourts}` : " (sin límite)"}</dd>
              <dt>Usuarios del equipo</dt><dd>{data.members}{current.plan.maxMembers ? ` de ${current.plan.maxMembers}` : " (sin límite)"}</dd>
            </dl>
          </section>
        </div>
      )}
      {data.subs.length > 1 ? (
        <section className={ui.section} aria-labelledby="hist">
          <h2 id="hist">Historial</h2>
          <ul className={ui.list}>
            {data.subs.map((s) => (
              <li key={s.id} className={ui.listRow}><span className={ui.listMain}><strong>{s.plan.name}</strong><span className={ui.faint}>{day(s.currentPeriodStart)} al {day(s.currentPeriodEnd)}</span></span><span className={ui.badge}>{STATUS[s.status]}</span></li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
