import type { Metadata } from "next";
import { fmtDateTime } from "@/lib/format";
import { Icon } from "@/components/shell/icons";
import ui from "@/components/ui.module.css";
import { requireSuperadminPage } from "@/lib/auth/dal";
import { getEnv } from "@/lib/env";
import { withPlatformAdmin } from "@/lib/db/tenant-context";
import { platformOverview } from "@/modules/platform/billing";
import { imageStorageReachable, imageStorageUsage } from "@/lib/storage/usage";

/** Nombres legibles de las tareas programadas (el nombre técnico queda solo en los registros). */
const JOB_LABEL: Record<string, string> = {
  tick: "Tarea general (cada 30 min)",
  expire_pending: "Vencimiento de reservas sin confirmar",
  transfer_review_alerts: "Avisos de transferencias por revisar",
  schedule_notifications: "Programación de recordatorios",
  send_notifications: "Envío de emails",
  cleanup: "Limpieza de datos temporales",
};

export const metadata: Metadata = { title: "Sistema y alertas" };
const when = (d: Date | null) => (d ? fmtDateTime(d) : "nunca");

/** Infraestructura, alertas y configuración de integraciones (solo lectura, sin secretos). */
export default async function SystemPage() {
  const user = await requireSuperadminPage("/admin/sistema");
  const now = new Date();
  const o = await platformOverview(user, now);
  const env = getEnv();
  const queue = await withPlatformAdmin(user.id, async (tx) => {
    const [pending, failed] = await Promise.all([
      tx.notification.count({ where: { status: "PENDING" } }),
      tx.notification.count({ where: { status: "FAILED" } }),
    ]);
    return { pending, failed };
  });
  const pct = Math.round((o.system.dbBytes / o.system.dbLimitBytes) * 100);
  const [images, reachable] = await Promise.all([withPlatformAdmin(user.id, (tx) => imageStorageUsage(tx)), imageStorageReachable()]);
  const config = [
    { name: "Emails (Resend)", ok: o.system.emailProvider === "resend", detail: o.system.emailProvider === "resend" ? "Configurado" : `Modo ${o.system.emailProvider}: no se envían emails; los avisos internos funcionan igual.` },
    {
      name: "Imágenes en Supabase Storage",
      ok: env.IMAGE_STORAGE === "object" && Boolean(env.S3_BUCKET) && reachable !== false,
      detail: env.IMAGE_STORAGE !== "object"
        ? "Sin configurar: los complejos no pueden subir imágenes. Ver docs/IMAGENES.md"
        : reachable === false
          ? "No responde. Si el proyecto gratuito se pausó por inactividad, reactivalo desde el panel de Supabase (Restore project)."
          : `Bucket ${env.S3_BUCKET}${env.IMAGE_PUBLIC_BASE_URL ? " · lectura pública por CDN" : " · servidas a través de TURNUP"}`,
    },
    { name: "Secreto de tareas programadas", ok: Boolean(env.CRON_SECRET), detail: env.CRON_SECRET ? "Configurado" : "Falta CRON_SECRET" },
    { name: "Alertas por webhook", ok: Boolean(env.ALERT_WEBHOOK_URL), detail: env.ALERT_WEBHOOK_URL ? "Configurado" : "Opcional: sin configurar" },
    { name: "Respaldo semanal cifrado", ok: null, detail: "Se configura en GitHub Actions (docs/RESPALDOS.md); su estado se ve en la pestaña Actions del repositorio." },
  ];

  return (
    <div className={ui.stack}>
      <header className={ui.pageHeader}><div><p className={ui.eyebrow}>Operación</p><h1>Sistema y alertas</h1><p className={ui.muted}>Estado de la infraestructura y de las integraciones. No se muestran secretos.</p></div></header>

      <section className={ui.stats} aria-label="Infraestructura">
        <div className={`${ui.statTile} ${pct >= 70 ? ui.statTileAlert : ""}`}><span className={ui.statLabel}>Base de datos (Neon)</span><span className={ui.statValue}>{(o.system.dbBytes / 1048576).toFixed(1)} MB</span><span className={ui.statHint}>{pct}% de {Math.round(o.system.dbLimitBytes / 1048576)} MB del plan gratuito</span></div>
        <div className={ui.statTile}><span className={ui.statLabel}>Emails en cola</span><span className={ui.statValue}>{queue.pending}</span><span className={ui.statHint}>{o.system.emailProvider === "resend" ? "Se envían en la próxima tarea" : "Sin proveedor: no se envían"}</span></div>
        <div className={`${ui.statTile} ${queue.failed ? ui.statTileAlert : ""}`}><span className={ui.statLabel}>Emails fallidos</span><span className={ui.statValue}>{queue.failed}</span></div>
        <div className={`${ui.statTile} ${images.level !== "ok" ? ui.statTileAlert : ""}`}><span className={ui.statLabel}>Imágenes</span><span className={ui.statValue}>{(images.bytes / 1048576).toFixed(1)} MB</span><span className={ui.statHint}>{images.count} imágenes · {images.pct}% de {Math.round(images.quotaBytes / 1048576)} MB</span></div>
        <div className={ui.statTile}><span className={ui.statLabel}>Tareas programadas</span><span className={ui.statValue}>{o.system.jobs.filter((j) => !j.stale).length}/{o.system.jobs.length}</span><span className={ui.statHint}>al día</span></div>
      </section>

      <section aria-labelledby="tareas">
        <h2 id="tareas">Tareas programadas</h2>
        <p className={ui.faint} style={{ margin: "0 0 var(--sp-3)" }}>Netlify ejecuta la tarea general cada 30 minutos. Los vencimientos de reservas no dependen de ella: se aplican en el momento en que alguien consulta o reserva.</p>
        {o.system.jobs.length === 0 ? <p className={ui.muted}>Sin ejecuciones registradas.</p> : (
          <div className={ui.tableWrap}>
            <table className={`${ui.table} ${ui.tableResponsive}`}>
              <thead><tr><th>Tarea</th><th>Estado</th><th>Último éxito</th><th>Fallos seguidos</th></tr></thead>
              <tbody>
                {o.system.jobs.map((j) => (
                  <tr key={j.name}>
                    <td data-label="Tarea">{JOB_LABEL[j.name] ?? j.name}</td>
                    <td data-label="Estado">{j.stale ? <span className={`${ui.badge} ${ui.badgeCANCELLED}`}>Atrasada</span> : <span className={`${ui.badge} ${ui.badgeCONFIRMED}`}>OK</span>}</td>
                    <td data-label="Último éxito">{when(j.lastSuccessAt)}</td>
                    <td data-label="Fallos seguidos">{j.consecutiveFailures}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="config">
        <h2 id="config">Configuración de integraciones</h2>
        <ul className={ui.list}>
          {config.map((c) => (
            <li key={c.name} className={ui.listRow}>
              <Icon name={c.ok ? "check" : c.ok === false ? "alert" : "server"} />
              <span className={ui.listMain}><strong>{c.name}</strong><span className={ui.faint}>{c.detail}</span></span>
              {c.ok === null ? null : <span className={`${ui.badge} ${c.ok ? ui.badgeCONFIRMED : ui.badgePENDING}`}>{c.ok ? "Activo" : "Pendiente"}</span>}
            </li>
          ))}
        </ul>
      </section>
      <p className={ui.faint}>
        La transferencia de imágenes (egress) la mide Supabase: plan gratuito con 5 GB por mes más 5 GB servidos desde caché.
        Las imágenes se guardan con caché de un año y se cargan de forma diferida, así que cada visitante descarga cada una una sola vez.
        Para ver el consumo real: Supabase → tu proyecto → Usage.
      </p>
      <p className={ui.faint}>Generado {when(now)}.</p>
    </div>
  );
}
