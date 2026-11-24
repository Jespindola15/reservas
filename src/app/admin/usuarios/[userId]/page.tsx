import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { TopBar } from "@/components/TopBar";
import ui from "@/components/ui.module.css";
import { requireSuperadminPage } from "@/lib/auth/dal";
import { isAppError } from "@/lib/errors";
import { anonymizeImpact, getUserDetail } from "@/modules/platform/users";
import { SignOutButton } from "../../../panel/SignOutButton";
import { AdminNav } from "../../AdminNav";
import { anonymizeUserAction, passwordRecoveryAction, reactivateUserAction, renameUserAction, revokeSessionsAction, suspendUserAction } from "../../actions";

export const metadata: Metadata = { title: "Usuario · Superadministrador" };
const ROLE: Record<string, string> = { OWNER: "Dueño", ADMIN: "Administrador", STAFF: "Personal" };
const when = (d: Date) => d.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hourCycle: "h23", dateStyle: "short", timeStyle: "short" });

export default async function UserDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const me = await requireSuperadminPage(`/admin/usuarios/${userId}`);
  let d;
  try {
    d = await getUserDetail(me, userId);
  } catch (e) {
    if (isAppError(e) && (e.code === "NOT_FOUND" || e.code === "VALIDATION_ERROR")) notFound();
    throw e;
  }
  const u = d.user;
  const self = u.id === me.id;
  const impact = !u.anonymizedAt && !self ? await anonymizeImpact(me, userId) : null;

  return (
    <>
      <TopBar><SignOutButton /></TopBar>
      <main className={`${ui.container} ${ui.page} ${ui.stack}`}>
        <div className={ui.spread}><h1>{u.name}</h1><AdminNav current="/admin/usuarios" /></div>
        <Link href="/admin/usuarios" className={ui.faint}>← Volver a usuarios</Link>
        <div className={ui.grid2} style={{ alignItems: "start" }}>
          <section className={ui.card} aria-labelledby="datos">
            <h2 id="datos">Datos</h2>
            <dl className={ui.dl}>
              <dt>Email</dt><dd>{u.email} {u.emailVerified ? <span className={ui.faint}>(verificado)</span> : null}</dd>
              <dt>Rol de plataforma</dt><dd>{u.platformRole === "SUPERADMIN" ? "Superadministrador" : "Usuario"}{u.twoFactorEnabled ? " · 2FA activo" : ""}</dd>
              <dt>Estado</dt>
              <dd>{u.anonymizedAt ? `Eliminado el ${when(u.anonymizedAt)}` : u.isDisabled ? `Suspendido${u.suspendedAt ? ` el ${when(u.suspendedAt)}` : ""}${u.suspendedReason ? ` · ${u.suspendedReason}` : ""}` : "Activo"}</dd>
              <dt>Alta</dt><dd>{when(u.createdAt)}</dd>
              <dt>Última actividad</dt><dd>{d.lastSeenAt ? when(d.lastSeenAt) : "—"} · {d.sessions} sesión(es) abiertas</dd>
              <dt>Jugador</dt><dd>{u.playerProfile ? `Sí · ${d.bookingsTotal} reservas (${d.bookingsFuture} futuras)` : "No"}</dd>
            </dl>
            {!u.anonymizedAt ? (
              <ActionForm action={renameUserAction.bind(null, u.id)} submitLabel="Guardar nombre" small className={ui.row}>
                <input className={ui.input} name="name" defaultValue={u.name} minLength={2} maxLength={80} required aria-label="Nombre" style={{ maxWidth: 260 }} />
              </ActionForm>
            ) : null}
          </section>

          <section className={ui.card} aria-labelledby="mem">
            <h2 id="mem">Complejos</h2>
            {u.memberships.length === 0 ? <p className={ui.muted}>Sin accesos a complejos.</p> : (
              <ul className={ui.stackSm} style={{ paddingLeft: "1rem" }}>
                {u.memberships.map((m) => (
                  <li key={m.id}>{ROLE[m.role]} en <Link href={`/admin/complejos/${m.tenant.id}`}>{m.tenant.name}</Link>{m.isActive ? "" : " (inactivo)"}{m.tenant.status !== "ACTIVE" ? " · complejo suspendido" : ""}</li>
                ))}
              </ul>
            )}
            <h3>Actividad reciente</h3>
            {d.activity.length === 0 ? <p className={ui.muted}>Sin registros.</p> : (
              <ul className={ui.faint} style={{ paddingLeft: "1rem" }}>{d.activity.map((a) => <li key={a.id}>{when(a.createdAt)} · {a.action}</li>)}</ul>
            )}
          </section>
        </div>

        {!u.anonymizedAt && !self ? (
          <section className={ui.card} aria-labelledby="acc">
            <h2 id="acc">Acciones</h2>
            <div className={ui.stack}>
              {u.isDisabled ? (
                <ActionForm action={reactivateUserAction.bind(null, u.id)} submitLabel="Reactivar usuario" confirm={{ title: "¿Reactivar?", body: "Podrá volver a ingresar.", confirmLabel: "Reactivar" }} />
              ) : (
                <ActionForm action={suspendUserAction.bind(null, u.id)} submitLabel="Suspender usuario" variant="danger" className={ui.stack}
                  confirm={{ title: `¿Suspender a ${u.name}?`, body: "No podrá ingresar y se cerrarán todas sus sesiones ahora mismo. Sus datos se conservan.", confirmLabel: "Suspender" }}>
                  <label className={ui.field}><span className={ui.label}>Motivo (queda registrado)</span><input className={ui.input} name="reason" required minLength={5} maxLength={300} /></label>
                </ActionForm>
              )}
              <div className={ui.row}>
                <ActionForm action={revokeSessionsAction.bind(null, u.id)} submitLabel="Cerrar todas sus sesiones" variant="secondary" small />
                {!u.isDisabled ? <ActionForm action={passwordRecoveryAction.bind(null, u.id)} submitLabel="Enviar recuperación de contraseña" variant="secondary" small /> : null}
              </div>
              {impact ? (
                <details>
                  <summary style={{ cursor: "pointer", fontWeight: 700 }}>Eliminar cuenta (anonimizar)</summary>
                  <div className={ui.stack} style={{ marginTop: "0.75rem" }}>
                    <p className={ui.muted} style={{ margin: 0 }}>
                      Se borran nombre, email, contraseña, 2FA, sesiones, perfil de jugador, {impact.favorites} favorito(s) y {impact.memberships} acceso(s) a complejos.
                      Se conservan, desvinculadas, {impact.pastBookings} reserva(s) pasadas y sus pagos (historial de los complejos) y {impact.reviews} opinión(es) quedan como “Usuario eliminado”. No se puede deshacer.
                    </p>
                    {impact.blockers.length ? (
                      <ul className={`${ui.alert} ${ui.alertWarn}`} style={{ paddingLeft: "1.5rem" }}>{impact.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                    ) : u.platformRole === "SUPERADMIN" ? (
                      <p className={`${ui.alert} ${ui.alertWarn}`}>Un superadministrador no se elimina desde acá.</p>
                    ) : (
                      <ActionForm action={anonymizeUserAction.bind(null, u.id)} submitLabel="Eliminar definitivamente" variant="danger" className={ui.stack}
                        confirm={{ title: "¿Eliminar la cuenta?", body: "Es irreversible. Se anonimizan los datos personales.", confirmLabel: "Eliminar" }}>
                        <label className={ui.field}><span className={ui.label}>Escribí el email del usuario para confirmar</span><input className={ui.input} name="confirmEmail" required autoComplete="off" /></label>
                      </ActionForm>
                    )}
                  </div>
                </details>
              ) : null}
            </div>
          </section>
        ) : self ? <p className={ui.faint}>No podés suspender ni eliminar tu propia cuenta desde acá.</p> : null}
      </main>
    </>
  );
}
