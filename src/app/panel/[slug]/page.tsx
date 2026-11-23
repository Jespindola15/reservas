import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { TopBar } from "@/components/TopBar";
import ui from "@/components/ui.module.css";
import { requireUserPage } from "@/lib/auth/dal";
import { isAppError } from "@/lib/errors";
import { authorizeTenantAccess, hasPermission } from "@/modules/access/authorize";
import { formatMoney } from "@/modules/booking/pricing";
import { countPendingBookings, getDayBoard } from "@/modules/booking/queries";
import { formatLocalTime, localMidnight, todayIn } from "@/modules/booking/time";
import { SignOutButton } from "../SignOutButton";
import {
  cancelBookingAction,
  confirmBookingAction,
  createBlockAction,
  createManualBookingAction,
  deleteBlockAction,
  rejectBookingAction,
} from "./actions";
import styles from "./panel.module.css";

export const metadata: Metadata = { title: "Panel del complejo" };

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
  REJECTED: "Rechazada",
  COMPLETED: "Jugada",
  NO_SHOW: "No se presentó",
};

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ date?: string }> };

export default async function PanelPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { date: dateParam } = await searchParams;
  const user = await requireUserPage(`/panel/${slug}`);

  let access;
  try {
    access = await authorizeTenantAccess(user, slug, "booking.read");
  } catch (e) {
    if (isAppError(e) && (e.code === "FORBIDDEN" || e.code === "TENANT_NOT_FOUND")) notFound();
    if (isAppError(e) && e.code === "TENANT_SUSPENDED") redirect("/panel?suspended=1");
    throw e;
  }
  const { ctx, tenant, role } = access;
  const today = todayIn(tenant.timezone);
  const date = dateParam && localMidnight(dateParam, tenant.timezone) ? dateParam : today;
  const [board, pending] = await Promise.all([
    getDayBoard(ctx, date, tenant.timezone),
    countPendingBookings(ctx),
  ]);
  const courtName = new Map(board.courts.map((c) => [c.id, c.name]));
  const canBlock = hasPermission(role, "block.manage");
  const activeCourts = board.courts.filter((c) => c.isActive);
  const rawLabel = localMidnight(date, tenant.timezone)!.setLocale("es-AR").toFormat("cccc d 'de' LLLL");
  const dayLabel = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
  const shift = (days: number) => localMidnight(date, tenant.timezone)!.plus({ days }).toISODate();

  const confirmed = board.bookings.filter((b) => b.status === "CONFIRMED");
  const revenue = confirmed.reduce((acc, b) => acc + (b.priceAmount ?? 0), 0);

  return (
    <>
      <TopBar title={tenant.name}>
        <span className={ui.muted}>{user.name}</span>
        <Link href={`/${tenant.slug}`} className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`}>
          Ver página pública
        </Link>
        <SignOutButton />
      </TopBar>
      <main className={`${ui.container} ${ui.page}`}>
        <div className={ui.pageHeader}>
          <div>
            <p className={ui.muted}>{tenant.name}</p>
            <h1>{dayLabel}</h1>
          </div>
          <nav className={ui.row} aria-label="Cambiar día">
            <Link className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} href={`?date=${shift(-1)}`}>← Anterior</Link>
            <Link className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} href={`?date=${today}`}>Hoy</Link>
            <Link className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} href={`?date=${shift(1)}`}>Siguiente →</Link>
          </nav>
        </div>

        <section className={styles.stats} aria-label="Resumen del día">
          <div className={ui.card}><div className={ui.stat}><span className={ui.muted}>Reservas confirmadas</span><span className={ui.statValue}>{confirmed.length}</span></div></div>
          <div className={ui.card}><div className={ui.stat}><span className={ui.muted}>Pendientes de aprobar</span><span className={ui.statValue}>{pending}</span></div></div>
          <div className={ui.card}><div className={ui.stat}><span className={ui.muted}>Facturación estimada</span><span className={ui.statValue}>{formatMoney(revenue, tenant.currency)}</span></div></div>
        </section>

        <div className={styles.columns}>
          <section className={ui.card} aria-labelledby="reservas">
            <h2 id="reservas">Reservas del día</h2>
            {board.bookings.length === 0 ? (
              <p className={ui.muted}>No hay reservas para este día.</p>
            ) : (
              <table className={ui.table}>
                <thead>
                  <tr><th>Horario</th><th>Cancha</th><th>Cliente</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr>
                </thead>
                <tbody>
                  {board.bookings.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <strong>{formatLocalTime(b.startsAt, tenant.timezone)}–{formatLocalTime(b.endsAt, tenant.timezone)}</strong>
                        <div className={ui.muted}>{b.durationMinutes} min · {formatMoney(b.priceAmount, b.currency)}</div>
                      </td>
                      <td>{courtName.get(b.courtId)}</td>
                      <td>
                        {b.customerName}
                        <div className={ui.muted}>{b.customerPhone}{b.customerEmail ? ` · ${b.customerEmail}` : ""}</div>
                        <div className={ui.muted}>Código {b.code} · {b.source === "ONLINE" ? "Online" : "Manual"}</div>
                      </td>
                      <td><span className={`${ui.badge} ${ui[`badge${b.status}`] ?? ""}`}>{STATUS_LABEL[b.status]}</span></td>
                      <td>
                        <div className={styles.actions}>
                          {b.status === "PENDING" ? (
                            <>
                              <ActionForm action={confirmBookingAction.bind(null, slug)} submitLabel="Confirmar" small>
                                <input type="hidden" name="bookingId" value={b.id} />
                                <input type="hidden" name="version" value={b.version} />
                              </ActionForm>
                              <ActionForm action={rejectBookingAction.bind(null, slug)} submitLabel="Rechazar" variant="danger" small confirmMessage="¿Rechazar esta solicitud?">
                                <input type="hidden" name="bookingId" value={b.id} />
                                <input type="hidden" name="version" value={b.version} />
                              </ActionForm>
                            </>
                          ) : null}
                          {b.status === "CONFIRMED" ? (
                            <ActionForm action={cancelBookingAction.bind(null, slug)} submitLabel="Cancelar" variant="danger" small confirmMessage="¿Cancelar la reserva? El turno quedará libre.">
                              <input type="hidden" name="bookingId" value={b.id} />
                              <input type="hidden" name="version" value={b.version} />
                            </ActionForm>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {board.blocks.length > 0 ? (
              <>
                <h3 style={{ marginTop: "1.5rem" }}>Bloqueos</h3>
                <ul className={styles.blockList}>
                  {board.blocks.map((bl) => (
                    <li key={bl.id}>
                      <span>
                        <strong>{courtName.get(bl.courtId)}</strong> · {formatLocalTime(bl.startsAt, tenant.timezone)}–
                        {formatLocalTime(bl.endsAt, tenant.timezone)} · {bl.reason}
                      </span>
                      {canBlock ? (
                        <ActionForm action={deleteBlockAction.bind(null, slug)} submitLabel="Quitar" variant="secondary" small>
                          <input type="hidden" name="blockId" value={bl.id} />
                        </ActionForm>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          <aside className={ui.stack}>
            <section className={ui.card} aria-labelledby="manual">
              <h2 id="manual">Reserva manual</h2>
              <ManualBookingForm slug={slug} date={date} courts={activeCourts} />
            </section>
            {canBlock ? (
              <section className={ui.card} aria-labelledby="bloquear">
                <h2 id="bloquear">Bloquear horario</h2>
                <ActionForm key={`block-${date}`} action={createBlockAction.bind(null, slug)} submitLabel="Bloquear" className={ui.stack}>
                  <CourtSelect courts={activeCourts} />
                  <input type="hidden" name="date" value={date} />
                  <div className={ui.grid2}>
                    <Field label="Desde" name="from" type="time" required />
                    <Field label="Hasta" name="to" type="time" required />
                  </div>
                  <Field label="Motivo" name="reason" placeholder="Mantenimiento" required minLength={2} maxLength={200} />
                </ActionForm>
              </section>
            ) : null}
          </aside>
        </div>
      </main>
    </>
  );
}

function ManualBookingForm(props: { slug: string; date: string; courts: { id: string; name: string; allowedDurations: number[] }[] }) {
  const key = randomUUID();
  const durations = [...new Set(props.courts.flatMap((c) => c.allowedDurations))].sort((a, b) => a - b);
  return (
    <ActionForm key={key} action={createManualBookingAction.bind(null, props.slug)} submitLabel="Registrar reserva" className={ui.stack}>
      <input type="hidden" name="idempotencyKey" value={key} />
      <input type="hidden" name="date" value={props.date} />
      <CourtSelect courts={props.courts} />
      <div className={ui.grid2}>
        <Field label="Hora de inicio" name="time" type="time" required />
        <div className={ui.field}>
          <label className={ui.label} htmlFor="durationMinutes">Duración</label>
          <select className={ui.select} id="durationMinutes" name="durationMinutes" defaultValue={durations.includes(90) ? 90 : durations[0]}>
            {durations.map((d) => <option key={d} value={d}>{d} min</option>)}
          </select>
        </div>
      </div>
      <Field label="Nombre del cliente" name="name" required minLength={2} maxLength={80} />
      <Field label="Teléfono" name="phone" type="tel" required minLength={6} maxLength={30} />
      <Field label="Email (opcional)" name="email" type="email" maxLength={254} />
    </ActionForm>
  );
}

function CourtSelect({ courts }: { courts: { id: string; name: string }[] }) {
  return (
    <div className={ui.field}>
      <label className={ui.label} htmlFor="courtId">Cancha</label>
      <select className={ui.select} id="courtId" name="courtId" required>
        {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  );
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  const { label, ...rest } = props;
  return (
    <div className={ui.field}>
      <label className={ui.label} htmlFor={rest.name}>{label}</label>
      <input className={ui.input} id={rest.name} {...rest} />
    </div>
  );
}
