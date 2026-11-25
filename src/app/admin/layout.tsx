import { notFound } from "next/navigation";
import { AppShell, type NavGroup, type NavItem } from "@/components/shell/AppShell";
import { requireUserPage } from "@/lib/auth/dal";
import { SignOutButton } from "../panel/SignOutButton";

/**
 * Estructura del superadministrador. Presentación únicamente: cada página exige rol + 2FA
 * (requireSuperadminPage) y cada acción vuelve a verificarlo en el servidor.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserPage("/admin");
  if (user.platformRole !== "SUPERADMIN") notFound();
  const groups: NavGroup[] = user.twoFactorEnabled
    ? [
        { items: [{ href: "/admin", label: "Resumen", icon: "dashboard", exact: true }] },
        {
          title: "Plataforma",
          items: [
            { href: "/admin/complejos", label: "Complejos", icon: "courts" },
            { href: "/admin/usuarios", label: "Usuarios", icon: "users" },
            { href: "/admin/moderacion", label: "Moderación", icon: "reviews" },
          ],
        },
        {
          title: "Comercial",
          items: [{ href: "/admin/planes", label: "Planes y suscripciones", icon: "plan" }],
        },
        {
          title: "Operación",
          items: [
            { href: "/admin/sistema", label: "Sistema y alertas", icon: "server" },
            { href: "/admin/auditoria", label: "Auditoría", icon: "audit" },
            { href: "/admin/seguridad", label: "Seguridad de la cuenta", icon: "shieldCheck" },
          ],
        },
      ]
    : [{ items: [{ href: "/admin/seguridad", label: "Seguridad de la cuenta", icon: "shieldCheck" }] }];
  const tabs: NavItem[] = user.twoFactorEnabled
    ? [
        { href: "/admin", label: "Resumen", icon: "dashboard", exact: true },
        { href: "/admin/complejos", label: "Complejos", icon: "courts" },
        { href: "/admin/usuarios", label: "Usuarios", icon: "users" },
        { href: "/admin/sistema", label: "Sistema", icon: "server" },
      ]
    : [{ href: "/admin/seguridad", label: "Seguridad", icon: "shieldCheck" }];

  return (
    <AppShell
      homeHref="/admin"
      context={{ label: "TURNUP", title: "Superadministrador", detail: user.twoFactorEnabled ? "2FA activo" : "Falta activar 2FA" }}
      groups={groups}
      tabs={tabs}
      user={{ name: user.name }}
      signOut={<SignOutButton compact />}
    >
      {children}
    </AppShell>
  );
}
