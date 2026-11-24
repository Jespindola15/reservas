import ui from "@/components/ui.module.css";
import { ALLOWED_DURATIONS, SLOT_STEPS, SPORTS, SPORT_LABEL, SURFACES, SURFACE_LABEL } from "@/modules/courts/service";

/** Campos compartidos de alta/edición de cancha (render de servidor). */
export function CourtFields({
  court,
}: {
  court?: {
    name: string;
    sport: (typeof SPORTS)[number];
    description: string | null;
    capacity: number | null;
    allowedDurations: number[];
    slotStepMinutes: number;
    basePrice: number | null;
    surface?: string | null;
    dimensions?: string | null;
    covered?: boolean | null;
    lighting?: boolean | null;
  };
}) {
  return (
    <>
      <div className={ui.grid2}>
        <label className={ui.field}>
          <span className={ui.label}>Nombre</span>
          <input className={ui.input} name="name" required maxLength={80} defaultValue={court?.name} placeholder="Cancha 1" />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Deporte</span>
          <select className={ui.select} name="sport" defaultValue={court?.sport ?? "FOOTBALL_5"}>
            {SPORTS.map((s) => (
              <option key={s} value={s}>{SPORT_LABEL[s]}</option>
            ))}
          </select>
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Capacidad (jugadores)</span>
          <input className={ui.input} name="capacity" type="number" min={1} max={50} defaultValue={court?.capacity ?? ""} placeholder="10" />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Precio base por hora ($)</span>
          <input className={ui.input} name="basePrice" type="number" min={0} step={1} defaultValue={court?.basePrice != null ? court.basePrice / 100 : ""} placeholder="20000" />
          <span className={ui.hint}>Se usa cuando no hay una tarifa específica. Se prorratea por duración.</span>
        </label>
      </div>
      <fieldset className={ui.fieldset}>
        <legend>Características (se muestran a los jugadores)</legend>
        <div className={ui.grid2}>
          <label className={ui.field}>
            <span className={ui.label}>Superficie</span>
            <select className={ui.select} name="surface" defaultValue={court?.surface ?? ""}>
              <option value="">Sin especificar</option>
              {SURFACES.map((s) => <option key={s} value={s}>{SURFACE_LABEL[s]}</option>)}
            </select>
          </label>
          <label className={ui.field}>
            <span className={ui.label}>Modalidad</span>
            <select className={ui.select} name="covered" defaultValue={court?.covered === true ? "si" : court?.covered === false ? "no" : ""}>
              <option value="">Sin especificar</option><option value="si">Techada</option><option value="no">Descubierta</option>
            </select>
          </label>
          <label className={ui.field}>
            <span className={ui.label}>Dimensiones</span>
            <input className={ui.input} name="dimensions" maxLength={40} defaultValue={court?.dimensions ?? ""} placeholder="Ej.: 20 × 10 m" />
          </label>
          <label className={ui.checkbox} style={{ alignSelf: "end" }}>
            <input type="checkbox" name="lighting" defaultChecked={court?.lighting ?? false} /> Iluminación nocturna
          </label>
        </div>
      </fieldset>
      <label className={ui.field}>
        <span className={ui.label}>Descripción</span>
        <textarea className={ui.textarea} name="description" maxLength={500} defaultValue={court?.description ?? ""} placeholder="Césped sintético, techada, con iluminación LED." />
      </label>
      <div className={ui.grid2}>
        <fieldset className={ui.fieldset}>
          <legend>Duraciones de turno</legend>
          <div className={ui.row}>
            {ALLOWED_DURATIONS.map((d) => (
              <label key={d} className={ui.checkbox}>
                <input type="checkbox" name="allowedDurations" value={d} defaultChecked={court ? court.allowedDurations.includes(d) : true} />
                {d} min
              </label>
            ))}
          </div>
        </fieldset>
        <label className={ui.field}>
          <span className={ui.label}>Intervalo entre inicios de turno</span>
          <select className={ui.select} name="slotStepMinutes" defaultValue={court?.slotStepMinutes ?? 30}>
            {SLOT_STEPS.map((s) => (
              <option key={s} value={s}>Cada {s} minutos</option>
            ))}
          </select>
          <span className={ui.hint}>Con 30 min, los turnos pueden empezar 18:00, 18:30, 19:00…</span>
        </label>
      </div>
    </>
  );
}
