"use client";

import Link from "next/link";
import { useState } from "react";
import ui from "@/components/ui.module.css";

/** Siempre muestra el mismo mensaje: no revela si la cuenta existe. */
export function RequestResetForm() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "limited" | "error">("idle");
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    try {
      const res = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, redirectTo: "/restablecer" }),
      });
      setState(res.status === 429 ? "limited" : res.ok || res.status === 400 ? "done" : "error");
    } catch {
      setState("error");
    }
  }
  if (state === "done") {
    return (
      <div className={ui.stack}>
        <p role="status" className={`${ui.alert} ${ui.alertOk}`}>Si el email corresponde a una cuenta, en unos minutos vas a recibir el enlace. Revisá también el correo no deseado.</p>
        <Link href="/login" className={`${ui.button} ${ui.buttonSecondary}`}>Volver a ingresar</Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className={ui.stack}>
      <label className={ui.field}>
        <span className={ui.label}>Email de tu cuenta</span>
        <input className={ui.input} name="email" type="email" required autoComplete="username" maxLength={254} />
      </label>
      {state === "limited" ? <p role="alert" className={`${ui.alert} ${ui.alertError}`}>Demasiados intentos. Esperá un rato antes de volver a probar.</p> : null}
      {state === "error" ? <p role="alert" className={`${ui.alert} ${ui.alertError}`}>No pudimos procesar el pedido. Probá de nuevo.</p> : null}
      <button className={ui.button} disabled={state === "sending"}>{state === "sending" ? "Enviando…" : "Enviar enlace"}</button>
      <Link href="/login" className={ui.muted}>Volver a ingresar</Link>
    </form>
  );
}
