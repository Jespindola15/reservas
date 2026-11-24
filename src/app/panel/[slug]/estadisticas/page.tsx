import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { formatMoney } from "@/modules/booking/pricing";
import { delta, getStats } from "@/modules/dashboard/stats";
import styles from "./stats.module.css";

export const metadata: Metadata = { title: "Estadísticas" };

type SP = { period?: string; from?: string; to?: string; date?: string };
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const PERIOD_LABEL: Record<string, string> = { day: "Día", week: "Semana", month: "Mes", custom: "Personalizado" };

function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function Delta({ curr, prev, invert = false }: { curr: number; prev: number; invert?: boolean }) {
  const v = delta(curr, prev);
  if (v === null) return <span className={ui.statHint}>Sin datos del período anterior</span>;
  const good = invert ? v <= 0 : v >= 0;
  return (
    <span className={ui.statHint}>
      <span className={good ? styles.up : styles.down}>{v > 0 ? "▲" : v < 0 ? "▼" : "="} {Math.abs(v)}%</span> vs. período anterior
    </span>
  );
}

function Bars({ values, labels, unit, title }: { values: number[]; labels: string[]; unit: string; title: string }) {
  const max = Math.max(1, ...values);
  const cols = { gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` };
  const peak = values.indexOf(Math.max(...values));
  return (
    <figure style={{ margin: 0 }}>
      <div className={styles.columns} style={cols} role="img" aria-label={`${title}. Máximo: ${labels[peak]} con ${values[peak]} ${unit}.`}>
        {values.map((v, i) => (
          <div key={labels[i]} className={styles.col} title={`${labels[i]}: ${v} ${unit}`} tabIndex={0} aria-label={`${labels[i]}: ${v} ${unit}`}>
            <span style={{ height: `${(v / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className={styles.axis} style={cols} aria-hidden>
        {labels.map((l, i) => <span key={l}>{values.length > 12 && i % 3 !== 0 ? "" : l}</span>)}
      </div>
      {values.some((v) => v > 0) ? (
        <figcaption className={`${ui.faint} ${styles.peak}`}>Pico: <strong>{labels[peak]}</strong> ({values[peak]} {unit})</figcaption>
      ) : (
        <figcaption className={`${ui.faint} ${styles.peak}`}>Sin turnos en el período.</figcaption>
      )}
    </figure>
  );
}

export default async function StatsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const access = await requireTenantPage(slug, "stats.read");
  if (!access) notFound();
  const { tenant } = access;
  const r = await getStats(access.ctx, tenant.timezone, sp);
  const s = r.stats;
  const p = r.prev;
  const cur = tenant.currency ?? "ARS";
  const money = (c: number) => formatMoney(c, cur);
  const firstHour = s.byHour.findIndex((v, i) => v > 0 || p.byHour[i]! > 0);
  const lastHour = 23 - [...s.byHour].reverse().findIndex((v) => v > 0);
  const h0 = firstHour < 0 ? 8 : Math.min(firstHour, 8);
  const h1 = firstHour < 0 ? 23 : Math.max(lastHour, 22);
  const hours = s.byHour.slice(h0, h1 + 1);

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>{PERIOD_LABEL[r.period]} · {fmtDate(r.current.from)}{r.current.days > 1 ? ` al ${fmtDate(r.current.to)}` : ""}</p>
          <h1>Estadísticas</h1>
        </div>
      </header>

      <form className={styles.filters} method="get" aria-label="Período">
        <label className={ui.field}>
          <span>Período</span>
          <select name="period" defaultValue={r.period} className={ui.select}>
            {Object.entries(PERIOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className={ui.field}>
          <span>Fecha de referencia</span>
          <input type="date" name="date" defaultValue={sp.date ?? ""} className={ui.input} />
        </label>
        <label className={ui.field}>
          <span>Desde (personalizado)</span>
          <input type="date" name="from" defaultValue={sp.from ?? ""} className={ui.input} />
        </label>
        <label className={ui.field}>
          <span>Hasta (personalizado)</span>
          <input type="date" name="to" defaultValue={sp.to ?? ""} className={ui.input} />
        </label>
        <button className={ui.button} type="submit">Aplicar</button>
      </form>
      {r.error ? <p className={ui.muted} role="status">{r.error}</p> : null}

      <section className={styles.kpis} aria-label="Indicadores del período">
        <div className={ui.card}><div className={ui.stat}>
          <span className={ui.statLabel}>Cobrado</span>
          <span className={ui.statValue}>{money(s.money.collected)}</span>
          <Delta curr={s.money.collected} prev={p.money.collected} />
        </div></div>
        <div className={ui.card}><div className={ui.stat}>
          <span className={ui.statLabel}>Proyectado</span>
          <span className={ui.statValue}>{money(s.money.projected)}</span>
          <span className={ui.statHint}>{s.bookings.withoutPrice ? `${s.bookings.withoutPrice} reservas sin precio no suman` : "Precio de las reservas activas"}</span>
        </div></div>
        <div className={ui.card}><div className={ui.stat}>
          <span className={ui.statLabel}>Pendiente de cobro</span>
          <span className={ui.statValue}>{money(s.money.pendingCollection)}</span>
          <span className={ui.statHint}>Confirmadas/jugadas sin saldar</span>
        </div></div>
        <div className={ui.card}><div className={ui.stat}>
          <span className={ui.statLabel}>Reservas</span>
          <span className={ui.statValue}>{s.bookings.active}</span>
          <Delta curr={s.bookings.active} prev={p.bookings.active} />
        </div></div>
        <div className={ui.card}><div className={ui.stat}>
          <span className={ui.statLabel}>Ocupación</span>
          <span className={ui.statValue}>{s.occupancy.pct === null ? "—" : `${s.occupancy.pct}%`}</span>
          <Delta curr={s.occupancy.pct ?? 0} prev={p.occupancy.pct ?? 0} />
        </div></div>
        <div className={ui.card}><div className={ui.stat}>
          <span className={ui.statLabel}>Cancelaciones</span>
          <span className={ui.statValue}>{s.cancellationRate}%</span>
          <span className={ui.statHint}>{s.bookings.cancelled} canceladas · {s.bookings.noShow} ausentes</span>
        </div></div>
        <div className={ui.card}><div className={ui.stat}>
          <span className={ui.statLabel}>Clientes</span>
          <span className={ui.statValue}>{s.customers.total}</span>
          <span className={ui.statHint}>{s.customers.new} nuevos · {s.customers.returning} recurrentes</span>
        </div></div>
      </section>

      <div className={styles.grid}>
        <section className={ui.card} aria-labelledby="horas">
          <div className={ui.cardHeader}><h2 id="horas">Turnos por hora de inicio</h2></div>
          <Bars values={hours} labels={hours.map((_, i) => `${String(h0 + i).padStart(2, "0")}h`)} unit="turnos" title="Turnos por hora de inicio" />
        </section>
        <section className={ui.card} aria-labelledby="dias">
          <div className={ui.cardHeader}><h2 id="dias">Turnos por día de la semana</h2></div>
          <Bars values={s.byWeekday} labels={WEEKDAYS} unit="turnos" title="Turnos por día de la semana" />
        </section>
      </div>

      <section className={ui.card} aria-labelledby="canchas">
        <div className={ui.cardHeader}><h2 id="canchas">Canchas</h2></div>
        {s.courts.length === 0 ? <p className={ui.muted}>No hay canchas activas.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table className={styles.table}>
              <thead>
                <tr><th>Cancha</th><th className={styles.num}>Reservas</th><th className={styles.num}>Horas</th><th className={styles.num}>Proyectado</th><th>Ocupación</th></tr>
              </thead>
              <tbody>
                {s.courts.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className={styles.num}>{c.bookings}</td>
                    <td className={styles.num}>{Math.round((c.minutes / 60) * 10) / 10}</td>
                    <td className={styles.num}>{money(c.revenue)}</td>
                    <td>
                      <div className={ui.row}>
                        <div className={styles.meter} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.occupancyPct ?? 0} aria-label={`Ocupación ${c.name}`}>
                          <span style={{ width: `${c.occupancyPct ?? 0}%` }} />
                        </div>
                        <span className={ui.muted}>{c.occupancyPct === null ? "Cerrada" : `${c.occupancyPct}%`}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className={ui.faint} style={{ marginTop: "1rem" }}>
        &ldquo;Cobrado&rdquo; suma solo los pagos y señas registrados a mano en TURNUP (menos devoluciones). TURNUP no procesa pagos.
        Período anterior comparado: {fmtDate(r.previous.from)} al {fmtDate(r.previous.to)}.
      </p>
    </>
  );
}
