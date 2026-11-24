"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./player.module.css";

/**
 * Navegación de la plataforma de jugadores. Solo secciones que YA funcionan; "Partidos" y
 * "Clases" se agregarán a esta lista cuando existan (ver docs/FASE4.md), sin botones vacíos.
 */
const ITEMS = [
  { href: "/", label: "Inicio", icon: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { href: "/explorar", label: "Explorar", icon: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3" },
  { href: "/mis-turnos", label: "Mis turnos", icon: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" },
  { href: "/perfil", label: "Perfil", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" },
] as const;

export function BottomNav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav className={styles.bottomNav} aria-label="Secciones">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} className={active(i.href) ? styles.navActive : styles.navItem} aria-current={active(i.href) ? "page" : undefined}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={i.icon} />
          </svg>
          <span>{i.label}</span>
        </Link>
      ))}
    </nav>
  );
}
