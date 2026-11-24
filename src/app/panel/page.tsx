import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import ui from "@/components/ui.module.css";
import { requireUserPage } from "@/lib/auth/dal";
import { listMyTenants } from "@/modules/access/authorize";
import { SignOutButton } from "./SignOutButton";

export const metadata: Metadata = { title: "Mis complejos" };

export default async function PanelIndex({ searchParams }: { searchParams: Promise<{ suspended?: string; ir?: string }> }) {
  const user = await requireUserPage("/panel");
  const { suspended, ir } = await searchParams;
  const section = ir === "calendario" || ir === "reservas" ? `/${ir}` : "";
  const tenants = await listMyTenants(user.id);
  const active = tenants.filter((t) => t.status === "ACTIVE");
  if (active.length === 1 && !suspended && user.platformRole !== "SUPERADMIN") redirect(`/panel/${active[0]!.slug}${section}`);

  return (
    <>
      <TopBar>
        {user.platformRole === "SUPERADMIN" ? (
          <Link href="/admin" className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`}>Superadmin</Link>
        ) : null}
        <SignOutButton />
      </TopBar>
      <main className={`${ui.container} ${ui.page}`}>
        <h1>Mis complejos</h1>
        {suspended ? <p className={`${ui.alert} ${ui.alertWarn}`}>Ese complejo está suspendido. Contactá a soporte.</p> : null}
        {tenants.length === 0 ? (
          <p className={ui.muted}>Tu usuario todavía no tiene complejos asignados.</p>
        ) : (
          <ul className={ui.stack} style={{ listStyle: "none", padding: 0 }}>
            {tenants.map((t) => (
              <li key={t.slug} className={ui.card}>
                <div className={ui.row} style={{ justifyContent: "space-between" }}>
                  <div>
                    <strong>{t.name}</strong>
                    <div className={ui.muted}>/{t.slug} · {t.role}{t.status !== "ACTIVE" ? " · suspendido" : ""}</div>
                  </div>
                  {t.status === "ACTIVE" ? <Link className={ui.button} href={`/panel/${t.slug}`}>Abrir panel</Link> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
