import type { Metadata } from "next";
import { fmtDate } from "@/lib/format";
import Link from "next/link";
import { Icon } from "@/components/shell/icons";
import ui from "@/components/ui.module.css";
import { requireSuperadminPage } from "@/lib/auth/dal";
import { formatMoney } from "@/modules/booking/pricing";
import { platformOverview, tenantActivity } from "@/modules/platform/billing";
import { listTenantsForPlatform } from "@/modules/platform/service";
import { withPlatformAdmin } from "@/lib/db/tenant-context";
import { imageStorageUsage } from "@/lib/storage/usage";

const SUB_LABEL: Record<string, string> = { TRIAL: "Prueba", ACTIVE: "Activa", PAST_DUE: "Vencida (en gracia)", SUSPENDED: "Suspendida", CANCELLED: "Cancelada" };
const day = (d: Date | null | undefined) => (d ? fmtDate(d) : "—");

export const metadata: Metadata = { title: "Superadministrador" };

export default async function AdminPage() {
  // 404 a quien no es superadmin (no revela que la ruta existe); sin 2FA, a configurarlo.
  const user = await requireSuperadminPage("/admin");
  const now = new Date();
  const [o, tenants, activity] = await Promise.all([platformOverview(user, now), listTenantsForPlatform(user), tenantActivity(user, now)]);

  const alerts: { tone: "warn" | "error" | "info"; text: string; href?: string }[] = [];
  for (const j of o.system.jobs.filter((j) => j.stale)) alerts.push({ tone: "error", text: `La tarea ${j.name} no tiene una ejecución exitosa hace más de 2 horas.`, href: "/admin/sistema" });
  if (o.system.dbBytes > o.system.dbLimitBytes * 0.7) alerts.push({ tone: "warn", text: `La base usa ${(o.system.dbBytes / 1048576).toFixed(0)} MB (más del 70 % del plan gratuito).`, href: "/admin/sistema" });
  if (o.expiringSoon) alerts.push({ tone: "warn", text: `${o.expiringSoon} suscripción(es) vencen en los próximos 7 días.`, href: "/admin/complejos?estado=prueba" });
  if (o.expired) alerts.push({ tone: "warn", text: `${o.expired} complejo(s) con la suscripción vencida.`, href: "/admin/complejos?estado=vencido" });
  const images = await withPlatformAdmin(user.id, (tx) => imageStorageUsage(tx));
  if (images.level !== "ok") alerts.push({ tone: images.level === "critical" ? "error" : "warn", text: `Las imágenes ocupan ${(images.bytes / 1048576).toFixed(0)} MB (${images.pct} % del almacenamiento gratuito).`, href: "/admin/sistema" });
  if (o.system.emailProvider !== "resend") alerts.push({ tone: "info", text: "Los emails no están activos: los avisos solo se ven dentro de TURNUP.", href: "/admin/sistema" });

  const attention = tenants.filter((t) => {
    const sub = t.subscriptions[0];
    return t.status !== "ACTIVE" || !sub || sub.currentPeriodEnd.getTime() - now.getTime() < 7 * 86_400_000;
  });

  return (
    <div className={ui.stack}>
      <header className={ui.pageHeader}>
        <div><p className={ui.eyebrow}>Superadministrador</p><h1>Plataforma</h1></div>
        <div className={ui.row}>
          <Link className={ui.button} href="/admin/complejos#nuevo"><Icon name="plus" />Nuevo complejo</Link>
          <Link className={`${ui.button} ${ui.buttonSecondary}`} href="/admin/planes#cobro"><Icon name="finance" />Registrar pago</Link>
        </div>
      </header>

      <section aria-labelledby="negocio">
        <h2 id="negocio">Ingresos de TURNUP</h2>
        <p className={ui.faint} style={{ margin: "0 0 var(--sp-3)" }}>Suscripciones de los complejos a TURNUP. El dinero de las reservas es de cada complejo y no se muestra acá.</p>
        <div className={ui.stats}>
          <div className={ui.statTile}><span className={ui.statLabel}>MRR registrado</span><span className={ui.statValue}>{formatMoney(o.mrr, "ARS")}</span><span className={ui.statHint}>Suscripciones activas vigentes</span></div>
          <div className={ui.statTile}><span className={ui.statLabel}>Cobrado (30 días)</span><span className={ui.statValue}>{formatMoney(o.collected30d, "ARS")}</span><span className={ui.statHint}>Pagos registrados a mano</span></div>
          <Link href="/admin/complejos?estado=prueba" className={ui.statTile}><span className={ui.statLabel}>En prueba</span><span className={ui.statValue}>{o.trial}</span><span className={ui.statHint}>{o.expiringSoon} vencen en 7 días</span></Link>
          <Link href="/admin/complejos?estado=vencido" className={`${ui.statTile} ${o.expired ? ui.statTileAlert : ""}`}><span className={ui.statLabel}>Vencidas</span><span className={ui.statValue}>{o.expired}</span><span className={ui.statHint}>{o.pastDue} en período de gracia</span></Link>
        </div>
      </section>

      <section aria-labelledby="uso">
        <h2 id="uso">Uso de la plataforma</h2>
        <div className={ui.stats}>
          <Link href="/admin/complejos" className={ui.statTile}><span className={ui.statLabel}>Complejos</span><span className={ui.statValue}>{o.tenants}</span><span className={ui.statHint}>{o.active} activos · {o.suspended} suspendidos</span></Link>
          <div className={ui.statTile}><span className={ui.statLabel}>Canchas activas</span><span className={ui.statValue}>{o.courts}</span></div>
          <div className={ui.statTile}><span className={ui.statLabel}>Reservas (30 días)</span><span className={ui.statValue}>{o.bookings30d}</span></div>
          <Link href="/admin/usuarios" className={ui.statTile}><span className={ui.statLabel}>Usuarios activos (30 días)</span><span className={ui.statValue}>{o.activeUsers30d}</span></Link>
        </div>
      </section>

      <section aria-labelledby="alertas">
        <h2 id="alertas">Alertas</h2>
        {alerts.length === 0 ? (
          <p className={`${ui.alert} ${ui.alertOk}`}><Icon name="check" />Sin alertas: tareas programadas al día y uso de base dentro del plan.</p>
        ) : (
          <div className={ui.stackSm}>
            {alerts.map((a) => (
              <Link key={a.text} href={a.href ?? "/admin/sistema"} className={`${ui.alert} ${a.tone === "error" ? ui.alertError : a.tone === "warn" ? ui.alertWarn : ui.alertInfo}`} style={{ textDecoration: "none" }}>
                <Icon name="alert" /><span style={{ flex: 1 }}>{a.text}</span><Icon name="chevron" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="complejos">
        <div className={ui.cardHeader}>
          <h2 id="complejos">Complejos que requieren atención</h2>
          <Link href="/admin/complejos" className={`${ui.button} ${ui.buttonGhost} ${ui.buttonSmall}`}>Ver todos<Icon name="chevron" size={16} /></Link>
        </div>
        {attention.length === 0 ? <p className={ui.muted}>Todos los complejos están activos y con la suscripción al día.</p> : (
          <div className={ui.tableWrap}>
            <table className={`${ui.table} ${ui.tableResponsive}`}>
              <thead><tr><th>Complejo</th><th>Estado</th><th>Suscripción</th><th>Actividad (30 días)</th></tr></thead>
              <tbody>
                {attention.map((t) => {
                  const sub = t.subscriptions[0];
                  return (
                    <tr key={t.id}>
                      <td data-label="Complejo"><Link href={`/admin/complejos/${t.id}`}>{t.name}</Link><span className={ui.cellSub}>/{t.slug}</span></td>
                      <td data-label="Estado"><span className={`${ui.badge} ${t.status === "ACTIVE" ? ui.badgeCONFIRMED : ui.badgeCANCELLED}`}>{t.archivedAt ? "Archivado" : t.status === "ACTIVE" ? "Activo" : "Suspendido"}</span></td>
                      <td data-label="Suscripción">{sub ? <>{sub.plan.name} · {SUB_LABEL[sub.status] ?? sub.status}<span className={sub.currentPeriodEnd < now ? ui.textDanger : ui.cellSub}> vence {day(sub.currentPeriodEnd)}</span></> : <span className={ui.faint}>Sin registrar</span>}</td>
                      <td data-label="Actividad">{activity.bookings30d.get(t.id) ?? 0} reservas<span className={ui.cellSub}>última {day(activity.lastBookingAt.get(t.id))}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
