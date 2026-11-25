"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/Brand";
import { Icon, type IconName } from "./icons";
import styles from "./shell.module.css";

export type NavItem = { href: string; label: string; icon: IconName; exact?: boolean; count?: number; external?: boolean };
export type NavGroup = { title?: string; items: NavItem[] };

/**
 * Estructura común del panel del complejo y del superadministrador.
 * - Escritorio (≥ 1024 px): barra lateral fija con grupos.
 * - Celular/tablet: barra superior compacta + barra inferior con las 4 secciones de uso diario
 *   y "Más", que abre el menú completo. La acción principal queda siempre a un toque.
 */
export function AppShell(props: {
  homeHref: string;
  context: { label: string; title: string; detail?: string };
  groups: NavGroup[];
  tabs: NavItem[];
  user: { name: string };
  inboxHref?: string;
  unread?: number;
  primaryAction?: { href: string; label: string };
  signOut: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // El menú queda abierto solo en la ruta donde se abrió: al navegar se cierra sin efectos extra.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (v: boolean) => setOpenAt(v ? pathname : null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenAt(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const isActive = (it: NavItem) => (it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(`${it.href}/`));

  const nav = (
    <nav aria-label="Secciones" className={styles.nav}>
      {props.groups.map((g, i) => (
        <div key={i} className={styles.group}>
          {g.title ? <p className={styles.groupTitle}>{g.title}</p> : null}
          {g.items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className={isActive(it) ? styles.itemActive : styles.item}
              aria-current={isActive(it) ? "page" : undefined}
              {...(it.external ? { target: "_blank", rel: "noopener" } : {})}
            >
              <Icon name={it.icon} />
              <span className={styles.itemLabel}>{it.label}</span>
              {it.count ? <span className={styles.count} aria-label={`${it.count} pendientes`}>{it.count > 99 ? "99+" : it.count}</span> : null}
              {it.external ? <Icon name="external" size={14} className={styles.ext} /> : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Navegación principal">
        <Link href={props.homeHref} className={styles.logo} aria-label="TURNUP, inicio"><Wordmark height={24} /></Link>
        <div className={styles.context}>
          <span className={styles.contextLabel}>{props.context.label}</span>
          <strong className={styles.contextTitle}>{props.context.title}</strong>
          {props.context.detail ? <span className={styles.contextDetail}>{props.context.detail}</span> : null}
        </div>
        {props.primaryAction ? (
          <Link href={props.primaryAction.href} className={styles.primary}><Icon name="plus" />{props.primaryAction.label}</Link>
        ) : null}
        <div className={styles.navScroll}>{nav}</div>
        <div className={styles.footer}>
          <span className={styles.avatar} aria-hidden>{initialsOf(props.user.name)}</span>
          <span className={styles.userName}>{props.user.name}</span>
          {props.signOut}
        </div>
      </aside>

      <header className={styles.topbar}>
        <Link href={props.homeHref} className={styles.logo} aria-label="TURNUP, inicio"><Wordmark height={22} /></Link>
        <span className={styles.topTitle}>{props.context.title}</span>
        {props.inboxHref ? (
          <Link href={props.inboxHref} className={styles.topIcon} aria-label={props.unread ? `Avisos: ${props.unread} sin leer` : "Avisos"}>
            <Icon name="bell" size={20} />
            {props.unread ? <span className={styles.dot} /> : null}
          </Link>
        ) : null}
        <button type="button" className={styles.topIcon} aria-label="Abrir menú" aria-expanded={open} onClick={() => setOpen(true)}>
          <Icon name="menu" size={20} />
        </button>
      </header>

      {open ? (
        <div className={styles.drawerWrap}>
          <button type="button" className={styles.scrim} aria-label="Cerrar menú" onClick={() => setOpen(false)} />
          <div className={styles.drawer} role="dialog" aria-modal="true" aria-label="Menú">
            <div className={styles.drawerHead}>
              <div className={styles.context}>
                <span className={styles.contextLabel}>{props.context.label}</span>
                <strong className={styles.contextTitle}>{props.context.title}</strong>
              </div>
              <button type="button" className={styles.topIcon} aria-label="Cerrar menú" onClick={() => setOpen(false)}><Icon name="close" size={20} /></button>
            </div>
            {nav}
            <div className={styles.footer}>
              <span className={styles.avatar} aria-hidden>{initialsOf(props.user.name)}</span>
              <span className={styles.userName}>{props.user.name}</span>
              {props.signOut}
            </div>
          </div>
        </div>
      ) : null}

      <main className={styles.main} id="contenido">{props.children}</main>

      {props.primaryAction ? (
        <Link href={props.primaryAction.href} className={styles.fab} aria-label={props.primaryAction.label}><Icon name="plus" size={24} /></Link>
      ) : null}

      <nav className={styles.tabs} aria-label="Accesos rápidos">
        {props.tabs.map((t) => (
          <Link key={t.href} href={t.href} className={isActive(t) ? styles.tabActive : styles.tab} aria-current={isActive(t) ? "page" : undefined}>
            <span className={styles.tabIcon}><Icon name={t.icon} size={22} />{t.count ? <span className={styles.tabCount}>{t.count > 9 ? "9+" : t.count}</span> : null}</span>
            <span>{t.label}</span>
          </Link>
        ))}
        <button type="button" className={styles.tab} onClick={() => setOpen(true)} aria-expanded={open}>
          <span className={styles.tabIcon}><Icon name="more" size={22} /></span>
          <span>Más</span>
        </button>
      </nav>
    </div>
  );
}

function initialsOf(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1]![0] : "")).toUpperCase() || "?";
}
