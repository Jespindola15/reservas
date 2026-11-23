import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { isAppError } from "@/lib/errors";
import { hasPermission } from "@/modules/access/authorize";
import { formatMoney } from "@/modules/booking/pricing";
import { formatLocalDateTime } from "@/modules/booking/time";
import { getCustomer } from "@/modules/customers/service";
import { saveCustomerNotesAction } from "../../actions";
import { STATUS_LABEL } from "../../labels";

export const metadata: Metadata = { title: "Cliente" };

export default async function CustomerPage({ params }: { params: Promise<{ slug: string; customerId: string }> }) {
  const { slug, customerId } = await params;
  const access = await requireTenantPage(slug, "customer.read");
  if (!access) notFound();
  let data;
  try {
    data = await getCustomer(access.ctx, customerId);
  } catch (e) {
    if (isAppError(e) && (e.code === "NOT_FOUND" || e.code === "VALIDATION_ERROR")) notFound();
    throw e;
  }
  const { customer: c, bookings, stats } = data;
  const tz = access.tenant.timezone;

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}><Link href={`/panel/${slug}/clientes`}>Clientes</Link></p>
          <h1>{c.name}</h1>
        </div>
        <Link href={`/panel/${slug}/calendario?nueva=1`} className={ui.button}>+ Nueva reserva</Link>
      </header>
      <section className={ui.grid3} style={{ marginBottom: "1rem" }}>
        {[["Reservas", stats.total], ["Confirmadas / jugadas", stats.confirmed], ["Cancelaciones", stats.cancelled], ["Ausencias", stats.noShow]].map(([l, v]) => (
          <div key={l} className={ui.card}><div className={ui.stat}><span className={ui.statLabel}>{l}</span><span className={ui.statValue}>{v}</span></div></div>
        ))}
      </section>
      <div className={ui.grid3}>
        <section className={ui.card} aria-labelledby="contacto">
          <div className={ui.cardHeader}><h2 id="contacto">Contacto</h2></div>
          <p>{c.phone ? <a href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`}>{c.phone}</a> : "Sin teléfono"}</p>
          <p className={ui.muted}>{c.email ?? "Sin email"}</p>
          <p className={ui.faint}>Cliente desde {formatLocalDateTime(c.createdAt, tz)}</p>
          {hasPermission(access.role, "booking.manage") ? (
            <ActionForm action={saveCustomerNotesAction.bind(null, slug, c.id)} submitLabel="Guardar observaciones" variant="secondary" className={ui.stack}>
              <label className={ui.field}>
                <span className={ui.label}>Observaciones internas</span>
                <textarea className={ui.textarea} name="notes" maxLength={2000} defaultValue={c.notes ?? ""} placeholder="Preferencias, avisos… (no las ve el cliente)" />
              </label>
            </ActionForm>
          ) : c.notes ? <p>{c.notes}</p> : null}
        </section>
        <section className={ui.card} style={{ gridColumn: "span 2" }} aria-labelledby="historial">
          <div className={ui.cardHeader}><h2 id="historial">Historial de reservas</h2></div>
          {bookings.length === 0 ? <p className={ui.empty}>Sin reservas.</p> : (
            <div className={ui.tableWrap}>
              <table className={`${ui.table} ${ui.tableResponsive}`}>
                <thead><tr><th>Turno</th><th>Cancha</th><th>Importe</th><th>Estado</th></tr></thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr key={b.id}>
                      <td><Link href={`/panel/${slug}/reservas/${b.id}`}>{formatLocalDateTime(b.startsAt, tz)}</Link><div className={ui.faint}>{b.durationMinutes} min · {b.code}</div></td>
                      <td>{b.court.name}</td>
                      <td>{formatMoney(b.priceAmount, b.currency)}</td>
                      <td><span className={`${ui.badge} ${ui[`badge${b.status}`] ?? ""}`}>{STATUS_LABEL[b.status]}</span>{b.cancelReason ? <div className={ui.faint}>{b.cancelReason}</div> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
