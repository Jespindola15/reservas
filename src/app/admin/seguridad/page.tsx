import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import ui from "@/components/ui.module.css";
import { requireUserPage } from "@/lib/auth/dal";
import { SignOutButton } from "../../panel/SignOutButton";
import { AdminNav } from "../AdminNav";
import { TwoFactorSetup } from "./TwoFactorSetup";

export const metadata: Metadata = { title: "Seguridad", robots: { index: false, follow: false } };

export default async function SecurityPage() {
  const user = await requireUserPage("/admin/seguridad");
  if (user.platformRole !== "SUPERADMIN") notFound();
  return (
    <>
      <TopBar>
        <Link href="/panel" className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`}>Mis complejos</Link>
        <SignOutButton />
      </TopBar>
      <main className={`${ui.container} ${ui.page} ${ui.stack}`}>
        <div className={ui.spread}><h1>Seguridad de tu cuenta</h1>{user.twoFactorEnabled ? <AdminNav current="/admin/seguridad" /> : null}</div>
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
      </main>
    </>
  );
}
