import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sin conexión", robots: { index: false, follow: false } };

/** Página que el service worker muestra cuando no hay red. Estilos en línea: debe verse bien aunque no cargue el CSS. */
export default function OfflinePage() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#05070d", color: "#f5f7fa", fontFamily: "system-ui, sans-serif", padding: "1.5rem" }}>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <div aria-hidden style={{ width: 56, height: 56, margin: "0 auto 1rem", borderRadius: 14, background: "#c8f43b", color: "#0a1004", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 28 }}>T</div>
        <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.5rem" }}>Sin conexión</h1>
        <p style={{ color: "#a9b3c4", lineHeight: 1.5 }}>
          TURNUP necesita internet para mostrar horarios y reservas actualizados. Sin conexión no se puede reservar, confirmar ni cancelar.
        </p>
        {/* Enlace HTML normal a propósito: esta página puede servirse sin JS desde el service worker. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" style={{ display: "inline-block", marginTop: "1rem", padding: "0.7rem 1.2rem", borderRadius: 10, background: "#c8f43b", color: "#0a1004", fontWeight: 700, textDecoration: "none" }}>Reintentar</a>
      </div>
    </main>
  );
}
