import type { Metadata } from "next";
import { AuthLayout } from "@/components/AuthLayout";
import ui from "@/components/ui.module.css";
import { ResetForm } from "./ResetForm";

// La URL lleva un token de un solo uso: no indexar.
export const metadata: Metadata = { title: "Nueva contraseña", robots: { index: false, follow: false } };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  const valid = Boolean(token && /^[A-Za-z0-9_-]{16,128}$/.test(token) && !error);
  return (
    <AuthLayout>
          <p className={ui.eyebrow}>Panel TURNUP</p>
          <h1>Elegí una nueva contraseña</h1>
          {valid ? <ResetForm token={token!} /> : <p className={`${ui.alert} ${ui.alertError}`}>El enlace no es válido o venció. Pedí uno nuevo desde “¿Olvidaste tu contraseña?”.</p>}
        </AuthLayout>
  );
}
