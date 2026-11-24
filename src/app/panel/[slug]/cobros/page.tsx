import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { TransferPanel } from "@/components/transfer/TransferPanel";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { hasPermission } from "@/modules/access/authorize";
import { formatMoney } from "@/modules/booking/pricing";
import { amountDueFor, getPaymentSettings } from "@/modules/payments/transfers";
import { savePaymentSettingsAction } from "../transferencias/actions";

export const metadata: Metadata = { title: "Datos de cobro" };

const DEPOSIT_LABEL = { NONE: "Sin pago anticipado (se paga en el complejo)", FIXED: "Seña de importe fijo", PERCENT: "Seña en porcentaje del turno", FULL: "Total del turno por adelantado" } as const;

export default async function PaymentSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await requireTenantPage(slug, "payments.read");
  if (!access) notFound();
  const canEdit = hasPermission(access.role, "payments.configure");
  const { settings, tenant, configured } = await getPaymentSettings(access.ctx);
  const s = settings;
  const sample = 2_000_000; // turno de ejemplo de $20.000 para la vista previa
  const sampleDue = amountDueFor(sample, tenant.depositType, tenant.depositValue);
  const valueDefault = tenant.depositType === "FIXED" ? String(tenant.depositValue / 100) : tenant.depositType === "PERCENT" ? String(tenant.depositValue) : "";

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Cobros</p>
          <h1>Datos de cobro por transferencia</h1>
          <p className={ui.muted}>
            Los jugadores transfieren directo a tu cuenta. TURNUP no recibe, retiene ni intermedia dinero: vos verificás cada pago en tu banco y confirmás la reserva.
          </p>
        </div>
      </header>

      {tenant.depositType !== "NONE" && !configured ? (
        <p className={`${ui.alert} ${ui.alertError}`} role="alert">
          Pedís pago anticipado pero faltan los datos para transferir: las reservas online están bloqueadas hasta que los completes.
        </p>
      ) : null}
      {!canEdit ? <p className={`${ui.alert} ${ui.alertInfo}`}>Solo el dueño del complejo puede cambiar los datos bancarios. Si hay un error, avisale.</p> : null}

      <div className={ui.grid2} style={{ alignItems: "start" }}>
        <section className={ui.card} aria-labelledby="cfg">
          <h2 id="cfg">Configuración</h2>
          {canEdit ? (
            <ActionForm action={savePaymentSettingsAction.bind(null, slug)} submitLabel="Guardar datos de cobro" className={ui.stack}
              confirm={{ title: "¿Guardar los datos de cobro?", body: "Revisá el alias y el CBU/CVU: los jugadores van a transferir a esa cuenta. El cambio queda registrado.", confirmLabel: "Sí, guardar" }}>
              <label className={ui.field}>
                <span className={ui.label}>Pago anticipado</span>
                <select className={ui.select} name="depositType" defaultValue={tenant.depositType}>
                  {(Object.keys(DEPOSIT_LABEL) as (keyof typeof DEPOSIT_LABEL)[]).map((k) => <option key={k} value={k}>{DEPOSIT_LABEL[k]}</option>)}
                </select>
              </label>
              <label className={ui.field}>
                <span className={ui.label}>Valor de la seña</span>
                <input className={ui.input} name="depositValue" inputMode="decimal" defaultValue={valueDefault} placeholder="Pesos (fija) o % (porcentaje)" />
                <span className={ui.hint}>Seña fija: importe en pesos. Porcentaje: de 1 a 100. Para total o sin pago anticipado, dejalo vacío.</span>
              </label>
              <label className={ui.field}>
                <span className={ui.label}>Alias</span>
                <input className={ui.input} name="alias" defaultValue={s?.alias ?? ""} maxLength={20} autoComplete="off" placeholder="mi.complejo.mp" />
              </label>
              <label className={ui.field}>
                <span className={ui.label}>CBU / CVU</span>
                <input className={ui.input} name="cbuCvu" defaultValue={s?.cbuCvu ?? ""} maxLength={30} inputMode="numeric" autoComplete="off" />
                <span className={ui.hint}>22 números. Se valida el dígito verificador.</span>
              </label>
              <label className={ui.field}>
                <span className={ui.label}>Titular de la cuenta</span>
                <input className={ui.input} name="holderName" defaultValue={s?.holderName ?? ""} maxLength={80} autoComplete="off" />
              </label>
              <label className={ui.field}>
                <span className={ui.label}>Banco o billetera (opcional)</span>
                <input className={ui.input} name="bankName" defaultValue={s?.bankName ?? ""} maxLength={60} />
              </label>
              <div className={ui.grid2}>
                <label className={ui.field}>
                  <span className={ui.label}>Plazo para transferir (minutos)</span>
                  <input className={ui.input} name="transferWindowMinutes" type="number" min={10} max={1440} required defaultValue={s?.transferWindowMinutes ?? 30} />
                  <span className={ui.hint}>Si el jugador no informa el pago en ese plazo, el turno se libera.</span>
                </label>
                <label className={ui.field}>
                  <span className={ui.label}>Plazo para revisar (minutos)</span>
                  <input className={ui.input} name="reviewWindowMinutes" type="number" min={15} max={2880} required defaultValue={s?.reviewWindowMinutes ?? 180} />
                  <span className={ui.hint}>Tiempo que tenés para verificar una transferencia informada. Te avisamos antes de que venza.</span>
                </label>
              </div>
              <label className={ui.field}>
                <span className={ui.label}>Instrucciones para el jugador (opcional)</span>
                <textarea className={ui.textarea} name="instructions" defaultValue={s?.instructions ?? ""} maxLength={500} placeholder="Poné el código de reserva en el concepto." />
              </label>
            </ActionForm>
          ) : (
            <dl>
              <dt className={ui.label}>Pago anticipado</dt><dd>{DEPOSIT_LABEL[tenant.depositType as keyof typeof DEPOSIT_LABEL] ?? tenant.depositType}</dd>
              <dt className={ui.label}>Plazo para transferir</dt><dd>{s?.transferWindowMinutes ?? 30} min</dd>
              <dt className={ui.label}>Plazo para revisar</dt><dd>{s?.reviewWindowMinutes ?? 180} min</dd>
            </dl>
          )}
        </section>

        <section className={ui.card} aria-labelledby="prev">
          <h2 id="prev">Vista previa para el jugador</h2>
          {tenant.depositType === "NONE" ? (
            <p className={ui.muted}>Sin pago anticipado: el jugador reserva y paga en el complejo. No se muestran datos bancarios.</p>
          ) : configured && s && sampleDue ? (
            <>
              <p className={ui.faint}>Ejemplo con un turno de {formatMoney(sample, tenant.currency)}.</p>
              <TransferPanel transfer={s} amountDue={sampleDue} currency={tenant.currency} code="EJEMPLO1" deadline={null} reported={false} timezone="America/Argentina/Buenos_Aires" />
            </>
          ) : (
            <p className={ui.muted}>Completá alias o CBU/CVU y el titular para ver la vista previa.</p>
          )}
          {tenant.cancellationPolicy ? <p className={ui.faint}>Política de cancelación: {tenant.cancellationPolicy}</p> : null}
        </section>
      </div>
    </>
  );
}
