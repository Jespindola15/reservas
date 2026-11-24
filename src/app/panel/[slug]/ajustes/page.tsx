import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { getTenantSettings } from "@/modules/tenant/settings";
import { updateSettingsAction } from "../config-actions";

export const metadata: Metadata = { title: "Ajustes" };

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await requireTenantPage(slug, "tenant.settings");
  if (!access) notFound();
  const s = await getTenantSettings(access.ctx);

  const num = (name: keyof typeof s, label: string, min: number, max: number, hint: string) => (
    <label className={ui.field}>
      <span className={ui.label}>{label}</span>
      <input className={ui.input} type="number" name={name} min={min} max={max} required defaultValue={String(s[name])} />
      <span className={ui.hint}>{hint}</span>
    </label>
  );

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Configuración</p>
          <h1>Ajustes del complejo</h1>
        </div>
      </header>
      <ActionForm action={updateSettingsAction.bind(null, slug)} submitLabel="Guardar ajustes" className={ui.stack}>
        <section className={ui.card}>
          <div className={ui.cardHeader}><h2>Datos públicos</h2><span className={ui.muted}>/{s.slug}</span></div>
          <div className={ui.grid2}>
            <label className={ui.field}><span className={ui.label}>Nombre</span><input className={ui.input} name="name" required minLength={2} maxLength={100} defaultValue={s.name} /></label>
            <label className={ui.field}><span className={ui.label}>Teléfono</span><input className={ui.input} name="contactPhone" maxLength={30} defaultValue={s.contactPhone ?? ""} /></label>
            <label className={ui.field}><span className={ui.label}>Email de contacto</span><input className={ui.input} type="email" name="contactEmail" maxLength={254} defaultValue={s.contactEmail ?? ""} /></label>
            <label className={ui.field}><span className={ui.label}>Dirección</span><input className={ui.input} name="address" maxLength={200} defaultValue={s.address ?? ""} /></label>
          </div>
          <label className={ui.field} style={{ marginTop: "0.9rem" }}>
            <span className={ui.label}>Descripción</span>
            <textarea className={ui.textarea} name="description" maxLength={600} defaultValue={s.description ?? ""} />
          </label>
        </section>
        <section className={ui.card}>
          <div className={ui.cardHeader}><h2>Reglas de reserva</h2><span className={ui.muted}>Zona horaria: {s.timezone}</span></div>
          <label className={ui.checkbox} style={{ marginBottom: "0.9rem" }}>
            <input type="checkbox" name="bookingRequiresApproval" defaultChecked={s.bookingRequiresApproval} />
            Las reservas online quedan pendientes hasta que las apruebe el complejo
          </label>
          <div className={ui.grid2}>
            {num("pendingExpirationMinutes", "Vencimiento de solicitudes pendientes (min)", 5, 1440, "Entre 5 min y 24 h. Al vencer, el turno se libera solo.")}
            {num("minLeadMinutes", "Anticipación mínima (min)", 0, 10080, "Cuánto antes del inicio se puede reservar online.")}
            {num("maxAdvanceDays", "Reservas con hasta (días) de anticipación", 1, 365, "Ventana hacia adelante del calendario público.")}
            {num("publicCancellationMinutes", "Cancelación online hasta (min antes)", 0, 10080, "Después de ese límite, el jugador debe llamar al complejo.")}
          </div>
        </section>
        <section className={ui.card}>
          <div className={ui.cardHeader}><h2>Notificaciones por email</h2></div>
          <div className={ui.stackSm} style={{ marginBottom: "0.9rem" }}>
            <label className={ui.checkbox}><input type="checkbox" name="notificationsEnabled" defaultChecked={s.notificationsEnabled} />Enviar notificaciones de este complejo</label>
            <label className={ui.checkbox}><input type="checkbox" name="notifyPlayers" defaultChecked={s.notifyPlayers} />A los jugadores: solicitud recibida, confirmación, cambios, cancelación y recordatorio</label>
            <label className={ui.checkbox}><input type="checkbox" name="notifyOwner" defaultChecked={s.notifyOwner} />Al complejo: nuevas reservas y cancelaciones online</label>
            <label className={ui.checkbox}><input type="checkbox" name="digestEnabled" defaultChecked={s.digestEnabled} />Resumen diario con los turnos de las próximas 24 h</label>
          </div>
          <div className={ui.grid2}>
            <label className={ui.field}><span className={ui.label}>Email que recibe los avisos</span><input className={ui.input} type="email" name="ownerNotificationEmail" maxLength={254} defaultValue={s.ownerNotificationEmail ?? ""} placeholder={s.contactEmail ?? ""} /><span className={ui.hint}>Si lo dejás vacío se usa el email de contacto.</span></label>
            {num("reminderHoursBefore", "Recordatorio al jugador (horas antes)", 0, 48, "0 desactiva el recordatorio.")}
            {num("digestHour", "Hora del resumen diario (0–23)", 0, 23, `Hora local (${s.timezone}).`)}
          </div>
          <p className={ui.hint} style={{ marginTop: "0.75rem" }}>Los emails se envían solo si el servidor tiene un proveedor configurado. Un turno cancelado o reprogramado nunca recibe un recordatorio viejo.</p>
        </section>
      </ActionForm>
    </>
  );
}
