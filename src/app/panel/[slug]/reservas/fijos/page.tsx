import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { ActionForm } from "@/components/ActionForm";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { listSeries } from "@/modules/booking/series";
import { listCourtsAdmin } from "@/modules/courts/service";
import { cancelSeriesAction, createSeriesAction, previewSeriesAction } from "../../actions";
import { SeriesForm } from "./SeriesForm";

export const metadata: Metadata = { title: "Turnos fijos" };
const DAYS = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default async function SeriesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await requireTenantPage(slug, "booking.manage");
  if (!access) notFound();
  const [series, courts] = await Promise.all([listSeries(access.ctx), listCourtsAdmin(access.ctx)]);
  const today = DateTime.now().setZone(access.tenant.timezone).toISODate()!;
  const preview = previewSeriesAction.bind(null, slug);

  return (
    <>
      <header className={ui.pageHeader}>
        <div><p className={ui.eyebrow}><Link href={`/panel/${slug}/reservas`}>Reservas</Link> / Turnos fijos</p><h1>Turnos fijos</h1></div>
      </header>
      <div className={ui.grid3}>
        <section className={ui.card} style={{ gridColumn: "span 2" }} aria-labelledby="activos">
          <div className={ui.cardHeader}><h2 id="activos">Activos</h2></div>
          {series.length === 0 ? (
            <div className={ui.empty}>
              <p><strong>Todavía no hay turnos fijos.</strong></p>
              <p className={ui.muted}>Cargá acá a los grupos que juegan todas las semanas: se reservan todas las fechas de una vez y el sistema avisa si alguna ya está ocupada.</p>
            </div>
          ) : (
            <div className={ui.tableWrap}>
              <table className={`${ui.table} ${ui.tableResponsive}`}>
                <thead><tr><th>Cliente</th><th>Cuándo</th><th>Cancha</th><th>Vigencia</th><th>Próximas</th><th><span className="sr-only">Acciones</span></th></tr></thead>
                <tbody>
                  {series.map((s) => (
                    <tr key={s.id}>
                      <td><strong>{s.customer.name}</strong><div className={ui.faint}>{s.customer.phone}</div></td>
                      <td>{DAYS[s.weekday]} {hhmm(s.startMinute)} · {s.durationMinutes} min</td>
                      <td>{s.court.name}</td>
                      <td>{s.startsOn.split("-").reverse().join("/")} → {s.endsOn.split("-").reverse().join("/")}</td>
                      <td>{s.upcoming}</td>
                      <td>
                        <ActionForm action={cancelSeriesAction.bind(null, slug, s.id)} submitLabel="Cancelar serie" variant="ghost" small quietSuccess confirm={{ title: `¿Cancelar el turno fijo de ${s.customer.name}?`, body: "Se cancelan todas las reservas futuras de la serie. Las pasadas no se tocan.", confirmLabel: "Sí, cancelar" }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className={ui.card} aria-labelledby="nuevo">
          <div className={ui.cardHeader}><h2 id="nuevo">Nuevo turno fijo</h2></div>
          {courts.filter((c) => c.isActive).length ? (
            <SeriesForm courts={courts.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name, allowedDurations: c.allowedDurations }))} today={today} preview={preview} create={createSeriesAction.bind(null, slug)} />
          ) : <p className={ui.muted}>Primero creá una cancha.</p>}
        </section>
      </div>
    </>
  );
}
