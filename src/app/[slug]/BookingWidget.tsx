"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ui from "@/components/ui.module.css";
import styles from "./public.module.css";

type Sport = "FOOTBALL_5" | "FOOTBALL_7" | "FOOTBALL_8" | "FOOTBALL_11" | "PADEL" | "OTHER";
type CourtInfo = {
  id: string; name: string; sport: Sport; description: string | null; capacity: number | null; durations: number[]; imageId: string | null;
  surface?: string | null; covered?: boolean | null; dimensions?: string | null; lighting?: boolean | null;
};
type Deposit = { type: "NONE" | "PERCENT" | "FIXED"; value: number; note: string | null };
type Slot = { startsAt: string; endsAt: string; available: boolean; priceAmount: number | null };
type CourtDay = { id: string; name: string; sport: Sport; slots: Slot[]; closedReason: string | null };
type Day = { operatingDate: string; currency: string; courts: CourtDay[] };
type Selection = { court: CourtDay; slot: Slot; idempotencyKey: string };
type Result = { code: string; status: "PENDING" | "CONFIRMED"; startsAt: string; trackingUrl: string; expiresAt: string | null };

const SPORT: Record<Sport, string> = { FOOTBALL_5: "Fútbol 5", FOOTBALL_7: "Fútbol 7", FOOTBALL_8: "Fútbol 8", FOOTBALL_11: "Fútbol 11", PADEL: "Pádel", OTHER: "Otro" };
const SURFACE: Record<string, string> = { SINTETICO: "Sintético", CESPED: "Césped natural", CEMENTO: "Cemento", PARQUET: "Parquet", POLVO_LADRILLO: "Polvo de ladrillo", OTRA: "Otra superficie" };

/** Seña requerida para un precio (informativa: se abona al complejo, TURNUP no cobra online). */
export function depositFor(price: number | null, d: Deposit | undefined): number | null {
  if (!d || d.type === "NONE" || d.value <= 0 || price === null) return null;
  return d.type === "PERCENT" ? Math.round((price * d.value) / 100) : Math.min(d.value, price);
}

function courtFeatures(c: CourtInfo) {
  return [c.surface ? SURFACE[c.surface] : null, c.covered === true ? "Techada" : c.covered === false ? "Descubierta" : null, c.dimensions ?? null, c.lighting ? "Iluminación" : null, c.capacity ? `${c.capacity} por equipo` : null].filter(Boolean).join(" · ");
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function BookingWidget(props: {
  slug: string;
  timezone: string;
  today: string;
  maxAdvanceDays: number;
  requiresApproval: boolean;
  courts: CourtInfo[];
  cancellationPolicy?: string | null;
  cancellationMinutes?: number;
  tenantName?: string;
  tenantAddress?: string | null;
  currency?: string;
  deposit?: Deposit;
  origin?: "MARKETPLACE" | "DIRECT";
  /** Jugador con sesión: se precargan sus datos y la reserva queda en "Mis turnos". */
  player?: { name: string; email: string } | null;
}) {
  const sports = useMemo(() => [...new Set(props.courts.map((c) => c.sport))], [props.courts]);
  const [sport, setSport] = useState<Sport | "ALL">(sports.length === 1 ? sports[0]! : "ALL");
  const [courtId, setCourtId] = useState<string | "ALL">("ALL");
  const [date, setDate] = useState(props.today);
  const visibleCourts = props.courts.filter((c) => (sport === "ALL" || c.sport === sport) && (courtId === "ALL" || c.id === courtId));
  const durations = [...new Set(visibleCourts.flatMap((c) => c.durations))].sort((a, b) => a - b);
  const [durationPref, setDuration] = useState(90);
  const duration = durations.includes(durationPref) ? durationPref : (durations[0] ?? 60);
  const [reloadToken, setReloadToken] = useState(0);
  const [fetched, setFetched] = useState<{ key: string; day: Day | null; error: string | null } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  const timeFmt = useMemo(() => new Intl.DateTimeFormat("es-AR", { timeZone: props.timezone, hour: "2-digit", minute: "2-digit", hour12: false }), [props.timezone]);
  const dateFmt = useMemo(() => new Intl.DateTimeFormat("es-AR", { timeZone: props.timezone, weekday: "long", day: "numeric", month: "long" }), [props.timezone]);
  const pillFmt = useMemo(() => new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric" }), []);
  const localDateOf = useCallback((iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: props.timezone }).format(new Date(iso)), [props.timezone]);
  const money = (cents: number | null, currency: string) =>
    cents === null ? "A confirmar" : new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);

  // Consulta vigente: si cambia fecha/duración, la respuesta vieja se descarta.
  const requestKey = `${date}|${duration}|${reloadToken}`;
  const loading = fetched?.key !== requestKey;
  const day = loading ? null : (fetched?.day ?? null);
  const loadError = loading ? null : (fetched?.error ?? null);
  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/public/${encodeURIComponent(props.slug)}/availability?date=${date}&duration=${duration}`, { cache: "no-store", signal: ctrl.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? "No pudimos cargar los horarios.");
        setFetched({ key: requestKey, day: json as Day, error: null });
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setFetched({ key: requestKey, day: null, error: e instanceof Error ? e.message : "No pudimos cargar los horarios." });
      });
    return () => ctrl.abort();
  }, [props.slug, date, duration, requestKey]);

  const visibleIds = new Set(visibleCourts.map((c) => c.id));
  const dayCourts = day?.courts.filter((c) => visibleIds.has(c.id)) ?? [];
  const pills = Array.from({ length: Math.min(14, props.maxAdvanceDays + 1) }, (_, i) => addDays(props.today, i));
  const monthFmt = useMemo(() => new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", month: "short" }), []);

  function choose(court: CourtDay, slot: Slot) {
    setSubmitError(null);
    setSelection({ court, slot, idempotencyKey: crypto.randomUUID() });
    requestAnimationFrame(() =>
      document.getElementById("datos")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }),
    );
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selection || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/public/${encodeURIComponent(props.slug)}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courtId: selection.court.id,
          startsAt: selection.slot.startsAt,
          durationMinutes: duration,
          customer: { name: String(form.get("name") ?? ""), phone: String(form.get("phone") ?? ""), email: String(form.get("email") ?? "") },
          notes: String(form.get("notes") ?? "") || undefined,
          idempotencyKey: selection.idempotencyKey,
          website: String(form.get("website") ?? "") || undefined,
          origin: props.origin ?? "DIRECT",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSubmitError(
          json?.error?.code === "LIMIT_REACHED"
            ? "Ya tenés varias reservas activas en este complejo. Para reservar más, comunicate con el complejo."
            : (json?.error?.message ?? "No pudimos registrar la reserva."),
        );
        if (json?.error?.code === "SLOT_UNAVAILABLE") {
          setSelection(null);
          reload();
        }
        return;
      }
      setResult(json as Result);
      setSelection(null);
      reload();
    } catch {
      setSubmitError("Problema de conexión. Volvé a intentar: no se duplicará la reserva.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const link = `${window.location.origin}${result.trackingUrl}`;
    return (
      <section className={`${ui.card} ${styles.success}`} aria-live="polite">
        <p className={ui.eyebrow}>{result.status === "CONFIRMED" ? "Reserva confirmada" : "Solicitud enviada"}</p>
        <h2>{result.status === "CONFIRMED" ? "¡Listo, nos vemos en la cancha!" : "Recibimos tu solicitud"}</h2>
        <p>Código de seguimiento <strong className={styles.code}>{result.code}</strong></p>
        <p className={ui.muted}>
          {dateFmt.format(new Date(result.startsAt))}, {timeFmt.format(new Date(result.startsAt))} hs.
          {result.status === "PENDING" && result.expiresAt ? ` El complejo debe aprobarla antes de las ${timeFmt.format(new Date(result.expiresAt))}; si no, el turno se libera.` : ""}
        </p>
        <div className={styles.linkBox}>
          <span className={ui.label}>Tu enlace privado para consultar o cancelar</span>
          <code className={styles.linkText}>{link}</code>
          <div className={ui.row}>
            <button
              type="button"
              className={`${ui.button} ${ui.buttonSmall}`}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "¡Copiado!" : "Copiar enlace"}
            </button>
            <a className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} href={result.trackingUrl}>Ver estado</a>
          </div>
          <span className={ui.faint}>Guardalo: por seguridad, no se puede recuperar con el código solo.</span>
        </div>
        <ShareMatch
          text={`Reservé ${props.tenantName ? `en ${props.tenantName} ` : ""}para el ${dateFmt.format(new Date(result.startsAt))} a las ${timeFmt.format(new Date(result.startsAt))} hs. ¿Te sumás?`}
          url={`${window.location.origin}/${props.slug}`}
        />
        <button className={`${ui.button} ${ui.buttonGhost}`} onClick={() => { setResult(null); setCopied(false); }}>Hacer otra reserva</button>
      </section>
    );
  }

  return (
    <div className={styles.layout}>
      <section className={ui.card} aria-labelledby="paso1">
        <h2 id="paso1"><span className={styles.step}>1</span> Elegí el día</h2>
        <div className={styles.calendarStrip} role="radiogroup" aria-label="Fecha">
          {pills.map((d) => {
            const dt = new Date(`${d}T12:00:00Z`);
            return (
              <button key={d} type="button" role="radio" aria-checked={date === d} className={date === d ? styles.dayActive : styles.day}
                aria-label={d === props.today ? "Hoy" : pillFmt.format(dt)}
                onClick={() => { setDate(d); setSelection(null); }}>
                <small>{d === props.today ? "Hoy" : pillFmt.format(dt).split(" ")[0]}</small>
                <strong>{dt.getUTCDate()}</strong>
                <small>{monthFmt.format(dt).replace(".", "")}</small>
              </button>
            );
          })}
        </div>
        <label className={styles.pickDate}>
          <span className="sr-only">Otra fecha</span>
          <input type="date" className={ui.input} value={date} min={props.today} max={addDays(props.today, props.maxAdvanceDays)}
            onChange={(e) => { if (e.target.value) { setDate(e.target.value); setSelection(null); } }} aria-label="Elegir otra fecha" />
        </label>
      </section>

      <section className={ui.card} aria-labelledby="paso2">
        <h2 id="paso2"><span className={styles.step}>2</span> Elegí la cancha</h2>
        {sports.length > 1 ? (
          <div className={styles.chips} role="radiogroup" aria-label="Deporte">
            {(["ALL", ...sports] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={sport === s} className={sport === s ? styles.chipActive : styles.chip}
                onClick={() => { setSport(s); setCourtId("ALL"); setSelection(null); }}>
                {s === "ALL" ? "Todos" : SPORT[s]}
              </button>
            ))}
          </div>
        ) : null}
        <div className={styles.courtCards} role="radiogroup" aria-label="Cancha">
          <button type="button" role="radio" aria-checked={courtId === "ALL"} className={courtId === "ALL" ? styles.courtActive : styles.courtCard}
            onClick={() => { setCourtId("ALL"); setSelection(null); }}>
            <span className={styles.courtThumb} aria-hidden>★</span>
            <span><strong>Cualquier cancha</strong><span className={ui.faint}>Ver todos los horarios</span></span>
          </button>
          {props.courts.filter((c) => sport === "ALL" || c.sport === sport).map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={courtId === c.id} className={courtId === c.id ? styles.courtActive : styles.courtCard}
              onClick={() => { setCourtId(c.id); setSelection(null); }}>
              {c.imageId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.courtThumb} src={`/api/public/${props.slug}/courts/${c.id}/images/${c.imageId}`} alt="" loading="lazy" />
              ) : (
                <span className={styles.courtThumb} aria-hidden>{SPORT[c.sport].slice(0, 1)}</span>
              )}
              <span>
                <strong>{c.name}</strong>
                <span className={ui.faint}>{SPORT[c.sport]}</span>
                {courtFeatures(c) ? <span className={styles.courtDesc}>{courtFeatures(c)}</span> : null}
                {c.description ? <span className={styles.courtDesc}>{c.description}</span> : null}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="paso3" aria-busy={loading} className={ui.stack}>
        <h2 id="paso3" className={styles.sectionTitle}><span className={styles.step}>3</span> Duración y horario</h2>
        <div className={styles.segmented} role="radiogroup" aria-label="Duración">
          {durations.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={d === duration} className={d === duration ? styles.segActive : styles.seg}
              onClick={() => { setDuration(d); setSelection(null); }}>
              {d} min
            </button>
          ))}
        </div>
        <p className={ui.faint} style={{ marginTop: "-0.5rem" }}>Los turnos de madrugada (después de las 00:00) aparecen dentro del día anterior.</p>
        {loading ? <div className={`${ui.skeleton}`} style={{ height: 160 }} aria-label="Cargando horarios" /> : null}
        {loadError ? (
          <div className={`${ui.alert} ${ui.alertError}`} role="alert">
            {loadError} <button className={`${ui.button} ${ui.buttonSmall} ${ui.buttonSecondary}`} onClick={reload}>Reintentar</button>
          </div>
        ) : null}
        {!loading && day && dayCourts.length === 0 ? <p className={ui.empty}>No hay canchas con turnos de {duration} min para ese filtro.</p> : null}
        {!loading && day ? dayCourts.map((court) => {
          const free = court.slots.filter((s) => s.available);
          return (
            <article key={court.id} className={ui.card}>
              <div className={ui.spread} style={{ marginBottom: "0.75rem" }}>
                <h3 style={{ margin: 0 }}>{court.name}</h3>
                <span className={ui.badge}>{SPORT[court.sport]}</span>
              </div>
              {court.closedReason ? <p className={`${ui.alert} ${ui.alertWarn}`}>Cerrado: {court.closedReason}</p>
                : court.slots.length === 0 ? <p className={ui.muted}>Sin turnos de {duration} min este día.</p>
                : free.length === 0 ? <p className={ui.muted}>No quedan turnos libres este día.</p> : null}
              <div className={styles.slots}>
                {court.slots.map((slot) => {
                  const selected = selection?.slot.startsAt === slot.startsAt && selection.court.id === court.id;
                  return (
                    <button key={slot.startsAt} type="button" disabled={!slot.available} className={selected ? styles.slotSelected : styles.slot}
                      aria-pressed={selected} onClick={() => choose(court, slot)}>
                      <span className={styles.slotTime}>
                        {timeFmt.format(new Date(slot.startsAt))}
                        {localDateOf(slot.startsAt) !== date ? <small> madrugada</small> : null}
                      </span>
                      <span className={styles.slotPrice}>{slot.available ? money(slot.priceAmount, day.currency) : "Ocupado"}</span>
                    </button>
                  );
                })}
              </div>
            </article>
          );
        }) : null}
      </section>

      {selection ? (
        <section className={`${ui.card} ${styles.checkout}`} id="datos" aria-labelledby="paso4">
          <h2 id="paso4"><span className={styles.step}>4</span> Resumen y confirmación</h2>
          <dl className={styles.summaryList} aria-label="Resumen de la reserva">
            {props.tenantName ? <><dt>Complejo</dt><dd>{props.tenantName}</dd></> : null}
            {props.tenantAddress ? <><dt>Dirección</dt><dd>{props.tenantAddress}</dd></> : null}
            <dt>Cancha</dt><dd><strong>{selection.court.name}</strong></dd>
            <dt>Deporte</dt><dd>{SPORT[selection.court.sport]}</dd>
            <dt>Fecha</dt><dd>{dateFmt.format(new Date(selection.slot.startsAt))}</dd>
            <dt>Horario</dt><dd>{timeFmt.format(new Date(selection.slot.startsAt))} a {timeFmt.format(new Date(selection.slot.endsAt))} ({duration} min)</dd>
            <dt>Duración</dt><dd>{duration} minutos</dd>
            <dt>Precio total</dt><dd className={styles.total}>{money(selection.slot.priceAmount, day?.currency ?? "ARS")}</dd>
            {(() => {
              const dep = depositFor(selection.slot.priceAmount, props.deposit);
              if (dep === null || selection.slot.priceAmount === null) return null;
              return (
                <>
                  <dt>Seña requerida</dt><dd>{money(dep, day?.currency ?? "ARS")}{props.deposit?.note ? <span className={ui.faint}> · {props.deposit.note}</span> : null}</dd>
                  <dt>Saldo restante</dt><dd>{money(selection.slot.priceAmount - dep, day?.currency ?? "ARS")}</dd>
                </>
              );
            })()}
            <dt>Cancelación</dt>
            <dd>
              {props.cancellationMinutes !== undefined
                ? props.cancellationMinutes > 0
                  ? `Online hasta ${props.cancellationMinutes >= 120 && props.cancellationMinutes % 60 === 0 ? `${props.cancellationMinutes / 60} horas` : `${props.cancellationMinutes} minutos`} antes. `
                  : "Online hasta el inicio del turno. "
                : ""}
              {props.cancellationPolicy ?? ""}
            </dd>
          </dl>
          <form onSubmit={submit} className={ui.stack}>
            <label className={ui.field}>
              <span className={ui.label}>Nombre y apellido</span>
              <input className={ui.input} id="name" name="name" required minLength={2} maxLength={80} autoComplete="name" defaultValue={props.player?.name ?? ""} />
            </label>
            <div className={ui.grid2}>
              <label className={ui.field}>
                <span className={ui.label}>Teléfono</span>
                <input className={ui.input} id="phone" name="phone" type="tel" required minLength={6} maxLength={30} autoComplete="tel" />
              </label>
              <label className={ui.field}>
                <span className={ui.label}>Email</span>
                <input className={ui.input} id="email" name="email" type="email" required maxLength={254} autoComplete="email" defaultValue={props.player?.email ?? ""} />
                {/* Campo trampa: invisible para personas y lectores de pantalla; los bots lo completan. */}
                <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, opacity: 0 }} />
              </label>
            </div>
            <label className={ui.field}>
              <span className={ui.label}>Comentarios (opcional)</span>
              <textarea className={ui.textarea} id="notes" name="notes" maxLength={500} />
            </label>
            {submitError ? <p role="alert" className={`${ui.alert} ${ui.alertError}`}>{submitError}</p> : null}
            <div className={ui.row}>
              <button className={ui.button} type="submit" disabled={submitting}>
                {submitting ? <span className={ui.spinner} aria-hidden /> : null}
                {submitting ? "Enviando…" : props.requiresApproval ? "Solicitar reserva" : "Confirmar reserva"}
              </button>
              <button type="button" className={`${ui.button} ${ui.buttonSecondary}`} onClick={() => setSelection(null)}>Cambiar horario</button>
            </div>
            <p className={ui.faint}>No se realiza ningún pago online: {props.deposit && props.deposit.type !== "NONE" ? "la seña y el saldo se abonan" : "el importe se abona"} al complejo.</p>
            {props.player ? <p className={ui.faint}>La reserva quedará en <Link href="/mis-turnos">Mis turnos</Link>.</p> : <p className={ui.faint}>¿Querés ver tus reservas en un solo lugar? <Link href="/cuenta/registro">Creá tu cuenta de jugador</Link> (opcional).</p>}
          </form>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Compartir la reserva: comparte la FECHA y la página pública del complejo, nunca el
 * enlace privado de la reserva (que permite cancelarla).
 */
function ShareMatch({ text, url }: { text: string; url: string }) {
  const [msg, setMsg] = useState("");
  return (
    <div className={ui.row}>
      <button
        type="button"
        className={`${ui.button} ${ui.buttonSecondary}`}
        onClick={async () => {
          try {
            if (navigator.share) {
              await navigator.share({ text, url });
              return;
            }
            await navigator.clipboard.writeText(`${text} ${url}`);
            setMsg("Mensaje copiado para compartir.");
          } catch {
            setMsg("");
          }
        }}
      >
        Compartir
      </button>
      <a className={`${ui.button} ${ui.buttonGhost}`} href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`} target="_blank" rel="noopener noreferrer">
        Enviar por WhatsApp
      </a>
      <span role="status" className={ui.faint}>{msg}</span>
    </div>
  );
}
