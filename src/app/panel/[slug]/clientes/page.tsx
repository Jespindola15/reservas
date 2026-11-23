import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { isAppError } from "@/lib/errors";
import { formatLocalDateTime } from "@/modules/booking/time";
import { listCustomers } from "@/modules/customers/service";

export const metadata: Metadata = { title: "Clientes" };

export default async function CustomersPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const access = await requireTenantPage(slug, "customer.read");
  if (!access) notFound();
  let data;
  try {
    data = await listCustomers(access.ctx, { q: sp.q, page: sp.page ? Number(sp.page) : 1 });
  } catch (e) {
    if (!(isAppError(e) && e.code === "VALIDATION_ERROR")) throw e;
    data = await listCustomers(access.ctx, {});
  }
  const pageHref = (p: number) => `?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), page: String(p) }).toString()}`;

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Gestión</p>
          <h1>Clientes</h1>
        </div>
      </header>
      <form className={`${ui.card} ${ui.row}`} style={{ marginBottom: "1rem" }} role="search">
        <label className="sr-only" htmlFor="q">Buscar cliente</label>
        <input id="q" className={ui.input} name="q" defaultValue={sp.q} maxLength={80} placeholder="Buscar por nombre, teléfono o email" style={{ flex: 1, minWidth: 200 }} />
        <button className={ui.button}>Buscar</button>
        {sp.q ? <Link href={`/panel/${slug}/clientes`} className={`${ui.button} ${ui.buttonGhost}`}>Limpiar</Link> : null}
      </form>
      <section className={ui.card}>
        <div className={ui.cardHeader}>
          <h2>{data.total} {data.total === 1 ? "cliente" : "clientes"}</h2>
          <span className={ui.muted}>Solo clientes de este complejo</span>
        </div>
        {data.rows.length === 0 ? (
          <p className={ui.empty}>{sp.q ? "No encontramos clientes con esa búsqueda." : "Todavía no hay clientes: se crean solos al registrar reservas."}</p>
        ) : (
          <div className={ui.tableWrap}>
            <table className={`${ui.table} ${ui.tableResponsive}`}>
              <thead><tr><th>Cliente</th><th>Contacto</th><th>Reservas</th><th>Cancelaciones</th><th>Última reserva</th></tr></thead>
              <tbody>
                {data.rows.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/panel/${slug}/clientes/${c.id}`}>{c.name}</Link></td>
                    <td>{c.phone ?? "—"}<div className={ui.faint}>{c.email ?? ""}</div></td>
                    <td>{c.bookings}</td>
                    <td>{c.cancellations > 0 ? <span className={`${ui.badge} ${ui.badgeCANCELLED}`}>{c.cancellations}</span> : "0"}</td>
                    <td>{c.lastBookingAt ? formatLocalDateTime(c.lastBookingAt, access.tenant.timezone) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.pages > 1 ? (
          <nav className={ui.row} style={{ marginTop: "1rem", justifyContent: "flex-end" }} aria-label="Paginación">
            {data.page > 1 ? <Link className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} href={pageHref(data.page - 1)}>← Anterior</Link> : null}
            {data.page < data.pages ? <Link className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} href={pageHref(data.page + 1)}>Siguiente →</Link> : null}
          </nav>
        ) : null}
      </section>
    </>
  );
}
