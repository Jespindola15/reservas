import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { formatLocalDateTime, formatLocalTime, localMidnight } from "@/modules/booking/time";
import { getDashboard } from "@/modules/dashboard/queries";
import { hasPermission } from "@/modules/access/authorize";
import { getOnboarding } from "@/modules/tenant/onboarding";
import { STATUS_LABEL, actionLabel } from "./labels";
import styles from "./dashboard.module.css";

export const metadata: Metadata = { title: "Inicio" };

export default async function DashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await requireTenantPage(slug, "booking.read");
  if (!access) notFound();
  const { tenant, user } = access;
  const d = await getDashboard(access.ctx, tenant.timezone);
  const label = localMidnight(d.today, tenant.timezone)!.setLocale("es-AR").toFormat("cccc d 'de' LLLL");
  const base = `/panel/${slug}`;
  const onboarding = hasPermission(access.role, "tenant.settings") ? await getOnboarding(access.ctx) : null;

  const stats = [
    { label: "Turnos hoy", value: d.totals.today, hint: "Pendientes y confirmados", href: `${base}/calendario` },
    { label: "Confirmadas hoy", value: d.totals.confirmedToday, hint: `${d.totals.cancelledToday} canceladas/rechazadas`, href: `${base}/reservas?status=CONFIRMED` },
    { label: "Pendientes de aprobar", value: d.totals.pendingUpcoming, hint: "Vencen solas si no se aprueban", href: `${base}/reservas?status=PENDING`, highlight: d.totals.pendingUpcoming > 0 },
    { label: "Vencidas (7 días)", value: d.totals.expired7d, hint: "Solicitudes no aprobadas a tiempo", href: `${base}/reservas?status=EXPIRED` },
  ];

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>{label.charAt(0).toUpperCase() + label.slice(1)}</p>
          <h1>Hola, {user.name.split(" ")[0]}</h1>
        </div>
        <div className={ui.row}>
          <Link href={`${base}/calendario?nueva=1`} className={ui.button}>+ Reserva manual</Link>
          <Link href={`${base}/calendario`} className={`${ui.button} ${ui.buttonSecondary}`}>Ver calendario</Link>
        </div>
      </header>

      {onboarding && !onboarding.finished ? (
        <section className={`${ui.alert} ${ui.alertInfo}`} style={{ marginBottom: "1rem" }} aria-label="Puesta en marcha">
          <strong>Puesta en marcha: {onboarding.completed} de 7 pasos.</strong>{" "}
          Siguiente: {onboarding.steps.find((s) => s.n === onboarding.current)?.title}.{" "}
          <Link href={`${base}/bienvenida`}>Continuar</Link>
        </section>
      ) : null}

      <section className={styles.stats} aria-label="Indicadores">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className={`${ui.card} ${styles.statCard} ${s.highlight ? styles.highlight : ""}`}>
            <div className={ui.stat}>
              <span className={ui.statLabel}>{s.label}</span>
              <span className={ui.statValue}>{s.value}</span>
              <span className={ui.statHint}>{s.hint}</span>
            </div>
          </Link>
        ))}
      </section>

      <div className={styles.columns}>
        <section className={ui.card} aria-labelledby="proximos">
          <div className={ui.cardHeader}>
            <h2 id="proximos">Próximos turnos</h2>
            <Link href={`${base}/reservas`} className={ui.muted}>Ver todas →</Link>
          </div>
          {d.upcoming.length === 0 ? (
            <p className={ui.empty}>No hay turnos próximos.</p>
          ) : (
            <ul className={styles.list}>
              {d.upcoming.map((b) => (
                <li key={b.id}>
                  <Link href={`${base}/reservas/${b.id}`} className={styles.listItem}>
                    <span className={styles.time}>{formatLocalTime(b.startsAt, tenant.timezone)}</span>
                    <span className={styles.listMain}>
                      <strong>{b.customerName}</strong>
                      <span className={ui.faint}>{b.court.name} · {formatLocalDateTime(b.startsAt, tenant.timezone)}</span>
                    </span>
                    <span className={`${ui.badge} ${ui[`badge${b.status}`] ?? ""}`}>{STATUS_LABEL[b.status]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className={ui.stack}>
          <section className={ui.card} aria-labelledby="ocupacion">
            <div className={ui.cardHeader}><h2 id="ocupacion">Ocupación de hoy</h2></div>
            {d.occupancy.length === 0 ? <p className={ui.muted}>No hay canchas activas.</p> : null}
            <ul className={styles.list}>
              {d.occupancy.map((o) => (
                <li key={o.id} className={styles.occ}>
                  <div className={ui.spread}>
                    <span>{o.name}</span>
                    <span className={ui.muted}>{o.pct === null ? "Cerrada" : `${o.pct}%`}</span>
                  </div>
                  <div className={styles.bar} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={o.pct ?? 0} aria-label={`Ocupación ${o.name}`}>
                    <span style={{ width: `${o.pct ?? 0}%` }} />
                  </div>
                  <span className={ui.faint}>{Math.round(o.bookedMinutes / 60 * 10) / 10} h reservadas de {Math.round(o.openMinutes / 60 * 10) / 10} h abiertas</span>
                </li>
              ))}
            </ul>
          </section>

          <section className={ui.card} aria-labelledby="actividad">
            <div className={ui.cardHeader}><h2 id="actividad">Actividad reciente</h2></div>
            {d.activity.length === 0 ? <p className={ui.muted}>Sin actividad todavía.</p> : null}
            <ul className={styles.activity}>
              {d.activity.map((a) => (
                <li key={a.id}>
                  <Link href={`${base}/reservas/${a.entityId}`}>{actionLabel(a.action)}</Link>
                  <span className={ui.faint}>
                    {a.actorType === "PUBLIC" ? "Jugador" : a.actorType === "SYSTEM" ? "Sistema" : "Equipo"} · {formatLocalDateTime(a.createdAt, tenant.timezone)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className={ui.card} aria-labelledby="accesos">
            <div className={ui.cardHeader}><h2 id="accesos">Accesos rápidos</h2></div>
            <div className={styles.quick}>
              <Link href={`${base}/reservas?status=PENDING`} className={`${ui.button} ${ui.buttonSecondary}`}>Aprobar pendientes</Link>
              <Link href={`${base}/clientes`} className={`${ui.button} ${ui.buttonSecondary}`}>Buscar cliente</Link>
              <Link href={`${base}/horarios`} className={`${ui.button} ${ui.buttonSecondary}`}>Bloquear horario</Link>
              <Link href={`${base}/canchas`} className={`${ui.button} ${ui.buttonSecondary}`}>Tarifas</Link>
            </div>
          </section>
        </div>
      </div>
      <p className={ui.faint} style={{ marginTop: "1rem" }}>TURNUP todavía no procesa pagos: los importes de las reservas son informativos y no implican cobro.</p>
    </>
  );
}
