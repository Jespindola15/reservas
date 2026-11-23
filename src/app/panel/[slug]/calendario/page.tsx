import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { ActionForm } from "@/components/ActionForm";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { getCalendar } from "@/modules/booking/admin-queries";
import { formatLocalTime, localMidnight, minutesToHHMM, todayIn } from "@/modules/booking/time";
import { createManualBookingAction } from "../actions";
import { STATUS_LABEL } from "../labels";
import styles from "./calendar.module.css";

export const metadata: Metadata = { title: "Calendario" };

const ROW_MIN = 30; // minutos por fila
const ROW_PX = 40;

type SP = { view?: string; date?: string; court?: string; nueva?: string; time?: string };

export default async function CalendarPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const access = await requireTenantPage(slug, "booking.read");
  if (!access) notFound();
  const { ctx, tenant } = access;
  const tz = tenant.timezone;
  const today = todayIn(tz);
  const date = sp.date && localMidnight(sp.date, tz) ? sp.date : today;
  const view: "day" | "week" = sp.view === "week" ? "week" : "day";
  const startDate = view === "week" ? localMidnight(date, tz)!.startOf("week").toISODate()! : date;
  const courtFilter = sp.court && /^[0-9a-f-]{36}$/i.test(sp.court) ? sp.court : undefined;

  const cal = await getCalendar(ctx, tz, { date: startDate, days: view === "week" ? 7 : 1, courtId: view === "week" ? courtFilter : undefined });
  const allCourts = view === "week" && courtFilter ? (await getCalendar(ctx, tz, { date: startDate, days: 1 })).courts : cal.courts;

  const base = `/panel/${slug}/calendario`;
  const qs = (o: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged = { view, date, court: courtFilter, ...o };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    return `${base}?${p.toString()}`;
  };
  const shift = (n: number) => localMidnight(date, tz)!.plus({ days: view === "week" ? 7 * n : n }).toISODate()!;
  const title =
    view === "week"
      ? `Semana del ${DateTime.fromISO(startDate).setLocale("es-AR").toFormat("d 'de' LLLL")}`
      : localMidnight(date, tz)!.setLocale("es-AR").toFormat("cccc d 'de' LLLL");

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Calendario</p>
          <h1 style={{ textTransform: "none" }}>{title.charAt(0).toUpperCase() + title.slice(1)}</h1>
        </div>
        <div className={ui.row}>
          <div className={styles.segmented} role="group" aria-label="Vista">
            <Link href={qs({ view: "day" })} className={view === "day" ? styles.segActive : styles.seg} aria-current={view === "day" ? "page" : undefined}>Día</Link>
            <Link href={qs({ view: "week" })} className={view === "week" ? styles.segActive : styles.seg} aria-current={view === "week" ? "page" : undefined}>Semana</Link>
          </div>
          <Link className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} href={qs({ date: shift(-1) })} aria-label="Anterior">←</Link>
          <Link className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} href={qs({ date: today })}>Hoy</Link>
          <Link className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} href={qs({ date: shift(1) })} aria-label="Siguiente">→</Link>
          <form action={base} className={styles.dateForm}>
            <input type="hidden" name="view" value={view} />
            {courtFilter ? <input type="hidden" name="court" value={courtFilter} /> : null}
            <label className="sr-only" htmlFor="cal-date">Ir a fecha</label>
            <input id="cal-date" className={`${ui.input} ${styles.dateInput}`} type="date" name="date" defaultValue={date} />
            <button className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`}>Ir</button>
          </form>
          <Link className={`${ui.button} ${ui.buttonSmall}`} href={qs({ nueva: "1" })}>+ Reserva manual</Link>
        </div>
      </header>

      <div className={styles.legend} aria-label="Referencias">
        <span className={`${styles.chip} ${styles.CONFIRMED}`}>Confirmada</span>
        <span className={`${styles.chip} ${styles.PENDING}`}>Pendiente</span>
        <span className={`${styles.chip} ${styles.block}`}>Bloqueo</span>
        <span className={`${styles.chip} ${styles.free}`}>+ Libre</span>
      </div>

      {sp.nueva ? (
        <section className={`${ui.card} ${styles.manual}`} aria-labelledby="manual">
          <div className={ui.cardHeader}>
            <h2 id="manual">Nueva reserva manual</h2>
            <Link href={qs({ nueva: undefined, time: undefined, court: courtFilter })} className={ui.muted}>Cerrar ✕</Link>
          </div>
          <ManualForm slug={slug} date={date} time={sp.time} courtId={sp.court} courts={allCourts} />
        </section>
      ) : null}

      {cal.courts.length === 0 ? (
        <p className={ui.empty}>No hay canchas activas. <Link href={`/panel/${slug}/canchas`}>Crear una cancha</Link></p>
      ) : view === "day" ? (
        <DayGrid slug={slug} tz={tz} cal={cal} date={date} qs={qs} />
      ) : (
        <WeekGrid slug={slug} tz={tz} cal={cal} qs={qs} courts={allCourts} courtFilter={courtFilter} today={today} />
      )}
    </>
  );
}

type Cal = Awaited<ReturnType<typeof getCalendar>>;

function DayGrid({ slug, tz, cal, date, qs }: { slug: string; tz: string; cal: Cal; date: string; qs: (o: Partial<SP>) => string }) {
  const midnight = localMidnight(date, tz)!;
  const minuteOf = (d: Date) => Math.round(DateTime.fromJSDate(d).diff(midnight, "minutes").minutes);
  const day = cal.windows[0]!;
  const allWindows = day.courts.flatMap((c) => c.windows);
  const gridStart = allWindows.length ? Math.floor(Math.min(...allWindows.map((w) => w.openMinute)) / 60) * 60 : 8 * 60;
  const gridEnd = allWindows.length ? Math.ceil(Math.max(...allWindows.map((w) => w.closeMinute)) / 60) * 60 : 24 * 60;
  const rows = Math.max(1, (gridEnd - gridStart) / ROW_MIN);
  const top = (m: number) => ((m - gridStart) / ROW_MIN) * ROW_PX;
  const nowMin = minuteOf(new Date());

  return (
    <div className={styles.scroller}>
      {day.closedReason ? <p className={`${ui.alert} ${ui.alertWarn}`} style={{ marginBottom: "0.75rem" }}>Cerrado: {day.closedReason}</p> : null}
      <div className={styles.dayGrid} style={{ gridTemplateColumns: `64px repeat(${cal.courts.length}, minmax(150px, 1fr))` }}>
        <div className={styles.corner} />
        {cal.courts.map((c) => (
          <div key={c.id} className={styles.colHead}>{c.name}</div>
        ))}
        <div className={styles.times} style={{ height: rows * ROW_PX }}>
          {Array.from({ length: rows }, (_, i) => gridStart + i * ROW_MIN)
            .filter((m) => m % 60 === 0)
            .map((m) => (
              <span key={m} style={{ top: top(m) }}>{minutesToHHMM(m)}</span>
            ))}
        </div>
        {cal.courts.map((c) => {
          const windows = day.courts.find((x) => x.courtId === c.id)?.windows ?? [];
          const items = cal.bookings.filter((b) => b.courtId === c.id);
          const blocks = cal.blocks.filter((b) => b.courtId === c.id);
          const busy = (s: number, e: number) =>
            items.some((b) => minuteOf(b.startsAt) < e && minuteOf(b.endsAt) > s) ||
            blocks.some((b) => minuteOf(b.startsAt) < e && minuteOf(b.endsAt) > s);
          const free: number[] = [];
          for (const w of windows) for (let m = w.openMinute; m + ROW_MIN <= w.closeMinute; m += ROW_MIN) if (!busy(m, m + ROW_MIN) && m >= nowMin) free.push(m);
          return (
            <div key={c.id} className={styles.col} style={{ height: rows * ROW_PX }}>
              {windows.map((w, i) => (
                <div key={i} className={styles.open} style={{ top: top(w.openMinute), height: top(w.closeMinute) - top(w.openMinute) }} />
              ))}
              {free.map((m) => {
                const d = m >= 1440 ? midnight.plus({ days: 1 }).toISODate()! : date;
                return (
                  <Link key={m} href={qs({ nueva: "1", court: c.id, time: minutesToHHMM(m), date: d })} className={styles.freeCell} style={{ top: top(m), height: ROW_PX - 2 }} aria-label={`Reservar ${c.name} a las ${minutesToHHMM(m)}`}>
                    + {minutesToHHMM(m)}
                  </Link>
                );
              })}
              {blocks.map((b) => (
                <div key={b.id} className={`${styles.event} ${styles.block}`} style={{ top: top(Math.max(gridStart, minuteOf(b.startsAt))), height: Math.max(ROW_PX, top(Math.min(gridEnd, minuteOf(b.endsAt))) - top(Math.max(gridStart, minuteOf(b.startsAt)))) - 2 }}>
                  <strong>Bloqueado</strong>
                  <span>{b.reason}</span>
                </div>
              ))}
              {items.map((b) => {
                const s = minuteOf(b.startsAt);
                const e = minuteOf(b.endsAt);
                return (
                  <Link key={b.id} href={`/panel/${slug}/reservas/${b.id}`} className={`${styles.event} ${styles[b.status] ?? ""}`} style={{ top: top(s), height: Math.max(ROW_PX, top(e) - top(s)) - 2 }}>
                    <strong>{formatLocalTime(b.startsAt, tz)}–{formatLocalTime(b.endsAt, tz)}</strong>
                    <span>{b.customerName}</span>
                    <span className={styles.eventMeta}>{STATUS_LABEL[b.status]}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({ slug, tz, cal, qs, courts, courtFilter, today }: { slug: string; tz: string; cal: Cal; qs: (o: Partial<SP>) => string; courts: Cal["courts"]; courtFilter?: string; today: string }) {
  return (
    <>
      <form className={ui.row} style={{ marginBottom: "0.75rem" }}>
        <input type="hidden" name="view" value="week" />
        <input type="hidden" name="date" value={cal.dates[0]} />
        <label className={ui.muted} htmlFor="court-filter">Cancha</label>
        <select id="court-filter" name="court" className={ui.select} defaultValue={courtFilter ?? ""} style={{ maxWidth: 240 }}>
          <option value="">Todas</option>
          {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`}>Filtrar</button>
      </form>
      <div className={styles.weekGrid}>
        {cal.dates.map((d, i) => {
          const label = localMidnight(d, tz)!.setLocale("es-AR").toFormat("ccc d");
          const items = cal.bookings.filter((b) => localMidnight(d, tz)!.toJSDate() <= b.startsAt && b.startsAt < localMidnight(d, tz)!.plus({ days: 1 }).toJSDate());
          const closed = cal.windows[i]?.closedReason;
          return (
            <section key={d} className={`${styles.weekDay} ${d === today ? styles.today : ""}`} aria-label={label}>
              <Link href={qs({ view: "day", date: d })} className={styles.weekHead}>
                <span>{label}</span>
                <span className={ui.faint}>{items.length}</span>
              </Link>
              {closed ? <span className={`${styles.chip} ${styles.block}`}>{closed}</span> : null}
              {items.length === 0 && !closed ? <span className={ui.faint}>Sin reservas</span> : null}
              {items.map((b) => (
                <Link key={b.id} href={`/panel/${slug}/reservas/${b.id}`} className={`${styles.weekEvent} ${styles[b.status] ?? ""}`}>
                  <strong>{formatLocalTime(b.startsAt, tz)}</strong> {b.court.name}
                  <span>{b.customerName}</span>
                </Link>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

function ManualForm({ slug, date, time, courtId, courts }: { slug: string; date: string; time?: string; courtId?: string; courts: Cal["courts"] }) {
  const durations = [...new Set(courts.flatMap((c) => c.allowedDurations))].sort((a, b) => a - b);
  return (
    <ActionForm action={createManualBookingAction.bind(null, slug)} submitLabel="Registrar reserva" className={ui.stack} idempotencyKey={randomUUID()} resetOnSuccess>
      <div className={ui.grid2}>
        <label className={ui.field}>
          <span className={ui.label}>Cancha</span>
          <select className={ui.select} name="courtId" defaultValue={courtId} required>
            {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Fecha</span>
          <input className={ui.input} type="date" name="date" defaultValue={date} required />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Hora de inicio</span>
          <input className={ui.input} type="time" name="time" defaultValue={time} required />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Duración</span>
          <select className={ui.select} name="durationMinutes" defaultValue={durations.includes(90) ? 90 : durations[0]}>
            {durations.map((d) => <option key={d} value={d}>{d} min</option>)}
          </select>
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Nombre del cliente</span>
          <input className={ui.input} name="name" required minLength={2} maxLength={80} autoComplete="off" />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Teléfono</span>
          <input className={ui.input} name="phone" type="tel" required minLength={6} maxLength={30} autoComplete="off" />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Email (opcional)</span>
          <input className={ui.input} name="email" type="email" maxLength={254} autoComplete="off" />
        </label>
      </div>
      <p className={ui.hint}>Se valida contra el horario habilitado y la base de datos impide superposiciones, aunque otro administrador esté cargando al mismo tiempo.</p>
    </ActionForm>
  );
}
