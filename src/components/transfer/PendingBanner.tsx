"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import ui from "@/components/ui.module.css";
import { readPending, type PendingTransfer } from "./pending-store";

const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};

/** Aviso para volver a una transferencia pendiente guardada en este dispositivo (invitados). */
export function PendingBanner({ slug }: { slug?: string }) {
  // Instantánea serializada (estable entre renders); en el servidor no hay almacenamiento: lista vacía.
  const raw = useSyncExternalStore(subscribe, () => JSON.stringify(readPending()), () => "[]");
  const items = (JSON.parse(raw) as PendingTransfer[]).filter((p) => !slug || p.slug === slug);
  if (!items.length) return null;
  return (
    <div className={`${ui.alert} ${ui.alertWarn}`} role="status" style={{ marginBottom: "var(--sp-4)" }}>
      {items.map((p) => (
        <div key={p.code} className={ui.spread}>
          <span>Tenés una reserva en <strong>{p.tenantName}</strong> esperando la transferencia ({p.code}).</span>
          <Link className={`${ui.button} ${ui.buttonSmall}`} href={p.url}>Completar el pago</Link>
        </div>
      ))}
    </div>
  );
}
