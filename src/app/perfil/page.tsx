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
import { updateProfileAction } from "../cuenta/actions";
import { initials } from "@/components/player/initials";

export const metadata: Metadata = { title: "Mi perfil — TURNUP" };

export default async function ProfilePage() {
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

  return (
    <PlayerShell user={user}>
      <div className={ui.spread}>
        <h1 className={styles.hello}>Hola, {user.name.split(" ")[0]}</h1>
        <SignOutButton />
      </div>
      <p className={ui.muted} style={{ margin: 0 }}>{user.email}</p>
      {tenants.length || user.platformRole === "SUPERADMIN" ? (
        <p className={`${ui.alert} ${ui.alertInfo}`} style={{ marginTop: "0.8rem" }}>
          También administrás {user.platformRole === "SUPERADMIN" ? "la plataforma" : tenants.length === 1 ? "un complejo" : "complejos"}: <Link href={user.platformRole === "SUPERADMIN" ? "/admin" : "/panel"}>ir al panel</Link>
        </p>
      ) : null}

      <section className={styles.section} aria-labelledby="datos">
        <div className={styles.sectionHead}><h2 id="datos">Mis datos</h2></div>
        <div className={ui.row} style={{ alignItems: "center", marginBottom: "0.8rem" }}>
          <span className={styles.avatar} style={{ width: 56, height: 56, fontSize: "1.4rem" }} aria-hidden>{initials(user.name)}</span>
          <span className={ui.faint}>Tu avatar usa tus iniciales. En TURNUP los jugadores no suben fotos personales.</span>
        </div>
        <ActionForm action={updateProfileAction} submitLabel="Guardar cambios" className={ui.stack}>
          <label className={ui.field}><span className={ui.label}>Nombre y apellido</span><input className={ui.input} name="name" required minLength={2} maxLength={80} defaultValue={user.name} /></label>
          <div className={ui.grid2}>
            <label className={ui.field}><span className={ui.label}>Teléfono</span><input className={ui.input} name="phone" type="tel" maxLength={30} defaultValue={profile.phone ?? ""} /></label>
            <label className={ui.field}><span className={ui.label}>Ciudad</span><input className={ui.input} name="city" maxLength={80} defaultValue={profile.city ?? ""} /></label>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className={ui.label}>Deportes favoritos</legend>
            <div className={ui.grid3}>
              {PLAYER_SPORTS.map((s) => (
                <label key={s} className={ui.checkbox}><input type="checkbox" name="favoriteSports" value={s} defaultChecked={profile.favoriteSports.includes(s)} />{SPORT_LABEL[s]}</label>
              ))}
            </div>
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className={ui.label}>Notificaciones</legend>
            <label className={ui.checkbox}><input type="checkbox" name="notifyEmail" defaultChecked={profile.notifyEmail} /> Emails sobre mis reservas (confirmación, cambios, cancelación)</label>
            <label className={ui.checkbox}><input type="checkbox" name="notifyReminders" defaultChecked={profile.notifyReminders} /> Recordatorio antes de jugar</label>
            <span className={ui.faint}>TURNUP no envía publicidad.</span>
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
    </PlayerShell>
  );
}
