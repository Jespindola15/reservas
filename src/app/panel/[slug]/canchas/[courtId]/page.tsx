import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { isAppError } from "@/lib/errors";
import { formatMoney } from "@/modules/booking/pricing";
import { minutesToHHMM } from "@/modules/booking/time";
import { getCourtAdmin, SPORT_LABEL } from "@/modules/courts/service";
import {
  addPriceRuleAction,
  deleteCourtAction,
  deleteCourtImageAction,
  deletePriceRuleAction,
  saveWeeklyScheduleAction,
  setCourtActiveAction,
  updateCourtAction,
  uploadCourtImageAction,
} from "../../config-actions";
import { CourtFields } from "../CourtFields";
import styles from "../courts.module.css";

export const metadata: Metadata = { title: "Editar cancha" };
const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export default async function CourtPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; courtId: string }>;
  searchParams: Promise<{ nueva?: string }>;
}) {
  const { slug, courtId } = await params;
  const { nueva } = await searchParams;
  const access = await requireTenantPage(slug, "court.manage");
  if (!access) notFound();
  let court;
  try {
    court = await getCourtAdmin(access.ctx, courtId);
  } catch (e) {
    if (isAppError(e) && (e.code === "COURT_NOT_FOUND" || e.code === "VALIDATION_ERROR")) notFound();
    throw e;
  }
  const byDay = new Map(court.scheduleRules.map((r) => [r.weekday, r]));
  const currency = access.tenant.currency;

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>
            <Link href={`/panel/${slug}/canchas`}>Canchas</Link> / {SPORT_LABEL[court.sport]}
          </p>
          <h1>{court.name}</h1>
        </div>
        <div className={ui.row}>
          <span className={`${ui.badge} ${court.isActive ? ui.badgeCONFIRMED : ui.badgeEXPIRED}`}>{court.isActive ? "Activa" : "Inactiva"}</span>
          <ActionForm
            action={setCourtActiveAction.bind(null, slug, court.id, !court.isActive)}
            submitLabel={court.isActive ? "Desactivar" : "Activar"}
            variant={court.isActive ? "danger" : "secondary"}
            small
            confirm={court.isActive ? { title: "¿Desactivar la cancha?", body: "No se ofrecerán turnos nuevos. Las reservas existentes se conservan." } : undefined}
          />
          {court._count.bookings === 0 ? (
            <ActionForm
              action={deleteCourtAction.bind(null, slug, court.id)}
              submitLabel="Eliminar"
              variant="ghost"
              small
              confirm={{ title: "¿Eliminar la cancha?", body: "No tiene reservas. Esta acción no se puede deshacer.", confirmLabel: "Eliminar" }}
            />
          ) : null}
        </div>
      </header>

      {nueva ? <p className={`${ui.alert} ${ui.alertInfo}`} style={{ marginBottom: "1rem" }}>Cancha creada. Configurá el horario semanal para que empiece a ofrecer turnos.</p> : null}
      {court.scheduleRules.length === 0 ? (
        <p className={`${ui.alert} ${ui.alertWarn}`} style={{ marginBottom: "1rem" }}>Esta cancha no tiene horario: no se pueden reservar turnos.</p>
      ) : null}

      <div className={styles.columns}>
        <div className={ui.stack}>
          <section className={ui.card} aria-labelledby="datos">
            <div className={ui.cardHeader}><h2 id="datos">Datos de la cancha</h2></div>
            <ActionForm action={updateCourtAction.bind(null, slug, court.id)} submitLabel="Guardar cambios" className={ui.stack}>
              <CourtFields court={court} />
            </ActionForm>
          </section>

          <section className={ui.card} aria-labelledby="horario">
            <div className={ui.cardHeader}>
              <h2 id="horario">Horario semanal</h2>
              <span className={ui.muted}>Si el cierre es anterior a la apertura, termina al día siguiente.</span>
            </div>
            <ActionForm action={saveWeeklyScheduleAction.bind(null, slug, court.id)} submitLabel="Guardar horario" className={ui.stack}>
              <div>
                {WEEKDAYS.map((label, i) => {
                  const wd = i + 1;
                  const r = byDay.get(wd);
                  return (
                    <div key={wd} className={styles.scheduleRow}>
                      <label className={ui.checkbox}>
                        <input type="checkbox" name={`open_${wd}`} defaultChecked={Boolean(r)} />
                        {label}
                      </label>
                      <label className={ui.field}>
                        <span className="sr-only">Apertura {label}</span>
                        <input className={ui.input} type="time" name={`from_${wd}`} defaultValue={r ? minutesToHHMM(r.openMinute) : "09:00"} />
                      </label>
                      <label className={ui.field}>
                        <span className="sr-only">Cierre {label}</span>
                        <input className={ui.input} type="time" name={`to_${wd}`} defaultValue={r ? minutesToHHMM(r.closeMinute) : "23:00"} />
                      </label>
                    </div>
                  );
                })}
              </div>
              <label className={ui.checkbox}>
                <input type="checkbox" name="applyAll" /> Aplicar este horario a todas las canchas del complejo
              </label>
              <p className={ui.hint}>Las reservas ya tomadas no se modifican. Para feriados o días especiales usá “Feriados y bloqueos”.</p>
            </ActionForm>
          </section>
        </div>

        <div className={ui.stack}>
          <section className={ui.card} aria-labelledby="tarifas">
            <div className={ui.cardHeader}>
              <h2 id="tarifas">Tarifas</h2>
              <span className={ui.muted}>Gana la más específica</span>
            </div>
            {court.priceRules.length === 0 ? (
              <p className={ui.muted}>Sin tarifas específicas{court.basePrice != null ? `: se usa el precio base (${formatMoney(court.basePrice, currency)}/h).` : " ni precio base: el precio figura “A confirmar”."}</p>
            ) : (
              <div className={ui.tableWrap}>
                <table className={ui.table}>
                  <thead><tr><th>Cuándo</th><th>Duración</th><th>Precio</th><th><span className="sr-only">Acción</span></th></tr></thead>
                  <tbody>
                    {court.priceRules.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.specialDate ? `Fecha ${r.specialDate.split("-").reverse().join("/")}` : r.weekday ? WEEKDAYS[r.weekday - 1] : "Todos los días"}
                          {r.startMinute !== null ? <div className={ui.faint}>{minutesToHHMM(r.startMinute)}–{minutesToHHMM(r.endMinute!)}</div> : null}
                        </td>
                        <td>{r.durationMinutes} min</td>
                        <td><strong>{formatMoney(r.amount, currency)}</strong></td>
                        <td>
                          <ActionForm action={deletePriceRuleAction.bind(null, slug, court.id)} submitLabel="Quitar" variant="ghost" small quietSuccess>
                            <input type="hidden" name="ruleId" value={r.id} />
                          </ActionForm>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <details style={{ marginTop: "1rem" }}>
              <summary className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`}>+ Agregar tarifa</summary>
              <ActionForm action={addPriceRuleAction.bind(null, slug, court.id)} submitLabel="Agregar tarifa" className={ui.stack} resetOnSuccess>
                <div className={ui.grid2} style={{ marginTop: "0.9rem" }}>
                  <label className={ui.field}>
                    <span className={ui.label}>Duración</span>
                    <select className={ui.select} name="durationMinutes">
                      {court.allowedDurations.map((d) => <option key={d} value={d}>{d} min</option>)}
                    </select>
                  </label>
                  <label className={ui.field}>
                    <span className={ui.label}>Precio ($)</span>
                    <input className={ui.input} name="amount" type="number" min={0} step={1} required />
                  </label>
                  <label className={ui.field}>
                    <span className={ui.label}>Días</span>
                    <select className={ui.select} name="days" defaultValue="all">
                      <option value="all">Todos los días</option>
                      <option value="weekdays">Lunes a viernes</option>
                      <option value="weekend">Fin de semana</option>
                      {WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
                    </select>
                  </label>
                  <label className={ui.field}>
                    <span className={ui.label}>Fecha especial (opcional)</span>
                    <input className={ui.input} name="specialDate" type="date" />
                  </label>
                  <label className={ui.field}>
                    <span className={ui.label}>Franja desde (opcional)</span>
                    <input className={ui.input} name="from" type="time" />
                  </label>
                  <label className={ui.field}>
                    <span className={ui.label}>Franja hasta</span>
                    <input className={ui.input} name="to" type="time" />
                  </label>
                </div>
                <p className={ui.hint}>Prioridad: fecha especial › día + franja › franja › día › general › precio base.</p>
              </ActionForm>
            </details>
          </section>

          <section className={ui.card} aria-labelledby="imagenes">
            <div className={ui.cardHeader}>
              <h2 id="imagenes">Imágenes</h2>
              <span className={ui.muted}>{court.images.length}/6 · JPG, PNG o WebP hasta 1,5 MB</span>
            </div>
            {court.images.length ? (
              <div className={styles.images}>
                {court.images.map((img) => (
                  <div key={img.id} className={styles.imageItem}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/public/${slug}/courts/${court.id}/images/${img.id}`} alt={`Imagen de ${court.name}`} />
                    <ActionForm action={deleteCourtImageAction.bind(null, slug, court.id)} submitLabel="Quitar" variant="ghost" small quietSuccess>
                      <input type="hidden" name="imageId" value={img.id} />
                    </ActionForm>
                  </div>
                ))}
              </div>
            ) : null}
            {court.images.length < 6 ? (
              <ActionForm action={uploadCourtImageAction.bind(null, slug, court.id)} submitLabel="Subir imagen" pendingLabel="Subiendo…" variant="secondary" className={ui.stack} resetOnSuccess>
                <input className={ui.input} type="file" name="image" accept="image/jpeg,image/png,image/webp" required style={{ marginTop: "0.75rem" }} />
              </ActionForm>
            ) : null}
          </section>
        </div>
      </div>
    </>
  );
}
