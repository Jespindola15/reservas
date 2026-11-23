"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./shell.module.css";

const ICONS: Record<string, string> = {
  inicio: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  calendario: "M7 3v3M17 3v3M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  reservas: "M9 5h10M9 12h10M9 19h10M4 5h.01M4 12h.01M4 19h.01",
  clientes: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 19v-1a4 4 0 0 0-3-3.87M16 2.13a4 4 0 0 1 0 7.75",
  canchas: "M3 5h18v14H3zM12 5v14M3 12h4M17 12h4",
  horarios: "M12 7v5l3 3M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  ajustes: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  publica: "M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5",
};

function Icon({ name }: { name: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

export function SidebarNav({ slug, canManage }: { slug: string; canManage: boolean }) {
  const pathname = usePathname();
  const base = `/panel/${slug}`;
  const items = [
    { href: base, label: "Inicio", icon: "inicio", exact: true },
    { href: `${base}/calendario`, label: "Calendario", icon: "calendario" },
    { href: `${base}/reservas`, label: "Reservas", icon: "reservas" },
    { href: `${base}/clientes`, label: "Clientes", icon: "clientes" },
    ...(canManage
      ? [
          { href: `${base}/canchas`, label: "Canchas y precios", icon: "canchas" },
          { href: `${base}/horarios`, label: "Feriados y bloqueos", icon: "horarios" },
          { href: `${base}/ajustes`, label: "Ajustes", icon: "ajustes" },
        ]
      : []),
  ];
  return (
    <nav aria-label="Panel" className={styles.navList}>
      {items.map((it) => {
        const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
        return (
          <Link key={it.href} href={it.href} className={active ? styles.navActive : styles.navItem} aria-current={active ? "page" : undefined}>
            <Icon name={it.icon} />
            {it.label}
          </Link>
        );
      })}
      <Link href={`/${slug}`} className={styles.navItem} target="_blank" rel="noopener">
        <Icon name="publica" />
        Página pública
      </Link>
    </nav>
  );
}
