"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ui from "@/components/ui.module.css";
import type { ActionResult } from "@/lib/actions";
import styles from "./calendar.module.css";

type Move = { bookingId: string; version: number; courtId: string; courtName: string; minute: number; durationMinutes: number; label: string };
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * Reprogramación arrastrando turnos en la vista diaria.
 *  - Mouse: se activa al mover más de 6 px.  - Táctil: mantener apretado 0,5 s (el desplazamiento normal sigue funcionando).
 *  - Siempre pide confirmación; el servidor valida horario, superposición (PostgreSQL) y versión.
 * Los turnos llevan data-drag (id, versión, duración); las columnas data-court-id / data-court-name.
 */
export function DragLayer(props: {
  date: string;
  gridStart: number;
  rowMin: number;
  rowPx: number;
  enabled: boolean;
  move: (m: { bookingId: string; version: number; courtId: string; date: string; minute: number; durationMinutes: number }) => Promise<ActionResult>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [ghost, setGhost] = useState<{ x: number; y: number; h: number; text: string } | null>(null);
  const [pending, setPending] = useState<Move | null>(null);
  const [msg, setMsg] = useState<ActionResult>(null);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ el: HTMLElement; startX: number; startY: number; active: boolean; timer?: number; offsetY: number; moved?: boolean } | null>(null);

  function target(x: number, y: number, el: HTMLElement, offsetY: number) {
    // Solo columnas de cancha (los turnos usan data-from-court, así no se confunden).
    const col = document.elementsFromPoint(x, y).find((n) => (n as HTMLElement).dataset?.courtId && (n as HTMLElement).dataset?.courtName !== undefined) as HTMLElement | undefined;
    if (!col) return null;
    const rect = col.getBoundingClientRect();
    const topPx = y - offsetY - rect.top;
    const minute = props.gridStart + Math.max(0, Math.round(topPx / props.rowPx)) * props.rowMin;
    return {
      bookingId: el.dataset.bookingId!, version: Number(el.dataset.version), durationMinutes: Number(el.dataset.duration),
      courtId: col.dataset.courtId!, courtName: col.dataset.courtName ?? "", minute, label: el.dataset.label ?? "",
    };
  }

  function start(e: React.PointerEvent) {
    if (!props.enabled || busy) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-booking-id]");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    drag.current = { el, startX: e.clientX, startY: e.clientY, active: false, offsetY: e.clientY - rect.top };
    if (e.pointerType !== "mouse") {
      drag.current.timer = window.setTimeout(() => {
        if (!drag.current) return;
        drag.current.active = true;
        el.setPointerCapture?.(e.pointerId);
        navigator.vibrate?.(15);
        setGhost({ x: rect.left, y: rect.top, h: rect.height, text: el.dataset.label ?? "" });
      }, 500);
    }
  }

  function moveP(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
    if (!d.active) {
      if (e.pointerType !== "mouse") {
        if (dist > 8) { window.clearTimeout(d.timer); drag.current = null; } // es un desplazamiento, no un arrastre
        return;
      }
      if (dist < 6) return;
      d.active = true;
    }
    e.preventDefault();
    d.moved = true;
    const t = target(e.clientX, e.clientY, d.el, d.offsetY);
    const r = d.el.getBoundingClientRect();
    setGhost({ x: e.clientX - 40, y: e.clientY - d.offsetY, h: r.height, text: t ? `${t.courtName} · ${hhmm(t.minute)}` : "Soltá sobre una cancha" });
  }

  function end(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    window.clearTimeout(d.timer);
    setGhost(null);
    if (!d.active || !d.moved) return;
    const t = target(e.clientX, e.clientY, d.el, d.offsetY);
    if (t && (t.courtId !== d.el.dataset.fromCourt || t.minute !== Number(d.el.dataset.minute))) setPending(t);
    // El clic que sigue al arrastre (sobre el turno o sobre un horario libre donde se soltó)
    // no debe abrir nada: se bloquea en toda la ventana durante un instante.
    const block = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };
    window.addEventListener("click", block, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", block, { capture: true }), 300);
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    const r = await props.move({ bookingId: pending.bookingId, version: pending.version, courtId: pending.courtId, date: props.date, minute: pending.minute, durationMinutes: pending.durationMinutes });
    setBusy(false);
    setPending(null);
    setMsg(r);
    if (r?.ok) router.refresh();
  }

  return (
    <div onDragStart={(e) => e.preventDefault()} onPointerDown={start} onPointerMove={moveP} onPointerUp={end} onPointerCancel={() => { if (drag.current) window.clearTimeout(drag.current.timer); drag.current = null; setGhost(null); }}>
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={`${ui.alert} ${msg.ok ? ui.alertOk : ui.alertError}`} style={{ marginBottom: "0.75rem" }}>
          {msg.message} <button type="button" className={ui.linkButton} onClick={() => setMsg(null)}>Cerrar</button>
        </p>
      ) : null}
      {props.enabled ? <p className={ui.hint} style={{ marginBottom: "0.5rem" }}>Tip: arrastrá un turno para moverlo (en el celular, mantenelo apretado).</p> : null}
      {props.children}
      {ghost ? <div className={styles.dragGhost} style={{ left: ghost.x, top: ghost.y, height: ghost.h }} aria-hidden>{ghost.text}</div> : null}
      {pending ? (
        <div className={styles.moveBar} role="dialog" aria-modal="false" aria-label="Confirmar cambio de horario">
          <span>¿Mover <strong>{pending.label}</strong> a <strong>{pending.courtName}</strong>, {hhmm(pending.minute)}?</span>
          <div className={ui.row}>
            <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={confirm} disabled={busy}>{busy ? "Moviendo…" : "Mover"}</button>
            <button type="button" className={`${ui.button} ${ui.buttonGhost} ${ui.buttonSmall}`} onClick={() => setPending(null)} disabled={busy}>Cancelar</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
