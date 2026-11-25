import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ui from "@/components/ui.module.css";
import { requireUserPage } from "@/lib/auth/dal";
import { TwoFactorSetup } from "./TwoFactorSetup";

export const metadata: Metadata = { title: "Seguridad", robots: { index: false, follow: false } };

export default async function SecurityPage() {
  const user = await requireUserPage("/admin/seguridad");
  if (user.platformRole !== "SUPERADMIN") notFound();
  return (
    <>
      <div className={ui.stack}>
        <header className={ui.pageHeader}><div><p className={ui.eyebrow}>Tu cuenta</p><h1>Seguridad de tu cuenta</h1></div></header>
        {user.twoFactorEnabled ? (
          <section className={ui.card}>
            <h2>Verificación en dos pasos: activa</h2>
            <p className={ui.muted}>
              Cada vez que ingreses te vamos a pedir el código de 6 dígitos de tu app de autenticación. Si perdés el
              celular, usá uno de tus códigos de respaldo.
            </p>
          </section>
        ) : (
          <section className={ui.card} style={{ maxWidth: 640 }}>
            <p className={`${ui.alert} ${ui.alertInfo}`}>
              Para administrar TURNUP tenés que activar la verificación en dos pasos. Es un paso único y protege tu
              cuenta aunque alguien conozca tu contraseña.
            </p>
            <TwoFactorSetup />
          </section>
        )}
      </div>
    </>
  );
}
