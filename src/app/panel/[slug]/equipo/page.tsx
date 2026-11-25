import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { formatLocalDateTime } from "@/modules/booking/time";
import { canManage, listTeam } from "@/modules/team/service";
import { inviteMemberAction, revokeInvitationAction, updateMemberAction } from "../config-actions";

export const metadata: Metadata = { title: "Equipo" };
const ROLE: Record<string, string> = { OWNER: "Dueño", ADMIN: "Administrador", STAFF: "Personal" };

export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await requireTenantPage(slug, "team.manage");
  if (!access) notFound();
  const { members, invitations } = await listTeam(access.ctx);
  const tz = access.tenant.timezone;
  const me = access.user.id;

  return (
    <>
      <header className={ui.pageHeader}>
        <div><p className={ui.eyebrow}>Configuración</p><h1>Equipo</h1></div>
      </header>
      <p className={`${ui.alert} ${ui.alertInfo}`} style={{ marginBottom: "1rem" }}>
        Dueños gestionan administradores y personal. Administradores gestionan solo personal. Nadie puede cambiar sus propios permisos.
      </p>
      <div className={ui.grid3}>
        <section className={ui.card} style={{ gridColumn: "span 2" }} aria-labelledby="miembros">
          <div className={ui.cardHeader}><h2 id="miembros">Miembros</h2></div>
          <div className={ui.tableWrap}>
            <table className={`${ui.table} ${ui.tableResponsive}`}>
              <thead><tr><th>Persona</th><th>Rol</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                {members.map((m) => {
                  const editable = m.userId !== me && canManage(access.role, m.role);
                  return (
                    <tr key={m.id}>
                      <td><strong>{m.user.name}</strong><div className={ui.faint}>{m.user.email}</div></td>
                      <td data-label="Rol">{ROLE[m.role]}</td>
                      <td data-label="Estado"><span className={`${ui.badge} ${m.isActive ? ui.badgeCONFIRMED : ui.badgeEXPIRED}`}>{m.isActive ? "Activo" : "Sin acceso"}</span></td>
                      <td data-label="Acciones">
                        {editable ? (
                          <div className={ui.row}>
                            {access.role === "OWNER" ? (
                              <ActionForm action={updateMemberAction.bind(null, slug, m.id)} submitLabel={m.role === "ADMIN" ? "Pasar a personal" : "Hacer administrador"} variant="secondary" small quietSuccess>
                                <input type="hidden" name="role" value={m.role === "ADMIN" ? "STAFF" : "ADMIN"} />
                              </ActionForm>
                            ) : null}
                            <ActionForm
                              action={updateMemberAction.bind(null, slug, m.id)}
                              submitLabel={m.isActive ? "Quitar acceso" : "Reactivar"}
                              variant={m.isActive ? "danger" : "secondary"}
                              small
                              quietSuccess
                              confirm={m.isActive ? { title: `¿Quitar el acceso a ${m.user.name}?`, body: "Se cierran sus sesiones. Su historial se conserva y podés reactivarlo." } : undefined}
                            >
                              <input type="hidden" name="isActive" value={m.isActive ? "false" : "true"} />
                            </ActionForm>
                          </div>
                        ) : <span className={ui.faint}>{m.userId === me ? "Vos" : "—"}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {invitations.length ? (
            <>
              <h3 style={{ marginTop: "1.25rem" }}>Invitaciones pendientes</h3>
              <ul className={ui.stackSm} style={{ listStyle: "none", padding: 0 }}>
                {invitations.map((i) => (
                  <li key={i.id} className={ui.spread}>
                    <span>{i.email} · {ROLE[i.role]}<div className={ui.faint}>Vence {formatLocalDateTime(i.expiresAt, tz)}</div></span>
                    {canManage(access.role, i.role) ? (
                      <ActionForm action={revokeInvitationAction.bind(null, slug, i.id)} submitLabel="Revocar" variant="ghost" small quietSuccess />
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
        <section className={ui.card} aria-labelledby="invitar">
          <div className={ui.cardHeader}><h2 id="invitar">Invitar</h2></div>
          <ActionForm action={inviteMemberAction.bind(null, slug)} submitLabel="Enviar invitación" className={ui.stack} resetOnSuccess>
            <label className={ui.field}><span className={ui.label}>Email</span><input className={ui.input} type="email" name="email" required maxLength={254} /></label>
            <label className={ui.field}>
              <span className={ui.label}>Rol</span>
              <select className={ui.select} name="role" defaultValue="STAFF">
                <option value="STAFF">Personal (reservas y calendario)</option>
                {access.role === "OWNER" ? <option value="ADMIN">Administrador (también canchas, precios y equipo)</option> : null}
              </select>
            </label>
            <p className={ui.hint}>Le llega un email con un enlace de un solo uso, válido por 7 días.</p>
          </ActionForm>
        </section>
      </div>
    </>
  );
}
