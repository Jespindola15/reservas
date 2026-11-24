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

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const { error: err } = await authClient.signIn.email({
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
    router.replace(safeNext(next));
    router.refresh();
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
