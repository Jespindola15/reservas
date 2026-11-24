"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import ui from "@/components/ui.module.css";

/** Solo acepta destinos internos (evita redirecciones abiertas). */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/panel";
  return next;
}

export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Segundo paso: la cuenta tiene verificación en dos pasos. */
  const [needsCode, setNeedsCode] = useState(false);
  const [useBackup, setUseBackup] = useState(false);

  function done() {
    router.replace(safeNext(next));
    router.refresh();
  }

  async function onCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s/g, "");
    const res = await fetch(`/api/auth/two-factor/${useBackup ? "verify-backup-code" : "verify-totp"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    setPending(false);
    if (!res.ok) {
      setError(res.status === 429 ? "Demasiados intentos. Esperá unos minutos antes de volver a probar." : "El código no es válido.");
      return;
    }
    done();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const { data, error: err } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setPending(false);
    if (err) {
      // Mensaje genérico: no revela si el email existe.
      setError(
        err.status === 429
          ? "Demasiados intentos. Esperá unos minutos antes de volver a probar."
          : "Email o contraseña incorrectos.",
      );
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      setNeedsCode(true);
      return;
    }
    done();
  }

  if (needsCode) {
    return (
      <form onSubmit={onCode} className={ui.stack} noValidate>
        <p className={`${ui.alert} ${ui.alertInfo}`}>
          {useBackup ? "Ingresá uno de tus códigos de respaldo." : "Abrí tu app de autenticación e ingresá el código de 6 dígitos."}
        </p>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="code">{useBackup ? "Código de respaldo" : "Código de verificación"}</label>
          <input className={ui.input} id="code" name="code" autoComplete="one-time-code" inputMode={useBackup ? "text" : "numeric"} maxLength={useBackup ? 20 : 7} required autoFocus />
        </div>
        {error ? <p role="alert" className={`${ui.alert} ${ui.alertError}`}>{error}</p> : null}
        <button className={ui.button} type="submit" disabled={pending}>{pending ? "Verificando…" : "Verificar"}</button>
        <button type="button" className={`${ui.button} ${ui.buttonGhost}`} onClick={() => { setUseBackup((v) => !v); setError(null); }}>
          {useBackup ? "Usar el código de la app" : "Perdí el celular: usar un código de respaldo"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className={ui.stack} noValidate>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="email">Email</label>
        <input className={ui.input} id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="password">Contraseña</label>
        <input className={ui.input} id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {error ? <p role="alert" className={`${ui.alert} ${ui.alertError}`}>{error}</p> : null}
      <button className={ui.button} type="submit" disabled={pending}>
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
      <Link href="/recuperar" className={ui.muted}>¿Olvidaste tu contraseña?</Link>
    </form>
  );
}
