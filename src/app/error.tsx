"use client";

import Link from "next/link";
import ui from "@/components/ui.module.css";

/**
 * Error inesperado en una página (p. ej. la base no responde o falta
 * configuración). No muestra detalles internos: el detalle queda en los logs
 * del servidor, asociado al `digest`.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className={`${ui.container} ${ui.page}`}>
      <div className={ui.card} style={{ maxWidth: 520, margin: "4rem auto" }}>
        <p className={ui.eyebrow}>TURNUP</p>
        <h1>Servicio no disponible por un momento</h1>
        <p className={ui.muted}>No pudimos cargar esta página. Probá de nuevo en unos segundos.</p>
        {error.digest ? <p className={ui.faint}>Código de error: {error.digest}</p> : null}
        <div className={ui.row} style={{ marginTop: "1rem" }}>
          <button className={ui.button} onClick={reset}>Reintentar</button>
          <Link className={`${ui.button} ${ui.buttonSecondary}`} href="/">Ir al inicio</Link>
        </div>
      </div>
    </main>
  );
}
