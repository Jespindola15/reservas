"use client";

import Link from "next/link";
import { useState } from "react";
import ui from "@/components/ui.module.css";

export function ResetForm({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "mismatch" | "invalid" | "error">("idle");
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const pw = String(fd.get("password") ?? "");
    if (pw !== String(fd.get("confirm") ?? "")) return setState("mismatch");
    setState("sending");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: pw, token }),
      });
      setState(res.ok ? "done" : res.status === 400 ? "invalid" : "error");
    } catch {
      setState("error");
    }
  }
  if (state === "done") {
    return (
      <div className={ui.stack}>
        <p role="status" className={`${ui.alert} ${ui.alertOk}`}>Listo: tu contraseña cambió y se cerraron las sesiones abiertas.</p>
        <Link className={ui.button} href="/login">Ingresar</Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className={ui.stack}>
      <label className={ui.field}>
        <span className={ui.label}>Nueva contraseña</span>
        <input className={ui.input} type="password" name="password" required minLength={12} maxLength={128} autoComplete="new-password" />
        <span className={ui.hint}>Mínimo 12 caracteres.</span>
      </label>
      <label className={ui.field}>
        <span className={ui.label}>Repetila</span>
        <input className={ui.input} type="password" name="confirm" required minLength={12} maxLength={128} autoComplete="new-password" />
      </label>
      {state === "mismatch" ? <p role="alert" className={`${ui.alert} ${ui.alertError}`}>Las contraseñas no coinciden.</p> : null}
      {state === "invalid" ? <p role="alert" className={`${ui.alert} ${ui.alertError}`}>El enlace venció o ya se usó, o la contraseña no cumple los requisitos.</p> : null}
      {state === "error" ? <p role="alert" className={`${ui.alert} ${ui.alertError}`}>No pudimos cambiar la contraseña. Probá de nuevo.</p> : null}
      <button className={ui.button} disabled={state === "sending"}>{state === "sending" ? "Guardando…" : "Guardar contraseña"}</button>
    </form>
  );
}
