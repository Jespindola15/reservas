import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { ActionForm } from "@/components/ActionForm";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { getCalendar, getMonthSummary } from "@/modules/booking/admin-queries";
import { formatLocalTime, localMidnight, minutesToHHMM, todayIn } from "@/modules/booking/time";
import { hasPermission } from "@/modules/access/authorize";
import { createManualBookingAction, moveBookingAction } from "../actions";
import { DragLayer } from "./DragLayer";
import { STATUS_LABEL } from "../labels";
import styles from "./calendar.module.css";

export const metadata: Metadata = { title: "Calendario" };

const ROW_MIN = 30; // minutos por fila
const ROW_PX = 40;

type SP = { view?: string; date?: string; court?: string; nueva?: string; time?: string; sport?: string; status?: string };
const SPORT_LABEL: Record<string, string> = { FOOTBALL_5: "Fútbol 5", FOOTBALL_7: "Fútbol 7", FOOTBALL_8: "Fútbol 8", FOOTBALL_11: "Fútbol 11", PADEL: "Pádel", OTHER: "Otro" };

export default async function CalendarPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const access = await requireTenantPage(slug, "booking.read");
  if (!access) notFound();
  const { ctx, tenant, role } = access;
  const canMove = hasPermission(role, "booking.manage");
  const tz = tenant.timezone;
  const today = todayIn(tz);
  const date = sp.date && localMidnight(sp.date, tz) ? sp.date : today;
  const view: "day" | "week" | "month" = sp.view === "week" ? "week" : sp.view === "month" ? "month" : "day";
  const startDate = view === "week" ? localMidnight(date, tz)!.startOf("week").toISODate()! : date;
  const courtFilter = sp.court && /^[0-9a-f-]{36}$/i.test(sp.court) ? sp.court : undefined;

  const cal = await getCalendar(ctx, tz, { date: startDate, days: view === "week" ? 7 : 1, courtId: view !== "day" ? courtFilter : undefined });
  const allCourts = view !== "day" && courtFilter ? (await getCalendar(ctx, tz, { date: startDate, days: 1 })).courts : cal.courts;
  const month = view === "month" ? await getMonthSummary(ctx, tz, date.slice(0, 7), courtFilter) : null;

  // Filtros de la vista diaria: deporte (columnas) y estado (turnos).
  const sportFilter = sp.sport && /^[A-Z_0-9]{3,20}$/.test(sp.sport) ? sp.sport : undefined;
  const statusFilter = sp.status && ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"].includes(sp.status) ? sp.status : undefined;
  const sports = [...new Set(cal.courts.map((c) => c.sport))];
  const dayCal: typeof cal = view === "day" && (sportFilter || statusFilter)
    ? {
        ...cal,
        courts: cal.courts.filter((c) => !sportFilter || c.sport === sportFilter),
        bookings: cal.bookings.filter((b) => !statusFilter || b.status === statusFilter),
      }
    : cal;

  const base = `/panel/${slug}/calendario`;
  const qs = (o: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged = { view, date, court: courtFilter, sport: sportFilter, status: statusFilter, ...o };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    return `${base}?${p.toString()}`;
  };
  const shift = (n: number) =>
    view === "month"
      ? localMidnight(`${date.slice(0, 7)}-01`, tz)!.plus({ months: n }).toISODate()!
      : localMidnight(date, tz)!.plus({ days: view === "week" ? 7 * n : n }).toISODate()!;
  const title =
    view === "month"
      ? localMidnight(`${date.slice(0, 7)}-01`, tz)!.setLocale("es-AR").toFormat("LLLL yyyy")
      : view === "week"
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
            <Link href={qs({ view: "month" })} className={view === "month" ? styles.segActive : styles.seg} aria-current={view === "month" ? "page" : undefined}>Mes</Link>
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
      ) : month ? (
        <MonthGrid month={month} qs={qs} today={today} courts={allCourts} courtFilter={courtFilter} />
      ) : view === "day" ? (
        <>
          <form className={styles.filters} aria-label="Filtros">
            <input type="hidden" name="view" value="day" />
            <input type="hidden" name="date" value={date} />
            {sports.length > 1 ? (
              <select name="sport" className={ui.select} defaultValue={sportFilter ?? ""} aria-label="Deporte">
                <option value="">Todos los deportes</option>
                {sports.map((x) => <option key={x} value={x}>{SPORT_LABEL[x] ?? x}</option>)}
              </select>
            ) : null}
            <select name="status" className={ui.select} defaultValue={statusFilter ?? ""} aria-label="Estado">
              <option value="">Todos los estados</option>
              <option value="CONFIRMED">Confirmadas</option>
              <option value="PENDING">Pendientes</option>
              <option value="COMPLETED">Jugadas</option>
              <option value="NO_SHOW">Ausentes</option>
            </select>
            <button className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`}>Filtrar</button>
            {sportFilter || statusFilter ? <Link href={qs({ sport: undefined, status: undefined })} className={ui.muted}>Quitar filtros</Link> : null}
          </form>
          <DayGrid slug={slug} tz={tz} cal={dayCal} date={date} qs={qs} canMove={canMove && date >= today} />
        </>
      ) : (
        <WeekGrid slug={slug} tz={tz} cal={cal} qs={qs} courts={allCourts} courtFilter={courtFilter} today={today} />
      )}
    </>
  );
}

type Cal = Awaited<ReturnType<typeof getCalendar>>;

function DayGrid({ slug, tz, cal, date, qs, canMove }: { slug: string; tz: string; cal: Cal; date: string; qs: (o: Partial<SP>) => string; canMove: boolean }) {
  const midnight = localMidnight(date, tz)!;
  const minuteOf = (d: Date) => Math.round(DateTime.fromJSDate(d).diff(midnight, "minutes").minutes);
  const day = cal.windows[0]!;
  const allWindows = day.courts.flatMap((c) => c.windows);
  const gridStart = allWindows.length ? Math.floor(Math.min(...allWindows.map((w) => w.openMinute)) / 60) * 60 : 8 * 60;
  const gridEnd = allWindows.length ? Math.ceil(Math.max(...allWindows.map((w) => w.closeMinute)) / 60) * 60 : 24 * 60;
  const rows = Math.max(1, (gridEnd - gridStart) / ROW_MIN);
  const top = (m: number) => ((m - gridStart) / ROW_MIN) * ROW_PX;
  const now = new Date();
  const nowMin = minuteOf(now);
  const showNow = nowMin >= gridStart && nowMin <= gridEnd;

  return (
    <DragLayer date={date} gridStart={gridStart} rowMin={ROW_MIN} rowPx={ROW_PX} enabled={canMove} move={moveBookingAction.bind(null, slug)}>
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
          {showNow ? <span className={styles.nowLabel} style={{ top: top(nowMin) }}>{minutesToHHMM(nowMin)}</span> : null}
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
            <div key={c.id} className={styles.col} style={{ height: rows * ROW_PX }} data-court-id={c.id} data-court-name={c.name}>
              {showNow ? <div className={styles.nowLine} style={{ top: top(nowMin) }} aria-hidden /> : null}
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
                  <Link
                    key={b.id}
                    href={`/panel/${slug}/reservas/${b.id}`}
                    className={`${styles.event} ${styles[b.status] ?? ""} ${canMove && movable(b) ? styles.draggable : ""}`}
                    style={{ top: top(s), height: Math.max(ROW_PX, top(e) - top(s)) - 2 }}
                    title={`${b.customerName} · ${formatLocalTime(b.startsAt, tz)}–${formatLocalTime(b.endsAt, tz)} · ${STATUS_LABEL[b.status]}${b.customerPhone ? ` · ${b.customerPhone}` : ""}`}
                    draggable={false}
                    {...(canMove && movable(b)
                      ? { "data-booking-id": b.id, "data-version": b.version, "data-duration": b.durationMinutes, "data-from-court": b.courtId, "data-minute": s, "data-label": `${b.customerName} (${formatLocalTime(b.startsAt, tz)})` }
                      : {})}
                  >
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
    </DragLayer>
  );

  function movable(b: Cal["bookings"][number]) {
    const active = b.status === "CONFIRMED" || (b.status === "PENDING" && (!b.expiresAt || b.expiresAt > now));
    return active && b.startsAt > now;
  }
}

function MonthGrid({ month, qs, today, courts, courtFilter }: { month: Awaited<ReturnType<typeof getMonthSummary>>; qs: (o: Partial<SP>) => string; today: string; courts: Cal["courts"]; courtFilter?: string }) {
  const first = DateTime.fromISO(month.firstDay);
  const lead = first.weekday - 1; // lunes = 0
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: month.daysInMonth }, (_, i) => first.plus({ days: i }).toISODate()!)];
  while (cells.length % 7) cells.push(null);
  return (
    <>
      <form className={ui.row} style={{ marginBottom: "0.75rem" }}>
        <input type="hidden" name="view" value="month" />
        <input type="hidden" name="date" value={month.firstDay} />
        <label className={ui.muted} htmlFor="court-filter-m">Cancha</label>
        <select id="court-filter-m" name="court" className={ui.select} defaultValue={courtFilter ?? ""} style={{ maxWidth: 240 }}>
          <option value="">Todas</option>
          {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`}>Filtrar</button>
      </form>
      <div className={styles.monthGrid} role="grid" aria-label="Mes">
        {["lun", "mar", "mié", "jue", "vie", "sáb", "dom"].map((d) => <div key={d} className={styles.monthHead} role="columnheader">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} className={styles.monthEmpty} aria-hidden />;
          const info = month.days[d];
          const closed = month.closed[d];
          return (
            <Link key={d} href={qs({ view: "day", date: d })} className={`${styles.monthDay} ${d === today ? styles.today : ""}`} role="gridcell" aria-label={`${d}: ${info?.total ?? 0} reservas${closed ? ", cerrado" : ""}`}>
              <span className={styles.monthNum}>{Number(d.slice(8))}</span>
              {closed ? <span className={`${styles.chip} ${styles.block}`}>Cerrado</span> : null}
              {info?.confirmed ? <span className={`${styles.chip} ${styles.CONFIRMED}`}>{info.confirmed}</span> : null}
              {info?.pending ? <span className={`${styles.chip} ${styles.PENDING}`}>{info.pending} pend.</span> : null}
            </Link>
          );
        })}
      </div>
    </>
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
