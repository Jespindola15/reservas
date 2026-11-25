import type { Metadata } from "next";
import { fmtDate } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { EditPanel } from "@/components/EditPanel";
import ui from "@/components/ui.module.css";
import { requireSuperadminPage } from "@/lib/auth/dal";
import { listPlans } from "@/modules/platform/plans";
import { listTenantsForPlatform } from "@/modules/platform/service";
import { formatMoney } from "@/modules/booking/pricing";
import { listSubscriptionPayments } from "@/modules/platform/billing";
import { assignSubscriptionAction, recordSubscriptionPaymentAction, savePlanAction } from "../actions";

const day = (d: Date | null | undefined) => (d ? fmtDate(d) : "—");

export const metadata: Metadata = { title: "Planes y suscripciones" };

type PlanRow = Awaited<ReturnType<typeof listPlans>>[number];

function PlanFields({ plan }: { plan?: PlanRow }) {
  return (
    <>
      <div className={ui.grid2}>
        <label className={ui.field}><span className={ui.label}>Nombre</span><input className={ui.input} name="name" required minLength={2} maxLength={60} defaultValue={plan?.name} /></label>
        <label className={ui.field}><span className={ui.label}>Código</span><input className={ui.input} name="code" required pattern="[a-z0-9][a-z0-9-]{1,30}" defaultValue={plan?.code} /></label>
        <label className={ui.field}><span className={ui.label}>Precio mensual (unidades enteras)</span><input className={ui.input} type="number" name="priceAmount" min={0} required defaultValue={plan?.priceAmount ?? 0} /></label>
        <label className={ui.field}><span className={ui.label}>Moneda</span><input className={ui.input} name="currency" pattern="[A-Z]{3}" defaultValue={plan?.currency ?? "ARS"} /></label>
        <label className={ui.field}><span className={ui.label}>Máx. canchas</span><input className={ui.input} type="number" name="maxCourts" min={1} defaultValue={plan?.maxCourts ?? ""} placeholder="Sin límite" /></label>
        <label className={ui.field}><span className={ui.label}>Máx. miembros (sin dueños)</span><input className={ui.input} type="number" name="maxMembers" min={1} defaultValue={plan?.maxMembers ?? ""} placeholder="Sin límite" /></label>
      </div>
      <label className={ui.field}><span className={ui.label}>Descripción</span><input className={ui.input} name="description" maxLength={300} defaultValue={plan?.description ?? ""} /></label>
      <label className={ui.checkbox}><input type="checkbox" name="isActive" defaultChecked={plan?.isActive ?? true} />Disponible para asignar</label>
    </>
  );
}

export default async function PlansPage() {
  const user = await requireSuperadminPage("/admin/planes");
  const plans = await listPlans(user);
  const tenants = await listTenantsForPlatform(user);
  const payments = await listSubscriptionPayments(user, 15);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const nextMonth = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);

  const assignForm = (
    <ActionForm action={assignSubscriptionAction} submitLabel="Asignar plan" className={ui.stack}>
              <div className={ui.grid2}>
                <label className={ui.field}><span className={ui.label}>Complejo</span>
                  <select className={ui.select} name="tenantId" required>{tenants.map((t) => <option key={t.id} value={t.id}>{t.name} (/{t.slug})</option>)}</select>
                </label>
                <label className={ui.field}><span className={ui.label}>Plan</span>
                  <select className={ui.select} name="planId" required>{plans.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                </label>
                <label className={ui.field}><span className={ui.label}>Estado</span>
                  <select className={ui.select} name="status" defaultValue="ACTIVE">
                    <option value="TRIAL">Prueba</option><option value="ACTIVE">Activa</option><option value="PAST_DUE">Pago atrasado</option><option value="SUSPENDED">Suspendida</option><option value="CANCELLED">Cancelada</option>
                  </select>
                </label>
                <label className={ui.field}><span className={ui.label}>Notas</span><input className={ui.input} name="notes" maxLength={300} /></label>
                <label className={ui.field}><span className={ui.label}>Desde</span><input className={ui.input} type="date" name="currentPeriodStart" required defaultValue={today} /></label>
                <label className={ui.field}><span className={ui.label}>Hasta</span><input className={ui.input} type="date" name="currentPeriodEnd" required defaultValue={nextMonth} /></label>
              </div>
              <p className={ui.hint}>La suscripción viva anterior pasa a “cancelada” y queda en el historial. Bajar de plan no borra canchas ni miembros: solo impide crear más.</p>
            </ActionForm>
  );
  const paymentForm = (
    <ActionForm action={recordSubscriptionPaymentAction} submitLabel="Registrar pago" className={ui.stack} resetOnSuccess>
              <label className={ui.field}><span className={ui.label}>Complejo</span>
                <select className={ui.select} name="tenantId" required>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <div className={ui.grid2}>
                <label className={ui.field}><span className={ui.label}>Importe ($)</span><input className={ui.input} name="amount" inputMode="decimal" required pattern="\d{1,9}([.,]\d{1,2})?" /></label>
                <label className={ui.field}><span className={ui.label}>Medio</span>
                  <select className={ui.select} name="method" defaultValue="TRANSFER">
                    <option value="TRANSFER">Transferencia</option><option value="CASH">Efectivo</option><option value="MERCADOPAGO_MANUAL">Mercado Pago (manual)</option><option value="CARD">Tarjeta (terminal)</option><option value="OTHER">Otro</option>
                  </select>
                </label>
                <label className={ui.field}><span className={ui.label}>Fecha de pago</span><input className={ui.input} type="date" name="paidAt" defaultValue={today} required /></label>
                <span />
                <label className={ui.field}><span className={ui.label}>Período desde</span><input className={ui.input} type="date" name="periodStart" required /></label>
                <label className={ui.field}><span className={ui.label}>Período hasta</span><input className={ui.input} type="date" name="periodEnd" required /></label>
              </div>
              <label className={ui.field}><span className={ui.label}>Nota (opcional)</span><input className={ui.input} name="note" maxLength={300} /></label>
              <label className={ui.checkbox}><input type="checkbox" name="extend" defaultChecked /> Activar la suscripción y extender el vencimiento hasta el fin del período</label>
            </ActionForm>
  );

  return (
    <>
      <div className={ui.stack}>
        <header className={ui.pageHeader}><div><p className={ui.eyebrow}>Comercial</p><h1>Planes y suscripciones</h1></div>
          <div className={ui.row}>
            <EditPanel label="Nuevo plan" title="Nuevo plan" variant="primary">
              <ActionForm action={savePlanAction.bind(null, null)} submitLabel="Crear plan" className={ui.stack} resetOnSuccess>
                <PlanFields />
              </ActionForm>
            </EditPanel>
            {plans.some((p) => p.isActive) && tenants.length ? (
              <EditPanel label="Asignar plan a un complejo" title="Asignar plan a un complejo">
                {assignForm}
              </EditPanel>
            ) : null}
            {tenants.length ? (
              <EditPanel label="Registrar pago" title="Registrar pago de suscripción" description="Pagos recibidos por fuera de TURNUP (transferencia, efectivo, link de pago). No se guardan datos de tarjetas.">
                {paymentForm}
              </EditPanel>
            ) : null}
          </div>
        </header>
        <p className={`${ui.alert} ${ui.alertInfo}`}>Los planes definen límites. No hay cobro automático: la suscripción es un registro administrativo.</p>
        {plans.length === 0 ? <p className={ui.muted}>Todavía no hay planes. Creá el primero con “Nuevo plan”.</p> : null}
        <div className={ui.grid2}>
          {plans.map((p) => (
            <section key={p.id} className={ui.card} aria-label={`Plan ${p.name}`}>
              <div className={ui.cardHeader}>
                <h2>{p.name}</h2>
                <span className={ui.muted}>{p._count.subscriptions} suscripciones{p.isActive ? "" : " · inactivo"}</span>
              </div>
              <p className={ui.muted} style={{ margin: 0 }}>{formatMoney(p.priceAmount, p.currency)} por mes · hasta {p.maxCourts ?? "∞"} canchas · {p.maxMembers ?? "∞"} miembros</p>
              <EditPanel label="Editar plan" title={`Editar plan ${p.name}`}>
                <ActionForm action={savePlanAction.bind(null, p.id)} submitLabel="Guardar" className={ui.stack}>
                  <PlanFields plan={p} />
                </ActionForm>
              </EditPanel>
            </section>
          ))}
        </div>

        <section className={ui.card} aria-labelledby="pagos">
            <h2 id="pagos">Últimos pagos registrados</h2>
            {payments.length === 0 ? <p className={ui.muted}>Todavía no hay pagos registrados.</p> : (
              <ul className={ui.stackSm} style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {payments.map((p) => (
                  <li key={p.id}><strong>{formatMoney(p.amount, p.currency)}</strong> · {p.tenant.name} · {day(p.paidAt)}<div className={ui.faint}>Período {day(p.periodStart)} al {day(p.periodEnd)}{p.note ? ` · ${p.note}` : ""}</div></li>
                ))}
              </ul>
            )}
        </section>
      </div>
    </>
  );
}
