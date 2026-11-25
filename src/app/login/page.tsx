import type { Metadata } from "next";
import { AuthLayout } from "@/components/AuthLayout";
import ui from "@/components/ui.module.css";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthLayout>
          <p className={ui.eyebrow}>Panel TURNUP</p>
          <h1>Ingresar</h1>
          <p className={ui.muted}>Acceso para equipos de complejos deportivos.</p>
          <LoginForm next={next ?? null} />
        </AuthLayout>
  );
}
