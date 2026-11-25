"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

type Counts = { unread: number; transfers: number; incidents: number };

const INTERVAL_MS = 60_000;
/** Sin interacción durante este tiempo se deja de consultar (la base de datos puede dormirse). */
const IDLE_MS = 20 * 60_000;

/**
 * Actualiza el panel cuando llegan avisos o transferencias nuevas sin recargar la página:
 * consulta un endpoint liviano cada minuto mientras la pestaña está visible y la persona
 * la usa; solo si cambió algún contador pide al servidor que vuelva a renderizar.
 */
export function PanelLive({ slug, initial }: { slug: string; initial: Counts }) {
  const router = useRouter();
  const last = useRef(`${initial.unread}|${initial.transfers}|${initial.incidents}`);
  const lastActivity = useRef(0);

  useEffect(() => {
    last.current = `${initial.unread}|${initial.transfers}|${initial.incidents}`;
  }, [initial.unread, initial.transfers, initial.incidents]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    lastActivity.current = Date.now();

    const check = async () => {
      if (document.visibilityState !== "visible" || Date.now() - lastActivity.current > IDLE_MS) return;
      try {
        const r = await fetch(`/api/panel/${encodeURIComponent(slug)}/avisos`, { cache: "no-store", credentials: "same-origin" });
        if (!r.ok) return;
        const c = (await r.json()) as Counts;
        const sig = `${c.unread}|${c.transfers}|${c.incidents}`;
        if (sig !== last.current) {
          last.current = sig;
          router.refresh();
        }
      } catch {
        // Sin conexión: se reintenta en el próximo ciclo.
      }
    };
    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(async () => { await check(); schedule(); }, INTERVAL_MS);
    };
    const onActivity = () => {
      const wasIdle = Date.now() - lastActivity.current > IDLE_MS;
      lastActivity.current = Date.now();
      if (wasIdle) void check();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") { lastActivity.current = Date.now(); void check(); }
    };

    schedule();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, [slug, router]);

  return null;
}
