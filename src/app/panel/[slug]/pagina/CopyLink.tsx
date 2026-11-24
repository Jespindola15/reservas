"use client";

import { useState } from "react";
import ui from "@/components/ui.module.css";

/** Copiar / compartir el enlace público (Web Share API si existe). */
export function CopyLink({ url, title }: { url: string; title: string }) {
  const [msg, setMsg] = useState("");
  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setMsg("Enlace copiado.");
    } catch {
      setMsg("");
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMsg("Enlace copiado.");
    } catch {
      setMsg("No se pudo copiar: seleccioná el enlace y copialo a mano.");
    }
  }
  return (
    <div className={ui.row}>
      <button type="button" className={`${ui.button} ${ui.buttonSecondary}`} onClick={copy}>Copiar enlace</button>
      <button type="button" className={`${ui.button} ${ui.buttonSecondary}`} onClick={share}>Compartir</button>
      <span role="status" className={ui.muted}>{msg}</span>
    </div>
  );
}
