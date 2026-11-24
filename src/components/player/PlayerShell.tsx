import Link from "next/link";
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
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
                </svg>
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
