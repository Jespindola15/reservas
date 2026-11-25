import Link from "next/link";
import { Bell } from "lucide-react";
import { Brand } from "@/components/Brand";
import type { AuthUser } from "@/modules/access/authorize";
import { listPlayerInbox } from "@/modules/inbox/service";
import { BottomNav } from "./BottomNav";
import styles from "./player.module.css";
import { initials } from "./initials";

/** Estructura de la plataforma de jugadores: barra superior + contenido + navegación inferior. */
export async function PlayerShell({ user, children, wide = false }: { user: AuthUser | null; children: React.ReactNode; wide?: boolean }) {
  const unread = user ? (await listPlayerInbox(user.id, 1).catch(() => ({ unread: 0 }))).unread : 0;
  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <div className={styles.topInner}>
          <Brand />
          <div className={styles.topActions}>
            {user ? (
              <Link href="/avisos" className={styles.bell} aria-label={unread ? `Avisos: ${unread} sin leer` : "Avisos"}>
                <Bell size={21} strokeWidth={1.75} aria-hidden />
                {unread ? <span className={styles.bellCount}>{unread > 9 ? "9+" : unread}</span> : null}
              </Link>
            ) : null}
            {user ? (
              <Link href="/perfil" className={styles.avatarLink} aria-label={`Perfil de ${user.name}`}>
                <span className={styles.avatar} aria-hidden>{initials(user.name)}</span>
              </Link>
            ) : (
              <Link href="/cuenta/ingresar" className={styles.signIn}>Ingresar</Link>
            )}
          </div>
        </div>
      </header>
      <main className={wide ? styles.mainWide : styles.main}>{children}</main>
      <BottomNav />
    </div>
  );
}
