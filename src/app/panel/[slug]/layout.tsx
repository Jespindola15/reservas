import { notFound, redirect } from "next/navigation";
import { Brand } from "@/components/Brand";
import { requireUserPage } from "@/lib/auth/dal";
import { isAppError } from "@/lib/errors";
import { authorizeTenantAccess, hasPermission } from "@/modules/access/authorize";
import { SignOutButton } from "../SignOutButton";
import { MobileTabs, SidebarNav } from "./SidebarNav";
import styles from "./shell.module.css";

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
  const canManage = hasPermission(role, "court.manage");

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTop}>
          <Brand href="/panel" />
          <details className={styles.mobileMenu}>
            <summary aria-label="Abrir menú">Menú</summary>
            <SidebarNav slug={slug} canManage={canManage} />
          </details>
        </div>
        <div className={styles.tenantBox}>
          <span className={styles.tenantLabel}>Complejo</span>
          <strong>{tenant.name}</strong>
          <span className={styles.role}>{role === "OWNER" ? "Dueño" : role === "ADMIN" ? "Administrador" : "Personal"}</span>
        </div>
        <div className={styles.desktopNav}>
          <SidebarNav slug={slug} canManage={canManage} />
        </div>
        <div className={styles.sidebarFooter}>
          <span className={styles.userName}>{user.name}</span>
          <SignOutButton />
        </div>
      </aside>
      <main className={styles.main}>{children}</main>
      <MobileTabs slug={slug} />
    </div>
  );
}
