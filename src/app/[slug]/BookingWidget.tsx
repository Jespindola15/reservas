"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ui from "@/components/ui.module.css";
import styles from "./public.module.css";

type Slot = { startsAt: string; endsAt: string; available: boolean; priceAmount: number | null };
type Court = { id: string; name: string; sport: "FOOTBALL" | "PADEL"; slots: Slot[] };
type Day = { operatingDate: string; timezone: string; currency: string; courts: Court[] };
type Selection = { court: Court; slot: Slot; idempotencyKey: string };
type Result = { code: string; status: "PENDING" | "CONFIRMED"; startsAt: string };

const SPORT: Record<Court["sport"], string> = { FOOTBALL: "Fútbol", PADEL: "Pádel" };

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
  durations: number[];
  requiresApproval: boolean;
}) {
  const [date, setDate] = useState(props.today);
  const [duration, setDuration] = useState(props.durations.includes(90) ? 90 : (props.durations[0] ?? 60));
  const [reloadToken, setReloadToken] = useState(0);
  const [fetched, setFetched] = useState<{ key: string; day: Day | null; error: string | null } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat("es-AR", { timeZone: props.timezone, hour: "2-digit", minute: "2-digit", hour12: false }),
    [props.timezone],
  );
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat("es-AR", { timeZone: props.timezone, weekday: "long", day: "numeric", month: "long" }),
    [props.timezone],
  );
  const localDateOf = useCallback(
    (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: props.timezone }).format(new Date(iso)),
    [props.timezone],
  );
  const money = useCallback(
    (cents: number | null, currency: string) =>
      cents === null
        ? "A confirmar"
        : new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100),
    [],
  );

  // Clave de la consulta vigente: si cambia fecha/duración, la respuesta vieja
  // se descarta (AbortController) y nunca pisa a la nueva.
  const requestKey = `${date}|${duration}|${reloadToken}`;
  const loading = fetched?.key !== requestKey;
  const day = loading ? null : (fetched?.day ?? null);
  const loadError = loading ? null : (fetched?.error ?? null);
  const load = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/public/${encodeURIComponent(props.slug)}/availability?date=${date}&duration=${duration}`, {
      cache: "no-store",
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? "No pudimos cargar los horarios.");
        setFetched({ key: requestKey, day: json as Day, error: null });
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setFetched({
          key: requestKey,
          day: null,
          error: e instanceof Error ? e.message : "No pudimos cargar los horarios.",
        });
      });
    return () => ctrl.abort();
  }, [props.slug, date, duration, requestKey]);

  function choose(court: Court, slot: Slot) {
    setSubmitError(null);
    // Nueva clave por cada intento de reserva: reintentos del MISMO envío la reutilizan.
    setSelection({ court, slot, idempotencyKey: crypto.randomUUID() });
    // Llevar al formulario sin tapar los turnos (sin animación si el usuario la reduce).
    requestAnimationFrame(() =>
      document.getElementById("datos")?.closest("section")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      }),
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
          customer: {
            name: String(form.get("name") ?? ""),
            phone: String(form.get("phone") ?? ""),
            email: String(form.get("email") ?? ""),
          },
          notes: String(form.get("notes") ?? "") || undefined,
          idempotencyKey: selection.idempotencyKey,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSubmitError(json?.error?.message ?? "No pudimos registrar la reserva.");
        if (json?.error?.code === "SLOT_UNAVAILABLE") {
          setSelection(null);
          load();
        }
        return;
      }
      setResult(json as Result);
      setSelection(null);
      load();
    } catch {
      setSubmitError("Problema de conexión. Volvé a intentar: no se duplicará la reserva.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <section className={ui.card} aria-live="polite">
        <h2>{result.status === "CONFIRMED" ? "¡Reserva confirmada!" : "Solicitud recibida"}</h2>
        <p>
          Tu código de reserva es <strong className={styles.code}>{result.code}</strong>
        </p>
        <p className={ui.muted}>
          {dateFmt.format(new Date(result.startsAt))}, {timeFmt.format(new Date(result.startsAt))} hs.
          {result.status === "PENDING" ? " El complejo debe aprobarla; guardá el código para consultarla." : ""}
        </p>
        <button className={`${ui.button} ${ui.buttonSecondary}`} onClick={() => setResult(null)}>
          Hacer otra reserva
        </button>
      </section>
    );
  }

  return (
    <div className={styles.layout}>
      <section className={ui.card} aria-labelledby="buscar">
        <h2 id="buscar">Elegí día y duración</h2>
        <div className={ui.row}>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="date">Fecha</label>
            <input
              id="date"
              className={ui.input}
              type="date"
              value={date}
              min={props.today}
              max={addDays(props.today, props.maxAdvanceDays)}
              onChange={(e) => {
                if (e.target.value) {
                  setDate(e.target.value);
                  setSelection(null);
                }
              }}
            />
          </div>
          <div className={ui.field}>
            <span className={ui.label} id="dur-label">Duración</span>
            <div className={styles.segmented} role="radiogroup" aria-labelledby="dur-label">
              {props.durations.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={d === duration}
                  className={d === duration ? styles.segActive : styles.seg}
                  onClick={() => {
                    setDuration(d);
                    setSelection(null);
                  }}
                >
                  {d} min
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className={ui.muted}>Los turnos después de medianoche aparecen dentro del día anterior.</p>
      </section>

      <section aria-live="polite" aria-busy={loading} className={ui.stack}>
        {loading ? <p className={ui.muted}>Cargando horarios…</p> : null}
        {loadError ? (
          <div className={`${ui.alert} ${ui.alertError}`} role="alert">
            {loadError}{" "}
            <button className={`${ui.button} ${ui.buttonSmall} ${ui.buttonSecondary}`} onClick={load}>
              Reintentar
            </button>
          </div>
        ) : null}
        {!loading &&
          day?.courts.map((court) => {
            const free = court.slots.filter((s) => s.available);
            return (
              <article key={court.id} className={ui.card}>
                <div className={styles.courtHead}>
                  <h3>{court.name}</h3>
                  <span className={ui.badge}>{SPORT[court.sport]}</span>
                </div>
                {court.slots.length === 0 ? (
                  <p className={ui.muted}>Sin turnos de {duration} min este día.</p>
                ) : free.length === 0 ? (
                  <p className={ui.muted}>No quedan turnos libres este día.</p>
                ) : null}
                <div className={styles.slots}>
                  {court.slots.map((slot) => {
                    const selected = selection?.slot.startsAt === slot.startsAt && selection.court.id === court.id;
                    const nextDay = localDateOf(slot.startsAt) !== date;
                    return (
                      <button
                        key={slot.startsAt}
                        type="button"
                        disabled={!slot.available}
                        className={selected ? styles.slotSelected : styles.slot}
                        aria-pressed={selected}
                        onClick={() => choose(court, slot)}
                      >
                        <span className={styles.slotTime}>
                          {timeFmt.format(new Date(slot.startsAt))}
                          {nextDay ? <small> (madrugada)</small> : null}
                        </span>
                        <span className={styles.slotPrice}>
                          {slot.available ? money(slot.priceAmount, day.currency) : "Ocupado"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </article>
            );
          })}
      </section>

      {selection ? (
        <section className={`${ui.card} ${styles.checkout}`} aria-labelledby="datos">
          <h2 id="datos">Tus datos</h2>
          <p className={ui.muted}>
            {selection.court.name} · {dateFmt.format(new Date(selection.slot.startsAt))} ·{" "}
            {timeFmt.format(new Date(selection.slot.startsAt))} a {timeFmt.format(new Date(selection.slot.endsAt))} ·{" "}
            {money(selection.slot.priceAmount, day?.currency ?? "ARS")}
          </p>
          <form onSubmit={submit} className={ui.stack}>
            <div className={ui.field}>
              <label className={ui.label} htmlFor="name">Nombre y apellido</label>
              <input className={ui.input} id="name" name="name" required minLength={2} maxLength={80} autoComplete="name" />
            </div>
            <div className={ui.grid2}>
              <div className={ui.field}>
                <label className={ui.label} htmlFor="phone">Teléfono</label>
                <input className={ui.input} id="phone" name="phone" type="tel" required minLength={6} maxLength={30} autoComplete="tel" />
              </div>
              <div className={ui.field}>
                <label className={ui.label} htmlFor="email">Email</label>
                <input className={ui.input} id="email" name="email" type="email" required maxLength={254} autoComplete="email" />
              </div>
            </div>
            <div className={ui.field}>
              <label className={ui.label} htmlFor="notes">Comentarios (opcional)</label>
              <textarea className={ui.textarea} id="notes" name="notes" maxLength={500} />
            </div>
            {submitError ? <p role="alert" className={`${ui.alert} ${ui.alertError}`}>{submitError}</p> : null}
            <div className={ui.row}>
              <button className={ui.button} type="submit" disabled={submitting}>
                {submitting ? "Enviando…" : props.requiresApproval ? "Solicitar reserva" : "Confirmar reserva"}
              </button>
              <button type="button" className={`${ui.button} ${ui.buttonSecondary}`} onClick={() => setSelection(null)}>
                Cambiar horario
              </button>
            </div>
            <p className={ui.muted}>No se realiza ningún pago online. El pago se coordina con el complejo.</p>
          </form>
        </section>
      ) : null}
    </div>
  );
}
