import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/shell/icons";
import { StatusBadge } from "@/components/status/StatusBadge";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { whatsappLink } from "@/lib/contact/whatsapp";
import { formatLocalDateTime, formatLocalTime, localMidnight } from "@/modules/booking/time";
import { getDashboard } from "@/modules/dashboard/queries";
import { hasPermission } from "@/modules/access/authorize";
import { panelBadges } from "@/modules/inbox/service";
import { getOnboarding } from "@/modules/tenant/onboarding";
import { actionLabel } from "./labels";
import styles from "./dashboard.module.css";

export const metadata: Metadata = { title: "Hoy" };

export default async function DashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await requireTenantPage(slug, "booking.read");
  if (!access) notFound();
  const { tenant, user } = access;
  const tz = tenant.timezone;
  const [d, badges] = await Promise.all([getDashboard(access.ctx, tz), panelBadges(access.ctx)]);
  const label = localMidnight(d.today, tz)!.setLocale("es-AR").toFormat("cccc d 'de' LLLL");
  const base = `/panel/${slug}`;
  const onboarding = hasPermission(access.role, "tenant.settings") ? await getOnboarding(access.ctx) : null;
  const open = d.occupancy.filter((o) => o.pct !== null);
  const avgOcc = open.length ? Math.round(open.reduce((a, o) => a + (o.pct ?? 0), 0) / open.length) : null;
  const now = new Date();

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>{label}</p>
          <h1>Hola, {user.name.split(" ")[0]}</h1>
        </div>
        <div className={ui.row}>
          <Link href={`${base}/calendario?nueva=1`} className={ui.button}><Icon name="plus" />Nueva reserva</Link>
          <Link href={`${base}/horarios`} className={`${ui.button} ${ui.buttonSecondary}`}><Icon name="clock" />Bloquear horario</Link>
        </div>
      </header>

      <div className={ui.stack}>
        {badges.transfers > 0 ? (
          <Link href={`${base}/transferencias`} className={`${ui.alert} ${ui.alertWarn} ${styles.callout}`}>
            <Icon name="transfer" size={20} />
            <span><strong>{badges.transfers} transferencia{badges.transfers === 1 ? "" : "s"} por verificar.</strong> Revisá tu cuenta bancaria y confirmá o rechazá antes de que venza el plazo.</span>
            <Icon name="chevron" />
          </Link>
        ) : null}
        {badges.incidents > 0 ? (
          <Link href={`${base}/transferencias?estado=incidencias`} className={`${ui.alert} ${ui.alertError} ${styles.callout}`}>
            <Icon name="alert" size={20} />
            <span><strong>{badges.incidents} incidencia{badges.incidents === 1 ? "" : "s"} de pago sin resolver.</strong> Pagos tardíos, de más, de menos o de reservas rechazadas: registrá cómo se resolvió cada una.</span>
            <Icon name="chevron" />
          </Link>
        ) : null}
        {d.totals.pendingUpcoming > 0 ? (
          <Link href={`${base}/reservas?status=PENDING`} className={`${ui.alert} ${ui.alertInfo} ${styles.callout}`}>
            <Icon name="tasks" size={20} />
            <span><strong>{d.totals.pendingUpcoming} solicitud{d.totals.pendingUpcoming === 1 ? "" : "es"} pendiente{d.totals.pendingUpcoming === 1 ? "" : "s"}.</strong> Si no las aprobás a tiempo, vencen solas y el turno se libera.</span>
            <Icon name="chevron" />
          </Link>
        ) : null}
        {onboarding && !onboarding.finished ? (
          <Link href={`${base}/bienvenida`} className={`${ui.alert} ${styles.callout}`}>
            <Icon name="tasks" size={20} />
            <span><strong>Puesta en marcha: {onboarding.completed} de 7 pasos.</strong> Siguiente: {onboarding.steps.find((s) => s.n === onboarding.current)?.title}.</span>
            <Icon name="chevron" />
          </Link>
        ) : null}

        <section className={ui.stats} aria-label="Indicadores de hoy">
          <Link href={`${base}/calendario`} className={ui.statTile}>
            <span className={ui.statLabel}>Turnos hoy</span>
            <span className={ui.statValue}>{d.totals.today}</span>
            <span className={ui.statHint}>{d.totals.confirmedToday} confirmados · {d.totals.pendingToday} pendientes</span>
          </Link>
          <Link href={`${base}/transferencias`} className={`${ui.statTile} ${badges.transfers ? ui.statTileAlert : ""}`}>
            <span className={ui.statLabel}>Por verificar</span>
            <span className={ui.statValue}>{badges.transfers}</span>
            <span className={ui.statHint}>Transferencias informadas</span>
          </Link>
          <Link href={`${base}/reservas?status=PENDING`} className={ui.statTile}>
            <span className={ui.statLabel}>Pendientes</span>
            <span className={ui.statValue}>{d.totals.pendingUpcoming}</span>
            <span className={ui.statHint}>{d.totals.expired7d} vencidas en 7 días</span>
          </Link>
          <Link href={`${base}/estadisticas`} className={ui.statTile}>
            <span className={ui.statLabel}>Ocupación hoy</span>
            <span className={ui.statValue}>{avgOcc === null ? "—" : `${avgOcc}%`}</span>
            <span className={ui.statHint}>Promedio de canchas abiertas</span>
          </Link>
        </section>

        <div className={ui.split}>
          <section aria-labelledby="agenda">
            <div className={ui.cardHeader}>
              <h2 id="agenda">Agenda de hoy</h2>
              <Link href={`${base}/calendario`} className={`${ui.button} ${ui.buttonGhost} ${ui.buttonSmall}`}>Ver calendario<Icon name="chevron" size={16} /></Link>
            </div>
            {d.agenda.length === 0 ? (
              <div className={ui.empty}><Icon name="calendar" size={28} /><span>No hay turnos para hoy.</span></div>
            ) : (
              <ul className={ui.list}>
                {d.agenda.map((b) => {
                  const wa = whatsappLink(b.customerPhone, `Hola ${b.customerName.split(" ")[0]}, te escribimos de ${tenant.name} por tu turno de hoy a las ${formatLocalTime(b.startsAt, tz)}.`);
                  const past = b.endsAt < now;
                  return (
                    <li key={b.id} className={`${ui.listRow} ${past ? styles.past : ""}`}>
                      <Link href={`${base}/reservas/${b.id}`} className={styles.agendaLink}>
                        <span className={styles.time}>{formatLocalTime(b.startsAt, tz)}<small>{formatLocalTime(b.endsAt, tz)}</small></span>
                        <span className={ui.listMain}>
                          <strong>{b.customerName}</strong>
                          <span className={ui.faint}>{b.court.name} · {b.code}</span>
                        </span>
                      </Link>
                      <StatusBadge status={b.status} paymentStatus={b.paymentStatus} />
                      {wa ? <a className={ui.iconButton} href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp a ${b.customerName}`}><Icon name="chat" /></a> : null}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className={ui.cardHeader} style={{ marginTop: "var(--sp-8)" }}>
              <h2 id="proximos">Próximos días</h2>
              <Link href={`${base}/reservas`} className={`${ui.button} ${ui.buttonGhost} ${ui.buttonSmall}`}>Todas las reservas<Icon name="chevron" size={16} /></Link>
            </div>
            {d.upcoming.length === 0 ? (
              <div className={ui.empty}><span>No hay reservas en los próximos días.</span></div>
            ) : (
              <ul className={ui.list} aria-labelledby="proximos">
                {d.upcoming.map((b) => (
                  <li key={b.id}>
                    <Link href={`${base}/reservas/${b.id}`} className={ui.listRow}>
                      <span className={ui.listMain}>
                        <strong>{b.customerName}</strong>
                        <span className={ui.faint}>{formatLocalDateTime(b.startsAt, tz)} · {b.court.name}</span>
                      </span>
                      <StatusBadge status={b.status} paymentStatus={b.paymentStatus} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside className={ui.stack}>
            <section className={ui.card} aria-labelledby="ocupacion">
              <div className={ui.cardHeader}><h2 id="ocupacion">Ocupación por cancha</h2></div>
              {d.occupancy.length === 0 ? <p className={ui.muted}>No hay canchas activas.</p> : (
                <ul className={styles.occList}>
                  {d.occupancy.map((o) => (
                    <li key={o.id}>
                      <div className={ui.spread}><span>{o.name}</span><span className={ui.faint}>{o.pct === null ? "Cerrada" : `${o.pct}% · ${Math.round((o.bookedMinutes / 60) * 10) / 10} de ${Math.round((o.openMinutes / 60) * 10) / 10} h`}</span></div>
                      <div className={styles.bar} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={o.pct ?? 0} aria-label={`Ocupación ${o.name}`}><span style={{ width: `${o.pct ?? 0}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className={ui.card} aria-labelledby="actividad">
              <div className={ui.cardHeader}><h2 id="actividad">Actividad reciente</h2></div>
              {d.activity.length === 0 ? <p className={ui.muted}>Sin actividad todavía.</p> : (
                <ul className={styles.activity}>
                  {d.activity.map((a) => (
                    <li key={a.id}>
                      <Link href={`${base}/reservas/${a.entityId}`}>{actionLabel(a.action)}</Link>
                      <span className={ui.faint}>{a.actorType === "PUBLIC" ? "Jugador" : a.actorType === "SYSTEM" ? "Sistema" : "Equipo"} · {formatLocalDateTime(a.createdAt, tz)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
        <p className={ui.faint}>TURNUP no cobra ni recibe dinero: las señas por transferencia van directo a tu cuenta y vos las verificás.</p>
      </div>
    </>
  );
}
