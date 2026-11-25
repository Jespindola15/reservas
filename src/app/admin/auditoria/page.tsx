import type { Metadata } from "next";
import { ACTION_FILTERS, ACTOR_LABEL, ENTITY_LABEL, actionLabel } from "@/lib/audit-labels";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import Link from "next/link";
import ui from "@/components/ui.module.css";
import { requireSuperadminPage } from "@/lib/auth/dal";
import { isAppError } from "@/lib/errors";
import { listAuditLogs } from "@/modules/platform/plans";
import { listTenantsForPlatform } from "@/modules/platform/service";

export const metadata: Metadata = { title: "Auditoría" };

type Search = { tenantId?: string; action?: string; actorType?: string; from?: string; to?: string; before?: string };
const ACTOR = ACTOR_LABEL;

/** Detalle legible: solo datos conocidos, con nombre en castellano. Los ids y datos técnicos no se muestran. */
const META: Record<string, (v: unknown) => string | null> = {
  reason: (v) => `Motivo: ${String(v)}`,
  receivedAmount: (v) => (typeof v === "number" ? `Recibido: ${fmtMoney(v)}` : null),
  expectedAmount: (v) => (typeof v === "number" ? `Esperado: ${fmtMoney(v)}` : null),
  amount: (v) => (typeof v === "number" ? `Importe: ${fmtMoney(v)}` : null),
  difference: (v) => (typeof v === "number" && v !== 0 ? `Diferencia: ${fmtMoney(v)}` : null),
  kind: (v) => `Tipo: ${String(v).toLowerCase()}`,
  days: (v) => `Días: ${String(v)}`,
  newEnd: (v) => (typeof v === "string" ? `Nuevo vencimiento: ${fmtDate(new Date(v))}` : null),
  sessionsRevoked: (v) => `Sesiones cerradas: ${String(v)}`,
  count: (v) => `Cantidad: ${String(v)}`,
  futureBookings: (v) => `Reservas futuras: ${String(v)}`,
  name: (v) => `Nombre: ${String(v)}`,
  fields: (v) => (Array.isArray(v) ? `Campos: ${v.length}` : null),
  bankDataChanged: (v) => (v ? "Cambió los datos bancarios" : null),
  hasReference: (v) => (v ? "Con n.º de operación" : null),
};
function summarize(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "";
  return Object.entries(meta as Record<string, unknown>)
    .map(([k, v]) => META[k]?.(v) ?? null)
    .filter(Boolean)
    .slice(0, 5)
    .join(" · ")
    .slice(0, 220);
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireSuperadminPage("/admin/auditoria");
  const sp = await searchParams;
  const tenants = await listTenantsForPlatform(user);
  let result: Awaited<ReturnType<typeof listAuditLogs>> | null = null;
  let invalid = false;
  try {
    result = await listAuditLogs(user, sp);
  } catch (e) {
    if (!isAppError(e)) throw e;
    invalid = true;
  }
  const nextQs = result?.nextBefore ? new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string")), before: result.nextBefore }).toString() : null;

  return (
    <>
      <div className={ui.stack}>
        <header className={ui.pageHeader}><div><p className={ui.eyebrow}>Seguridad</p><h1>Auditoría</h1></div></header>
        <form className={`${ui.card} ${ui.grid3}`} method="get" role="search" aria-label="Filtros de auditoría">
          <label className={ui.field}><span className={ui.label}>Complejo</span>
            <select className={ui.select} name="tenantId" defaultValue={sp.tenantId ?? ""}>
              <option value="">Todos</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className={ui.field}><span className={ui.label}>Tipo de acción</span>
            <select className={ui.select} name="action" defaultValue={sp.action ?? ""}>
              {ACTION_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          <label className={ui.field}><span className={ui.label}>Origen</span>
            <select className={ui.select} name="actorType" defaultValue={sp.actorType ?? ""}>
              <option value="">Todos</option>{Object.entries(ACTOR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className={ui.field}><span className={ui.label}>Desde</span><input className={ui.input} type="date" name="from" defaultValue={sp.from ?? ""} /></label>
          <label className={ui.field}><span className={ui.label}>Hasta</span><input className={ui.input} type="date" name="to" defaultValue={sp.to ?? ""} /></label>
          <div className={ui.row} style={{ alignItems: "end" }}>
            <button className={ui.button} type="submit">Filtrar</button>
            <Link className={`${ui.button} ${ui.buttonGhost}`} href="/admin/auditoria">Limpiar</Link>
          </div>
        </form>
        {invalid ? <p className={`${ui.alert} ${ui.alertError}`}>Algún filtro no es válido.</p> : null}
        {result && result.rows.length === 0 ? <p className={ui.muted}>No hay eventos con esos filtros.</p> : null}
        {result && result.rows.length ? (
          <div className={`${ui.card} ${ui.tableWrap}`}>
            <table className={`${ui.table} ${ui.tableResponsive}`}>
              <thead><tr><th>Fecha</th><th>Complejo</th><th>Acción</th><th>Quién</th><th>Detalle</th></tr></thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.createdAt)}</td>
                    <td data-label="Complejo">{r.tenant ? `/${r.tenant.slug}` : <span className={ui.faint}>plataforma</span>}</td>
                    <td data-label="Acción"><strong>{actionLabel(r.action)}</strong><div className={ui.faint}>{ENTITY_LABEL[r.entityType] ?? "Registro"}</div></td>
                    <td data-label="Quién">{ACTOR[r.actorType] ?? r.actorType}<div className={ui.faint}>{r.actorEmail ?? ""}</div></td>
                    <td data-label="Detalle" className={ui.faint} style={{ maxWidth: 360, overflowWrap: "anywhere" }}>{summarize(r.metadata)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {nextQs ? <p style={{ marginTop: "1rem" }}><Link className={`${ui.button} ${ui.buttonSecondary}`} href={`/admin/auditoria?${nextQs}`}>Ver más antiguos</Link></p> : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
