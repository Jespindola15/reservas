import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { Icon } from "@/components/shell/icons";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { formatMoney } from "@/modules/booking/pricing";
import { formatLocalDateTime } from "@/modules/booking/time";
import { getFinance, KIND_LABEL, METHOD_LABEL } from "@/modules/dashboard/finance";

export const metadata: Metadata = { title: "Finanzas" };

export default async function FinancePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const access = await requireTenantPage(slug, "stats.read");
  if (!access) notFound();
  const { tenant } = access;
  const f = await getFinance(access.ctx, tenant.timezone, { from: sp.desde, to: sp.hasta });
  const money = (c: number) => formatMoney(c, tenant.currency);
  const base = `/panel/${slug}`;

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Negocio</p>
          <h1>Finanzas</h1>
          <p className={ui.muted}>Solo se cuenta el dinero que tu equipo registró o verificó. TURNUP no recibe ni retiene dinero.</p>
        </div>
      </header>

      <form className={ui.toolbar} method="get" aria-label="Período">
        <label className={ui.field}><span className={ui.label}>Desde</span><input className={ui.input} type="date" name="desde" defaultValue={f.from} /></label>
        <label className={ui.field}><span className={ui.label}>Hasta</span><input className={ui.input} type="date" name="hasta" defaultValue={f.to} /></label>
        <button className={`${ui.button} ${ui.buttonSecondary}`} type="submit">Ver período</button>
      </form>

      <section className={ui.stats} aria-label="Resumen del período">
        <div className={ui.statTile}><span className={ui.statLabel}>Ingresos registrados</span><span className={ui.statValue}>{money(f.total)}</span><span className={ui.statHint}>Neto de devoluciones</span></div>
        <div className={ui.statTile}><span className={ui.statLabel}>Señas</span><span className={ui.statValue}>{money(f.deposits)}</span><span className={ui.statHint}>Incluidas en ingresos</span></div>
        <div className={ui.statTile}><span className={ui.statLabel}>Devoluciones</span><span className={ui.statValue}>{money(f.refunds)}</span><span className={ui.statHint}>Hechas por el complejo</span></div>
        <Link href={`${base}/transferencias`} className={`${ui.statTile} ${f.pendingReview.count ? ui.statTileAlert : ""}`}>
          <span className={ui.statLabel}>Sin verificar (no contabilizado)</span>
          <span className={ui.statValue}>{money(f.pendingReview.amount)}</span>
          <span className={ui.statHint}>{f.pendingReview.count} transferencia(s) informadas</span>
        </Link>
      </section>

      {f.openIncidents ? (
        <Link href={`${base}/transferencias?estado=incidencias`} className={ui.alert + " " + ui.alertWarn} style={{ marginTop: "var(--sp-4)", textDecoration: "none" }}>
          <Icon name="alert" /><span>{f.openIncidents} incidencia(s) de pago abiertas requieren una resolución.</span>
        </Link>
      ) : null}

      <div className={ui.split} style={{ marginTop: "var(--sp-6)" }}>
        <section aria-labelledby="mov">
          <h2 id="mov">Movimientos</h2>
          {f.payments.length === 0 ? (
            <div className={ui.empty}><Icon name="finance" size={28} /><span>No hay pagos registrados en este período.</span></div>
          ) : (
            <div className={ui.tableWrap}>
              <table className={`${ui.table} ${ui.tableResponsive}`}>
                <thead><tr><th>Reserva</th><th>Fecha</th><th>Tipo</th><th>Medio</th><th style={{ textAlign: "right" }}>Importe</th></tr></thead>
                <tbody>
                  {f.payments.map((p) => (
                    <tr key={p.id}>
                      <td data-label="Reserva"><Link href={`${base}/reservas/${p.booking.id}`}>{p.booking.customerName}</Link><span className={ui.cellSub}>{p.booking.code}{p.note ? ` · ${p.note}` : ""}</span></td>
                      <td data-label="Fecha">{formatLocalDateTime(p.paidAt, tenant.timezone)}</td>
                      <td data-label="Tipo">{KIND_LABEL[p.kind] ?? p.kind}</td>
                      <td data-label="Medio">{METHOD_LABEL[p.method] ?? p.method}</td>
                      <td data-label="Importe" className={ui.num} style={{ textAlign: "right", color: p.kind === "REFUND" ? "var(--danger)" : undefined }}>{p.kind === "REFUND" ? "−" : ""}{money(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {f.truncated ? <p className={ui.faint}>Se muestran los últimos 500 movimientos del período.</p> : null}
        </section>
        <aside className={ui.card} aria-labelledby="medios">
          <h2 id="medios">Por medio de pago</h2>
          {f.byMethod.length === 0 ? <p className={ui.muted}>Sin movimientos.</p> : (
            <dl className={ui.dl}>{f.byMethod.map((m) => (<Fragment key={m.method}><dt>{METHOD_LABEL[m.method] ?? m.method}</dt><dd className={ui.num}>{money(m.amount)}</dd></Fragment>))}</dl>
          )}
        </aside>
      </div>
    </>
  );
}
