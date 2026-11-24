import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { TopBar } from "@/components/TopBar";
import ui from "@/components/ui.module.css";
import { getCurrentUser } from "@/lib/auth/dal";
import { isAppError } from "@/lib/errors";
import { describeInvitation } from "@/modules/team/service";
import { acceptInvitationAction } from "./actions";

export const metadata: Metadata = { title: "Invitación", robots: { index: false, follow: false } };

export default async function InvitationPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  let inv;
  try {
    inv = await describeInvitation(token);
  } catch (e) {
    if (!isAppError(e)) throw e;
  }
  const user = await getCurrentUser();
  return (
    <>
      <TopBar />
      <main className={`${ui.container} ${ui.page}`}>
        <div className={ui.card} style={{ maxWidth: 480, margin: "3rem auto" }}>
          <p className={ui.eyebrow}>Invitación al equipo</p>
          {!inv ? (
            <>
              <h1>La invitación no es válida</h1>
              <p className={ui.muted}>Puede haber vencido, haberse usado o haber sido revocada. Pedile al complejo una nueva.</p>
            </>
          ) : (
            <>
              <h1>{inv.tenantName}</h1>
              <p className={ui.muted}>Te invitaron como <strong>{inv.role === "ADMIN" ? "administrador/a" : "personal"}</strong> con el email <strong>{inv.email}</strong>.</p>
              {inv.userExists ? (
                user && user.email === inv.email ? (
                  <ActionForm action={acceptInvitationAction.bind(null, token)} submitLabel="Aceptar invitación" className={ui.stack} />
                ) : (
                  <div className={ui.stack}>
                    <p className={`${ui.alert} ${ui.alertInfo}`}>Ya tenés cuenta en TURNUP. Ingresá con {inv.email} para aceptar.</p>
                    <Link className={ui.button} href={`/login?next=${encodeURIComponent(`/invitacion?token=${token}`)}`}>Ingresar</Link>
                  </div>
                )
              ) : (
                <ActionForm action={acceptInvitationAction.bind(null, token)} submitLabel="Crear cuenta y aceptar" className={ui.stack}>
                  <label className={ui.field}><span className={ui.label}>Tu nombre</span><input className={ui.input} name="name" required minLength={2} maxLength={100} autoComplete="name" /></label>
                  <label className={ui.field}><span className={ui.label}>Contraseña</span><input className={ui.input} type="password" name="password" required minLength={12} maxLength={128} autoComplete="new-password" /><span className={ui.hint}>Mínimo 12 caracteres.</span></label>
                </ActionForm>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}
