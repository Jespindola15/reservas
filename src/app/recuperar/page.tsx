import type { Metadata } from "next";
import { TopBar } from "@/components/TopBar";
import ui from "@/components/ui.module.css";
import { RequestResetForm } from "./RequestResetForm";

export const metadata: Metadata = { title: "Recuperar contraseña", robots: { index: false } };

export default function RecoverPage() {
  return (
    <>
      <TopBar />
      <main className={`${ui.container} ${ui.page}`}>
        <div className={ui.card} style={{ maxWidth: 440, margin: "3rem auto" }}>
          <p className={ui.eyebrow}>Panel TURNUP</p>
          <h1>Recuperar contraseña</h1>
          <p className={ui.muted}>Te enviamos un enlace para elegir una nueva. Vence en 1 hora y sirve una sola vez.</p>
          <RequestResetForm />
        </div>
      </main>
    </>
  );
}
