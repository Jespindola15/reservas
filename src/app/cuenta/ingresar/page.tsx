import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PlayerShell } from "@/components/player/PlayerShell";
import styles from "@/components/player/player.module.css";
import ui from "@/components/ui.module.css";
import { getCurrentUser } from "@/lib/auth/dal";
import { LoginForm } from "../../login/LoginForm";

export const metadata: Metadata = { title: "Ingresar — TURNUP" };

export default async function PlayerLogin({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getCurrentUser().catch(() => null)) redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/perfil");
  return (
    <PlayerShell user={null}>
      <div className={`${styles.authWrap} ${styles.authCard}`}>
        <p className={ui.eyebrow}>Cuenta de jugador</p>
        <h1>Ingresar</h1>
        <p className={ui.muted}>Mirá tus turnos en todos los complejos, guardá favoritos y opiná sobre donde jugaste.</p>
        <LoginForm next={next ?? null} fallback="/" />
        <p className={ui.muted} style={{ marginTop: "1rem" }}>¿No tenés cuenta? <Link href={`/cuenta/registro${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Creala gratis</Link></p>
        <p className={ui.faint}>¿Sos parte de un complejo? <Link href="/login">Ingresá al panel</Link></p>
      </div>
    </PlayerShell>
  );
}
