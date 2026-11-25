import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PlayerShell } from "@/components/player/PlayerShell";
import styles from "@/components/player/player.module.css";
import ui from "@/components/ui.module.css";
import { getCurrentUser } from "@/lib/auth/dal";
import { RegisterForm } from "./RegisterForm";

export const metadata: Metadata = { title: "Crear cuenta — TURNUP" };

export default async function PlayerRegister({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getCurrentUser().catch(() => null)) redirect("/perfil");
  return (
    <PlayerShell user={null}>
      <div className={`${styles.authWrap} ${styles.authCard}`}>
        <p className={ui.eyebrow}>Cuenta de jugador</p>
        <h1>Crear cuenta</h1>
        <p className={ui.muted}>Es opcional: también podés reservar como invitado. Con cuenta ves todos tus turnos juntos.</p>
        <RegisterForm next={next ?? null} />
        <p className={ui.muted} style={{ marginTop: "1rem" }}>¿Ya tenés cuenta? <Link href="/cuenta/ingresar">Ingresá</Link></p>
      </div>
    </PlayerShell>
  );
}
