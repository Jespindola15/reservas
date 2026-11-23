import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { listUpcomingBlocks } from "@/modules/booking/queries";
import { formatLocalDateTime, minutesToHHMM, todayIn } from "@/modules/booking/time";
import { listCourtsAdmin, listScheduleExceptions } from "@/modules/courts/service";
import { createBlockAction, deleteBlockAction } from "../actions";
import { createExceptionAction, deleteExceptionAction } from "../config-actions";

export const metadata: Metadata = { title: "Feriados y bloqueos" };

export default async function SchedulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await requireTenantPage(slug, "court.manage");
  if (!access) notFound();
  const { ctx, tenant } = access;
  const today = todayIn(tenant.timezone);
  const [courts, exceptions, blocks] = await Promise.all([
    listCourtsAdmin(ctx),
    listScheduleExceptions(ctx, today),
    listUpcomingBlocks(ctx),
  ]);
  const active = courts.filter((c) => c.isActive);

  const courtSelect = (allLabel?: string) => (
    <label className={ui.field}>
      <span className={ui.label}>Cancha</span>
      <select className={ui.select} name="courtId">
        {allLabel ? <option value="">{allLabel}</option> : null}
        {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
  );

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Configuración</p>
          <h1>Feriados, días especiales y bloqueos</h1>
        </div>
      </header>

      <div className={ui.grid3}>
        <section className={ui.card} aria-labelledby="excepciones">
          <div className={ui.cardHeader}>
            <h2 id="excepciones">Feriados y días especiales</h2>
          </div>
          {exceptions.length === 0 ? (
            <p className={ui.muted}>No hay excepciones próximas: rige el horario semanal.</p>
          ) : (
            <ul className={ui.stackSm} style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {exceptions.map((e) => (
                <li key={e.id} className={ui.spread}>
                  <span>
                    <strong>{e.date.split("-").reverse().join("/")}</strong> · {e.reason}
                    <div className={ui.faint}>
                      {e.kind === "CLOSED" ? "Cerrado" : `Horario especial ${minutesToHHMM(e.openMinute!)}–${minutesToHHMM(e.closeMinute!)}`}
                      {" · "}
                      {e.court ? e.court.name : "Todo el complejo"}
                    </div>
                  </span>
                  <ActionForm action={deleteExceptionAction.bind(null, slug)} submitLabel="Quitar" variant="ghost" small quietSuccess>
                    <input type="hidden" name="exceptionId" value={e.id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
          <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "1rem 0" }} />
          <ActionForm action={createExceptionAction.bind(null, slug)} submitLabel="Registrar" className={ui.stack} resetOnSuccess>
            <div className={ui.grid2}>
              <label className={ui.field}>
                <span className={ui.label}>Fecha</span>
                <input className={ui.input} type="date" name="date" min={today} required />
              </label>
              <label className={ui.field}>
                <span className={ui.label}>Tipo</span>
                <select className={ui.select} name="kind" defaultValue="CLOSED">
                  <option value="CLOSED">Cerrado (feriado / cierre)</option>
                  <option value="SPECIAL_HOURS">Horario especial</option>
                </select>
              </label>
            </div>
            {courtSelect("Todo el complejo")}
            <div className={ui.grid2}>
              <label className={ui.field}>
                <span className={ui.label}>Desde (horario especial)</span>
                <input className={ui.input} type="time" name="from" />
              </label>
              <label className={ui.field}>
                <span className={ui.label}>Hasta</span>
                <input className={ui.input} type="time" name="to" />
              </label>
            </div>
            <label className={ui.field}>
              <span className={ui.label}>Motivo</span>
              <input className={ui.input} name="reason" required minLength={2} maxLength={200} placeholder="Feriado nacional" />
            </label>
            <p className={ui.hint}>Ese día deja de ofrecer turnos (o solo ofrece el horario especial). Las reservas existentes no se cancelan solas: revisalas en el calendario.</p>
          </ActionForm>
        </section>

        <section className={ui.card} aria-labelledby="bloqueos">
          <div className={ui.cardHeader}>
            <h2 id="bloqueos">Bloqueos de mantenimiento</h2>
          </div>
          {blocks.length === 0 ? (
            <p className={ui.muted}>No hay bloqueos vigentes.</p>
          ) : (
            <ul className={ui.stackSm} style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {blocks.map((b) => (
                <li key={b.id} className={ui.spread}>
                  <span>
                    <strong>{b.court.name}</strong> · {b.reason}
                    <div className={ui.faint}>
                      {formatLocalDateTime(b.startsAt, tenant.timezone)} → {formatLocalDateTime(b.endsAt, tenant.timezone)}
                    </div>
                  </span>
                  <ActionForm action={deleteBlockAction.bind(null, slug)} submitLabel="Quitar" variant="ghost" small quietSuccess>
                    <input type="hidden" name="blockId" value={b.id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
          <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "1rem 0" }} />
          <ActionForm action={createBlockAction.bind(null, slug)} submitLabel="Bloquear" className={ui.stack} resetOnSuccess>
            {courtSelect()}
            <label className={ui.field}>
              <span className={ui.label}>Fecha</span>
              <input className={ui.input} type="date" name="date" min={today} defaultValue={today} required />
            </label>
            <div className={ui.grid2}>
              <label className={ui.field}>
                <span className={ui.label}>Desde</span>
                <input className={ui.input} type="time" name="from" required />
              </label>
              <label className={ui.field}>
                <span className={ui.label}>Hasta</span>
                <input className={ui.input} type="time" name="to" required />
              </label>
            </div>
            <label className={ui.field}>
              <span className={ui.label}>Motivo</span>
              <input className={ui.input} name="reason" required minLength={2} maxLength={200} placeholder="Cambio de césped" />
            </label>
            <p className={ui.hint}>No se puede bloquear un intervalo con reservas activas: la base de datos lo impide.</p>
          </ActionForm>
        </section>
      </div>
    </>
  );
}
