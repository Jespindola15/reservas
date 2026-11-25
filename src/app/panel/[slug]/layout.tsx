import { notFound, redirect } from "next/navigation";
import { AppShell, type NavGroup, type NavItem } from "@/components/shell/AppShell";
import { requireUserPage } from "@/lib/auth/dal";
import { isAppError } from "@/lib/errors";
import { authorizeTenantAccess, hasPermission } from "@/modules/access/authorize";
import { panelBadges } from "@/modules/inbox/service";
import { SignOutButton } from "../SignOutButton";

const ROLE = { OWNER: "Dueño", ADMIN: "Administrador", STAFF: "Personal" } as const;

/**
 * Estructura del panel. La autorización acá es de PRESENTACIÓN: cada página y
 * cada Server Action vuelve a autorizar por su cuenta (un layout no protege acciones).
 */
export default async function PanelLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUserPage(`/panel/${slug}`);
  let access;
  try {
    access = await authorizeTenantAccess(user, slug, "booking.read");
  } catch (e) {
    if (isAppError(e) && (e.code === "FORBIDDEN" || e.code === "TENANT_NOT_FOUND")) notFound();
    if (isAppError(e) && e.code === "TENANT_SUSPENDED") redirect("/panel?suspended=1");
    throw e;
  }
  const { tenant, role } = access;
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(role, p);
  const badges = await panelBadges(access.ctx).catch(() => ({ unread: 0, transfers: 0, incidents: 0 }));
  const b = `/panel/${slug}`;

  const groups: NavGroup[] = [
    {
      items: [
        { href: b, label: "Hoy", icon: "dashboard", exact: true },
        { href: `${b}/calendario`, label: "Calendario", icon: "calendar" },
        { href: `${b}/reservas`, label: "Reservas", icon: "list" },
        { href: `${b}/transferencias`, label: "Transferencias", icon: "transfer", count: badges.transfers + badges.incidents },
        { href: `${b}/clientes`, label: "Clientes", icon: "users" },
        { href: `${b}/avisos`, label: "Avisos", icon: "bell", count: badges.unread },
      ],
    },
    ...(can("court.manage")
      ? [
          {
            title: "Complejo",
            items: [
              { href: `${b}/canchas`, label: "Canchas y precios", icon: "courts" },
              { href: `${b}/horarios`, label: "Feriados y bloqueos", icon: "clock" },
              { href: `${b}/pagina`, label: "Página y fotos", icon: "camera" },
              { href: `${b}/opiniones`, label: "Opiniones", icon: "reviews" },
            ] satisfies NavItem[],
          },
          {
            title: "Negocio",
            items: [
              { href: `${b}/finanzas`, label: "Finanzas", icon: "finance" },
              { href: `${b}/estadisticas`, label: "Estadísticas", icon: "stats" },
              { href: `${b}/cobros`, label: "Datos de cobro", icon: "wallet" },
              { href: `${b}/plan`, label: "Plan y suscripción", icon: "plan" },
            ] satisfies NavItem[],
          },
          {
            title: "Configuración",
            items: [
              { href: `${b}/equipo`, label: "Usuarios y permisos", icon: "userCog" },
              { href: `${b}/ajustes`, label: "Reglas de reserva", icon: "settings" },
            ] satisfies NavItem[],
          },
        ]
      : []),
    { items: [{ href: `/${slug}`, label: "Ver mi página pública", icon: "external", external: true }] },
  ];
  const tabs: NavItem[] = [
    { href: b, label: "Hoy", icon: "dashboard", exact: true },
    { href: `${b}/calendario`, label: "Calendario", icon: "calendar" },
    { href: `${b}/reservas`, label: "Reservas", icon: "list" },
    { href: `${b}/transferencias`, label: "Pagos", icon: "transfer", count: badges.transfers },
  ];

  return (
    <AppShell
      homeHref={b}
      context={{ label: "Complejo", title: tenant.name, detail: ROLE[role] }}
      groups={groups}
      tabs={tabs}
      user={{ name: user.name }}
      inboxHref={`${b}/avisos`}
      unread={badges.unread}
      primaryAction={can("booking.manage") ? { href: `${b}/calendario?nueva=1`, label: "Nueva reserva" } : undefined}
      signOut={<SignOutButton compact />}
    >
      {children}
    </AppShell>
  );
}
