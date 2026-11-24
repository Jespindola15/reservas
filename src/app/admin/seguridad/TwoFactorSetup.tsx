"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import ui from "@/components/ui.module.css";

type Step = { kind: "password" } | { kind: "scan"; qr: string; secret: string; backupCodes: string[] };

async function post(path: string, body: unknown) {
  const res = await fetch(`/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

/** Alta del segundo factor: contraseña → QR + códigos de respaldo → primer código (confirma). */
export function TwoFactorSetup() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "password" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    const r = await post("/two-factor/enable", { password, issuer: "TURNUP" });
    setPending(false);
    if (!r.ok || !r.data?.totpURI) {
      setError(r.status === 429 ? "Demasiados intentos. Esperá unos minutos." : "Contraseña incorrecta.");
      return;
    }
    const uri: string = r.data.totpURI;
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220, color: { dark: "#05070d", light: "#ffffff" } });
    setStep({ kind: "scan", qr, secret: new URL(uri).searchParams.get("secret") ?? "", backupCodes: r.data.backupCodes ?? [] });
  }

  async function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s/g, "");
    const r = await post("/two-factor/verify-totp", { code });
    setPending(false);
    if (!r.ok) {
      setError(r.status === 429 ? "Demasiados intentos. Esperá unos minutos." : "El código no es válido. Revisá la hora del celular y probá con el siguiente.");
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  if (step.kind === "password") {
    return (
      <form onSubmit={start} className={ui.stack}>
        <h2>1. Confirmá tu contraseña</h2>
        <label className={ui.field}>
          <span className={ui.label}>Contraseña actual</span>
          <input className={ui.input} type="password" name="password" autoComplete="current-password" required />
        </label>
        {error ? <p role="alert" className={`${ui.alert} ${ui.alertError}`}>{error}</p> : null}
        <button className={ui.button} disabled={pending}>{pending ? "Preparando…" : "Continuar"}</button>
      </form>
    );
  }

  return (
    <div className={ui.stack}>
      <h2>2. Escaneá el código con tu app</h2>
      <p className={ui.muted}>Usá Google Authenticator, Microsoft Authenticator, Authy o 1Password.</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={step.qr} width={220} height={220} alt="Código QR para la app de autenticación" style={{ borderRadius: 12, background: "#fff" }} />
      <details>
        <summary className={ui.muted}>¿No podés escanear? Cargá la clave a mano</summary>
        <code style={{ wordBreak: "break-all" }}>{step.secret}</code>
      </details>
      <h2>3. Guardá tus códigos de respaldo</h2>
      <p className={ui.muted}>Sirven una sola vez cada uno si perdés el celular. Guardalos en un lugar seguro (no en este equipo).</p>
      <ul style={{ columns: 2, fontFamily: "ui-monospace, monospace", paddingLeft: "1.2rem" }}>
        {step.backupCodes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <label className={ui.checkbox}><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />Ya guardé mis códigos de respaldo</label>
      <form onSubmit={confirm} className={ui.stack}>
        <h2>4. Ingresá el código de 6 dígitos</h2>
        <label className={ui.field}>
          <span className={ui.label}>Código de 6 dígitos</span>
          <input className={ui.input} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required />
        </label>
        {error ? <p role="alert" className={`${ui.alert} ${ui.alertError}`}>{error}</p> : null}
        <button className={ui.button} disabled={pending || !saved}>{pending ? "Verificando…" : "Activar verificación en dos pasos"}</button>
      </form>
    </div>
  );
}
