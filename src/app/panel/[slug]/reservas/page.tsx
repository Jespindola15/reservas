import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FilterBar } from "@/components/FilterBar";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { isAppError } from "@/lib/errors";
import { listBookings, type BookingFilters } from "@/modules/booking/admin-queries";
import { formatMoney } from "@/modules/booking/pricing";
import { formatLocalDateTime, formatLocalTime } from "@/modules/booking/time";
import { listCourtsAdmin } from "@/modules/courts/service";
import { hasPermission } from "@/modules/access/authorize";
import { STATUS_LABEL } from "../labels";

export const metadata: Metadata = { title: "Reservas" };

export default async function BookingsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const access = await requireTenantPage(slug, "booking.read");
  if (!access) notFound();
  const { ctx, tenant } = access;
  const filters: BookingFilters = {
    status: (sp.status || undefined) as BookingFilters["status"],
    courtId: sp.court || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
    q: sp.q || undefined,
    page: sp.page ? Number(sp.page) : 1,
  };
  let result;
  let invalid = false;
  try {
    result = await listBookings(ctx, tenant.timezone, filters);
  } catch (e) {
    if (!(isAppError(e) && e.code === "VALIDATION_ERROR")) throw e;
    invalid = true;
    result = await listBookings(ctx, tenant.timezone, {});
  }
  const courts = await listCourtsAdmin(ctx);
  const pageHref = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `?${q.toString()}`;
  };

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Gestión</p>
          <h1>Reservas</h1>
        </div>
        <div className={ui.row}>
          {hasPermission(access.role, "data.export") ? (
            <a
              className={`${ui.button} ${ui.buttonSecondary}`}
              href={`/panel/${slug}/exportar?${new URLSearchParams(Object.entries({ tipo: "reservas", status: sp.status, courtId: sp.court, from: sp.from, to: sp.to }).filter(([, v]) => v) as [string, string][]).toString()}`}
              download
            >
              Exportar CSV
            </a>
          ) : null}
          <Link href={`/panel/${slug}/reservas/fijos`} className={`${ui.button} ${ui.buttonSecondary}`}>Turnos fijos</Link>
          <Link href={`/panel/${slug}/calendario?nueva=1`} className={ui.button}>+ Reserva manual</Link>
        </div>
      </header>

      <FilterBar label="Buscar reservas" search={{ name: "q", placeholder: "Nombre, teléfono o código", defaultValue: sp.q }}
        active={Boolean(sp.status || sp.court || sp.from || sp.to)} clearHref={`/panel/${slug}/reservas`}>
        <label className={ui.field}>
          <span className={ui.label}>Estado</span>
          <select className={ui.select} name="status" defaultValue={sp.status ?? ""}>
            <option value="">Todos</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Cancha</span>
          <select className={ui.select} name="court" defaultValue={sp.court ?? ""}>
            <option value="">Todas</option>
            {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Desde</span>
          <input className={ui.input} type="date" name="from" defaultValue={sp.from} />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Hasta</span>
          <input className={ui.input} type="date" name="to" defaultValue={sp.to} />
        </label>
      </FilterBar>

      {invalid ? <p className={`${ui.alert} ${ui.alertWarn}`}>Algún filtro no era válido; se muestran todas las reservas.</p> : null}

      <section className={ui.card}>
        <div className={ui.cardHeader}>
          <h2>{result.total} {result.total === 1 ? "reserva" : "reservas"}</h2>
          <span className={ui.muted}>Página {result.page} de {result.pages}</span>
        </div>
        {result.rows.length === 0 ? (
          <p className={ui.empty}>No hay reservas con esos filtros.</p>
        ) : (
          <div className={ui.tableWrap}>
            <table className={`${ui.table} ${ui.tableResponsive}`}>
              <thead><tr><th>Turno</th><th>Cancha</th><th>Cliente</th><th>Importe</th><th>Estado</th></tr></thead>
              <tbody>
                {result.rows.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/panel/${slug}/reservas/${b.id}`}>{formatLocalDateTime(b.startsAt, tenant.timezone)}</Link>
                      <div className={ui.faint}>hasta {formatLocalTime(b.endsAt, tenant.timezone)} · {b.code}</div>
                    </td>
                    <td data-label="Cancha">{b.court.name}</td>
                    <td data-label="Cliente"><Link href={`/panel/${slug}/reservas/${b.id}`} className={ui.linkPlain}>{b.customerName}</Link><div className={ui.faint}>{b.customerPhone}</div></td>
                    <td data-label="Importe">{formatMoney(b.priceAmount, b.currency)}</td>
                    <td data-label="Estado">
                      <span className={`${ui.badge} ${ui[`badge${b.status}`] ?? ""}`}>{STATUS_LABEL[b.status]}</span>
                      {b.status === "PENDING" && b.expiresAt ? <div className={ui.faint}>vence {formatLocalTime(b.expiresAt, tenant.timezone)}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result.pages > 1 ? (
          <nav className={ui.row} style={{ marginTop: "1rem", justifyContent: "flex-end" }} aria-label="Paginación">
            {result.page > 1 ? <Link className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} href={pageHref(result.page - 1)}>← Anterior</Link> : null}
            {result.page < result.pages ? <Link className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} href={pageHref(result.page + 1)}>Siguiente →</Link> : null}
          </nav>
        ) : null}
      </section>
    </>
  );
}
