import type { Metadata } from "next";
import { BrandMark } from "@/components/Brand";
import { TopBar } from "@/components/TopBar";
import ui from "@/components/ui.module.css";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <>
      <TopBar />
      <main className={`${ui.container} ${ui.page}`}>
        <div className={ui.card} style={{ maxWidth: 420, margin: "3rem auto" }}>
          <div style={{ marginBottom: "0.9rem" }}><BrandMark size={44} /></div>
          <p className={ui.eyebrow}>Panel TURNUP</p>
          <h1>Ingresar</h1>
          <p className={ui.muted}>Acceso para equipos de complejos deportivos.</p>
          <LoginForm next={next ?? null} />
        </div>
      </main>
    </>
  );
}
