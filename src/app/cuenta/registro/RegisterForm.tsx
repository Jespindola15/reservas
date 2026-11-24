"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ui from "@/components/ui.module.css";
import { authClient } from "@/lib/auth/client";
import { registerPlayerAction } from "../actions";

export function RegisterForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    if (fd.get("password") !== fd.get("password2")) return setError("Las contraseñas no coinciden.");
    setPending(true);
    const res = await registerPlayerAction(null, fd);
    if (!res?.ok) {
      setPending(false);
      return setError(res?.message ?? "No pudimos crear la cuenta.");
    }
    const login = await authClient.signIn.email({ email: String(fd.get("email")), password: String(fd.get("password")) });
    setPending(false);
    if (login.error) return router.replace("/cuenta/ingresar");
    const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/perfil";
    router.replace(dest);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className={ui.stack} noValidate={false}>
      <label className={ui.field}><span className={ui.label}>Nombre y apellido</span><input className={ui.input} name="name" required minLength={2} maxLength={80} autoComplete="name" /></label>
      <label className={ui.field}><span className={ui.label}>Email</span><input className={ui.input} name="email" type="email" required maxLength={254} autoComplete="email" /></label>
      <div className={ui.grid2}>
        <label className={ui.field}><span className={ui.label}>Teléfono (opcional)</span><input className={ui.input} name="phone" type="tel" maxLength={30} autoComplete="tel" /></label>
        <label className={ui.field}><span className={ui.label}>Ciudad (opcional)</span><input className={ui.input} name="city" maxLength={80} autoComplete="address-level2" /></label>
      </div>
      <label className={ui.field}><span className={ui.label}>Contraseña (mín. 12 caracteres)</span><input className={ui.input} name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
      <label className={ui.field}><span className={ui.label}>Repetir contraseña</span><input className={ui.input} name="password2" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, opacity: 0 }} />
      <label className={ui.checkbox}>
        <input type="checkbox" name="acceptTerms" required />
        <span>Acepto los términos y la política de privacidad (borradores en revisión).</span>
      </label>
      {error ? <p role="alert" className={`${ui.alert} ${ui.alertError}`}>{error}</p> : null}
      <button className={ui.button} type="submit" disabled={pending}>{pending ? "Creando…" : "Crear cuenta"}</button>
      <p className={ui.faint}>Solo guardamos lo necesario: nombre, email y, si querés, teléfono y ciudad. <Link href="/">Volver</Link></p>
    </form>
  );
}
