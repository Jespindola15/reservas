import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { isAppError } from "@/lib/errors";
import { formatLocalDateTime } from "@/modules/booking/time";
import { findDuplicateCustomers, listCustomers } from "@/modules/customers/service";
import { formatMoney } from "@/modules/booking/pricing";
import { whatsappLink } from "@/lib/contact/whatsapp";
import { hasPermission } from "@/modules/access/authorize";

export const metadata: Metadata = { title: "Clientes" };

export default async function CustomersPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; page?: string; filtro?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const access = await requireTenantPage(slug, "customer.read");
  if (!access) notFound();
  let data;
  try {
    data = await listCustomers(access.ctx, { q: sp.q, page: sp.page ? Number(sp.page) : 1, filter: sp.filtro });
  } catch (e) {
    if (!(isAppError(e) && e.code === "VALIDATION_ERROR")) throw e;
    data = await listCustomers(access.ctx, {});
  }
  const filter = sp.filtro ?? "all";
  const pageHref = (p: number) => `?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.filtro ? { filtro: sp.filtro } : {}), page: String(p) }).toString()}`;
  const duplicates = await findDuplicateCustomers(access.ctx);
  const cur = access.tenant.currency ?? "ARS";

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Gestión</p>
          <h1>Clientes</h1>
        </div>
        {hasPermission(access.role, "data.export") ? (
          <a className={`${ui.button} ${ui.buttonSecondary}`} href={`/panel/${slug}/exportar?tipo=clientes`} download>Exportar CSV</a>
        ) : null}
      </header>
      <form className={ui.toolbar} role="search">
        <label className="sr-only" htmlFor="q">Buscar cliente</label>
        <input id="q" className={ui.input} name="q" defaultValue={sp.q} maxLength={80} placeholder="Buscar por nombre, teléfono o email" style={{ flex: "2 1 220px", width: "auto" }} />
        <label className="sr-only" htmlFor="filtro">Filtrar clientes</label>
        <select id="filtro" name="filtro" className={ui.select} defaultValue={filter} style={{ flex: "1 1 200px", width: "auto", maxWidth: "100%" }}>
          <option value="all">Todos</option>
          <option value="frequent">Frecuentes (4+ visitas en 90 días)</option>
          <option value="inactive">Sin turnos hace 60 días</option>
          <option value="noshow">Con ausencias</option>
        </select>
        <button className={ui.button}>Buscar</button>
        {sp.q || (sp.filtro && sp.filtro !== "all") ? <Link href={`/panel/${slug}/clientes`} className={`${ui.button} ${ui.buttonGhost}`}>Limpiar</Link> : null}
      </form>
      <section className={ui.card}>
        <div className={ui.cardHeader}>
          <h2>{data.total} {data.total === 1 ? "cliente" : "clientes"}</h2>
          <span className={ui.muted}>Solo clientes de este complejo</span>
        </div>
        {data.rows.length === 0 ? (
          <p className={ui.empty}>{sp.q || filter !== "all" ? "No encontramos clientes con esa búsqueda." : "Todavía no hay clientes: se crean solos al registrar reservas."}</p>
        ) : (
          <div className={ui.tableWrap}>
            <table className={`${ui.table} ${ui.tableResponsive}`}>
              <thead><tr><th>Cliente</th><th>Contacto</th><th>Reservas</th><th>Visitas</th><th>Cancel./ausencias</th><th>Última visita</th><th>Abonado</th></tr></thead>
              <tbody>
                {data.rows.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/panel/${slug}/clientes/${c.id}`}>{c.name}</Link></td>
                    <td data-label="Contacto">
                      {c.phone ?? "—"}
                      {c.phone && whatsappLink(c.phone) ? <> · <a href={whatsappLink(c.phone)!} target="_blank" rel="noopener noreferrer">WhatsApp</a></> : null}
                      <div className={ui.faint}>{c.email ?? ""}</div>
                    </td>
                    <td data-label="Reservas">{c.bookings}</td>
                    <td data-label="Visitas">{c.visits}</td>
                    <td data-label="Cancel./ausencias">{c.cancellations > 0 ? <span className={`${ui.badge} ${ui.badgeCANCELLED}`}>{c.cancellations}</span> : "0"}</td>
                    <td data-label="Última visita">{c.lastVisitAt ? formatLocalDateTime(c.lastVisitAt, access.tenant.timezone) : "—"}</td>
                    <td data-label="Abonado">{formatMoney(c.totalPaid, cur)}</td>
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
      {duplicates.length > 0 ? (
        <section className={ui.card} style={{ marginTop: "1rem" }} aria-labelledby="duplicados">
          <div className={ui.cardHeader}>
            <h2 id="duplicados">Posibles duplicados</h2>
            <span className={ui.muted}>Comparten teléfono o email. Revisalos: no se unen solos.</span>
          </div>
          <ul className={ui.stack} style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {duplicates.map((g) => (
              <li key={g.customers.map((c) => c.id).join("-")}>
                <span className={ui.faint}>{g.reason === "phone" ? "Mismo teléfono" : "Mismo email"}: </span>
                {g.customers.map((c, i) => (
                  <span key={c.id}>{i > 0 ? " · " : ""}<Link href={`/panel/${slug}/clientes/${c.id}`}>{c.name}</Link></span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
