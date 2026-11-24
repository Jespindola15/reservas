import Link from "next/link";
import { Brand } from "@/components/Brand";
import type { AuthUser } from "@/modules/access/authorize";
import { BottomNav } from "./BottomNav";
import styles from "./player.module.css";

/** Estructura de la plataforma de jugadores: barra superior + contenido + navegación inferior. */
export function PlayerShell({ user, children, wide = false }: { user: AuthUser | null; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <div className={styles.topInner}>
          <Brand />
          <div className={styles.topActions}>
            {user ? (
              <Link href="/perfil" className={styles.avatarLink} aria-label={`Perfil de ${user.name}`}>
                <span className={styles.avatar} aria-hidden>{user.name.slice(0, 1).toUpperCase()}</span>
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
