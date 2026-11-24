import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { TopBar } from "@/components/TopBar";
import ui from "@/components/ui.module.css";
import { requireSuperadminPage } from "@/lib/auth/dal";
import { listPlans } from "@/modules/platform/plans";
import { listTenantsForPlatform } from "@/modules/platform/service";
import { SignOutButton } from "../../panel/SignOutButton";
import { assignSubscriptionAction, savePlanAction } from "../actions";
import { AdminNav } from "../AdminNav";

export const metadata: Metadata = { title: "Planes" };

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
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const nextMonth = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);

  return (
    <>
      <TopBar>
        <Link href="/panel" className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`}>Mis complejos</Link>
        <SignOutButton />
      </TopBar>
      <main className={`${ui.container} ${ui.page} ${ui.stack}`}>
        <div className={ui.spread}><h1>Planes</h1><AdminNav current="/admin/planes" /></div>
        <p className={`${ui.alert} ${ui.alertInfo}`}>Los planes definen límites. No hay cobro automático: la suscripción es un registro administrativo.</p>
        {plans.length === 0 ? <p className={ui.muted}>Todavía no hay planes. Creá el primero abajo.</p> : null}
        <div className={ui.grid2}>
          {plans.map((p) => (
            <section key={p.id} className={ui.card} aria-label={`Plan ${p.name}`}>
              <div className={ui.cardHeader}>
                <h2>{p.name}</h2>
                <span className={ui.muted}>{p._count.subscriptions} suscripciones{p.isActive ? "" : " · inactivo"}</span>
              </div>
              <ActionForm action={savePlanAction.bind(null, p.id)} submitLabel="Guardar" className={ui.stack} variant="secondary">
                <PlanFields plan={p} />
              </ActionForm>
            </section>
          ))}
          <section className={ui.card} aria-labelledby="nuevo-plan">
            <div className={ui.cardHeader}><h2 id="nuevo-plan">Nuevo plan</h2></div>
            <ActionForm action={savePlanAction.bind(null, null)} submitLabel="Crear plan" className={ui.stack} resetOnSuccess>
              <PlanFields />
            </ActionForm>
          </section>
        </div>

        <section className={ui.card} aria-labelledby="asignar-plan">
          <div className={ui.cardHeader}><h2 id="asignar-plan">Asignar plan a un complejo</h2></div>
          {plans.some((p) => p.isActive) && tenants.length ? (
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
          ) : <p className={ui.muted}>Necesitás al menos un plan activo y un complejo.</p>}
        </section>
      </main>
    </>
  );
}
