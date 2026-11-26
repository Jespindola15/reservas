import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { ComplexCard, SPORT_LABEL } from "@/components/player/ComplexCard";
import { PlayerShell } from "@/components/player/PlayerShell";
import styles from "@/components/player/player.module.css";
import ui from "@/components/ui.module.css";
import { getCurrentUser } from "@/lib/auth/dal";
import { listMyTenants } from "@/modules/access/authorize";
import { cachedCatalog } from "@/modules/marketplace/cached";
import { getPlayerProfile, PLAYER_SPORTS } from "@/modules/player/account";
import { listFavoriteTenantIds } from "@/modules/player/favorites";
import { SignOutButton } from "../panel/SignOutButton";
import { resendVerificationAction, updateProfileAction } from "../cuenta/actions";
import { prisma } from "@/lib/db/prisma";
import { initials } from "@/components/player/initials";

export const metadata: Metadata = { title: "Mi perfil — TURNUP" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ verificado?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return (
      <PlayerShell user={null}>
        <h1 className={styles.hello}>Perfil</h1>
        <div className={styles.empty}>
          <p>Con tu cuenta de jugador ves tus turnos en todos los complejos, guardás favoritos y opinás donde jugaste.</p>
          <div className={ui.row} style={{ justifyContent: "center" }}>
            <Link className={ui.button} href="/cuenta/ingresar?next=/perfil">Ingresar</Link>
            <Link className={`${ui.button} ${ui.buttonSecondary}`} href="/cuenta/registro">Crear cuenta</Link>
          </div>
        </div>
        <p className={ui.faint} style={{ textAlign: "center", marginTop: "1rem" }}>¿Tenés un complejo? <Link href="/para-complejos">TURNUP para complejos</Link></p>
      </PlayerShell>
    );
  }
  const [profile, favIds, catalog, tenants] = await Promise.all([getPlayerProfile(user.id), listFavoriteTenantIds(user.id), cachedCatalog(), listMyTenants(user.id)]);
  const favorites = catalog.filter((c) => favIds.includes(c.id));
  const verified = (await prisma.user.findUnique({ where: { id: user.id }, select: { emailVerified: true } }))?.emailVerified === true;

  return (
    <PlayerShell user={user}>
      <header className={styles.profileHead}>
        <span className={styles.profileAvatar} aria-hidden>{initials(user.name)}</span>
        <div className={styles.profileWho}>
          <h1 className={styles.hello} style={{ margin: 0 }}>Hola, {user.name.split(" ")[0]}</h1>
          <span className={ui.muted}>{user.name} · {user.email}</span>
        </div>
      </header>
      {sp.verificado && verified ? <p role="status" className={`${ui.alert} ${ui.alertOk}`}>¡Listo! Confirmaste tu email.</p> : null}
      {sp.error && !verified ? <p role="alert" className={`${ui.alert} ${ui.alertError}`}>El enlace de verificación venció o ya se usó. Pedí uno nuevo.</p> : null}
      {!verified ? (
        <div className={`${ui.alert} ${ui.alertWarn}`}>
          <p style={{ margin: "0 0 var(--sp-2)" }}><strong>Confirmá tu email.</strong> Así te llegan los avisos de tus reservas y podés recuperar la cuenta. Podés seguir usando TURNUP mientras tanto.</p>
          <ActionForm action={resendVerificationAction} submitLabel="Enviarme el enlace" variant="secondary" small />
        </div>
      ) : null}
      {tenants.length || user.platformRole === "SUPERADMIN" ? (
        <Link className={styles.rowLink} href={user.platformRole === "SUPERADMIN" ? "/admin" : "/panel"}>
          <span><strong>Ir al panel</strong><span className={ui.faint}>También administrás {user.platformRole === "SUPERADMIN" ? "la plataforma" : tenants.length === 1 ? "un complejo" : "complejos"}</span></span>
          <span aria-hidden>›</span>
        </Link>
      ) : null}

      <section className={styles.section} aria-labelledby="datos">
        <div className={styles.sectionHead}><h2 id="datos">Mis datos</h2></div>
        <ActionForm action={updateProfileAction} submitLabel="Guardar cambios" className={ui.stack}>
          <label className={ui.field}><span className={ui.label}>Nombre y apellido</span><input className={ui.input} name="name" required minLength={2} maxLength={80} defaultValue={user.name} autoComplete="name" /></label>
          <div className={ui.grid2}>
            <label className={ui.field}><span className={ui.label}>Teléfono</span><input className={ui.input} name="phone" type="tel" inputMode="tel" maxLength={30} defaultValue={profile.phone ?? ""} autoComplete="tel" /><span className={ui.hint}>Se precarga al reservar.</span></label>
            <label className={ui.field}><span className={ui.label}>Ciudad</span><input className={ui.input} name="city" maxLength={80} defaultValue={profile.city ?? ""} autoComplete="address-level2" /><span className={ui.hint}>Para sugerirte complejos cercanos.</span></label>
          </div>
          <fieldset className={styles.fieldset}>
            <legend className={ui.label}>Deportes que jugás</legend>
            <div className={styles.toggleChips}>
              {PLAYER_SPORTS.map((s) => (
                <label key={s} className={styles.toggleChip}><input type="checkbox" name="favoriteSports" value={s} defaultChecked={profile.favoriteSports.includes(s)} /><span>{SPORT_LABEL[s]}</span></label>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.fieldset}>
            <legend className={ui.label}>Avisos por email</legend>
            <label className={ui.checkbox}><input type="checkbox" name="notifyEmail" defaultChecked={profile.notifyEmail} /> Confirmaciones, cambios y cancelaciones de mis reservas</label>
            <label className={ui.checkbox}><input type="checkbox" name="notifyReminders" defaultChecked={profile.notifyReminders} /> Recordatorio antes de jugar</label>
            <p className={ui.hint} style={{ margin: 0 }}>Se envían cuando el envío de emails de TURNUP está activo. Los avisos dentro de la app (campana) funcionan siempre. Sin publicidad.</p>
          </fieldset>
        </ActionForm>
      </section>

      <section className={styles.section} aria-labelledby="favs">
        <div className={styles.sectionHead}><h2 id="favs">Complejos favoritos</h2></div>
        {favorites.length ? (
          <ul className={styles.cards}>{favorites.map((c) => <li key={c.id}><ComplexCard c={c} favorite /></li>)}</ul>
        ) : (
          <p className={styles.empty}>Tocá &ldquo;Agregar a favoritos&rdquo; en la página de un complejo para tenerlo a mano.</p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="cuenta">
        <div className={styles.sectionHead}><h2 id="cuenta">Cuenta</h2></div>
        <div className={styles.rowList}>
          <Link className={styles.rowLink} href="/recuperar"><span><strong>Cambiar contraseña</strong><span className={ui.faint}>Te enviamos un enlace por email</span></span><span aria-hidden>›</span></Link>
        </div>
        <div style={{ marginTop: "var(--sp-4)" }}><SignOutButton /></div>
      </section>
    </PlayerShell>
  );
}
