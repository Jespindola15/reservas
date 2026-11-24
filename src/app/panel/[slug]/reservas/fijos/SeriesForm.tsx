"use client";

import { useActionState, useState, useTransition } from "react";
import ui from "@/components/ui.module.css";
import type { ActionResult } from "@/lib/actions";
import type { SeriesPreviewResult } from "../../actions";

type Court = { id: string; name: string; allowedDurations: number[] };
const STATUS: Record<string, { label: string; tone: string }> = {
  ok: { label: "Libre", tone: "badgeCONFIRMED" },
  taken: { label: "Ocupado", tone: "badgeCANCELLED" },
  closed: { label: "Cerrado / fuera de horario", tone: "badgeEXPIRED" },
  past: { label: "Ya pasó", tone: "badgeEXPIRED" },
};

/**
 * Alta de turno fijo en dos pasos: 1) revisar fechas (el servidor marca libres/ocupadas)
 * 2) confirmar, pudiendo desmarcar fechas. Las ocupadas nunca se crean (sin duplicados).
 */
export function SeriesForm(props: {
  courts: Court[];
  today: string;
  preview: (fd: FormData) => Promise<SeriesPreviewResult>;
  create: (p: ActionResult, fd: FormData) => Promise<ActionResult>;
}) {
  const [preview, setPreview] = useState<SeriesPreviewResult | null>(null);
  const [checking, startCheck] = useTransition();
  const [result, createAction, creating] = useActionState(props.create, null);
  const [courtId, setCourtId] = useState(props.courts[0]?.id ?? "");
  const durations = props.courts.find((c) => c.id === courtId)?.allowedDurations ?? [60];

  if (result?.ok) {
    return (
      <div className={ui.stack}>
        <p role="status" className={`${ui.alert} ${ui.alertOk}`}>{result.message}</p>
        <button type="button" className={`${ui.button} ${ui.buttonSecondary}`} onClick={() => window.location.reload()}>Cargar otro turno fijo</button>
      </div>
    );
  }

  return (
    <form
      className={ui.stack}
      action={createAction}
      onChange={() => setPreview(null)}
      onSubmit={(e) => {
        if (preview?.ok) return; // segundo paso: envía la creación
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startCheck(async () => setPreview(await props.preview(fd)));
      }}
    >
      <div className={ui.grid2}>
        <label className={ui.field}><span className={ui.label}>Cliente</span><input className={ui.input} name="name" required minLength={2} maxLength={80} /></label>
        <label className={ui.field}><span className={ui.label}>Teléfono</span><input className={ui.input} name="phone" type="tel" required minLength={6} maxLength={30} /></label>
        <label className={ui.field}><span className={ui.label}>Email (opcional)</span><input className={ui.input} name="email" type="email" maxLength={254} /></label>
        <label className={ui.field}><span className={ui.label}>Cancha</span>
          <select className={ui.select} name="courtId" value={courtId} onChange={(e) => setCourtId(e.target.value)}>
            {props.courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className={ui.field}><span className={ui.label}>Primera fecha</span><input className={ui.input} type="date" name="startsOn" min={props.today} defaultValue={props.today} required /><span className={ui.hint}>Se repite el mismo día de la semana.</span></label>
        <label className={ui.field}><span className={ui.label}>Hasta (máx. 26 semanas)</span><input className={ui.input} type="date" name="endsOn" min={props.today} required /></label>
        <label className={ui.field}><span className={ui.label}>Hora</span><input className={ui.input} type="time" name="startTime" step={900} required /></label>
        <label className={ui.field}><span className={ui.label}>Duración</span>
          <select className={ui.select} name="durationMinutes">{durations.map((d) => <option key={d} value={d}>{d} min</option>)}</select>
        </label>
      </div>
      <label className={ui.field}><span className={ui.label}>Nota interna (opcional)</span><input className={ui.input} name="notes" maxLength={500} /></label>

      {preview && !preview.ok ? <p role="alert" className={`${ui.alert} ${ui.alertError}`}>{preview.message}</p> : null}
      {preview?.ok ? (
        <fieldset className={ui.card} style={{ padding: "1rem" }}>
          <legend className={ui.label}>Fechas ({preview.occurrences.filter((o) => o.status === "ok").length} libres de {preview.occurrences.length})</legend>
          <p className={ui.hint}>Las fechas ocupadas o cerradas no se reservan. Podés desmarcar fechas libres que no quieras incluir.</p>
          <ul className={ui.stackSm} style={{ listStyle: "none", padding: 0 }}>
            {preview.occurrences.map((o) => (
              <li key={o.date} className={ui.spread}>
                <label className={ui.checkbox}>
                  {o.status === "ok" ? <input type="checkbox" defaultChecked onChange={(e) => { const el = document.getElementById(`skip-${o.date}`) as HTMLInputElement | null; if (el) el.disabled = e.target.checked; }} /> : <input type="checkbox" disabled />}
                  {o.date.split("-").reverse().join("/")}
                </label>
                <input type="hidden" id={`skip-${o.date}`} name="skip" value={o.date} disabled={o.status === "ok"} />
                <span className={`${ui.badge} ${ui[STATUS[o.status]!.tone] ?? ""}`}>{STATUS[o.status]!.label}</span>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}
      {result && !result.ok ? <p role="alert" className={`${ui.alert} ${ui.alertError}`}>{result.message}</p> : null}
      <button className={ui.button} disabled={checking || creating || (preview?.ok === true && preview.occurrences.every((o) => o.status !== "ok"))}>
        {checking ? "Revisando fechas…" : creating ? "Creando reservas…" : preview?.ok ? "Confirmar turno fijo" : "Revisar disponibilidad"}
      </button>
    </form>
  );
}
