"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Compass, Home, User } from "lucide-react";
import styles from "./player.module.css";

/** Navegación de la plataforma de jugadores (solo secciones que funcionan). */
const ITEMS = [
  { href: "/", label: "Inicio", Icon: Home },
  { href: "/explorar", label: "Explorar", Icon: Compass },
  { href: "/mis-turnos", label: "Mis turnos", Icon: CalendarDays },
  { href: "/perfil", label: "Perfil", Icon: User },
] as const;

export function BottomNav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav className={styles.bottomNav} aria-label="Secciones">
      {ITEMS.map(({ href, label, Icon }) => (
        <Link key={href} href={href} className={active(href) ? styles.navActive : styles.navItem} aria-current={active(href) ? "page" : undefined}>
          <Icon size={22} strokeWidth={1.75} aria-hidden />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
