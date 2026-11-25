import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus, Search } from "lucide-react";
import { StatusBadge } from "@/components/status/StatusBadge";
import { ComplexCard, SPORT_LABEL } from "@/components/player/ComplexCard";
import { PlayerShell } from "@/components/player/PlayerShell";
import styles from "@/components/player/player.module.css";
import ui from "@/components/ui.module.css";
import { getCurrentUser } from "@/lib/auth/dal";
import { cachedAnnouncements, cachedCatalog } from "@/modules/marketplace/cached";
import { catalogCities, SPORT_GROUP_LABEL } from "@/modules/marketplace/catalog";
import { getPlayerProfile } from "@/modules/player/account";
import { listPlayerBookings } from "@/modules/player/bookings";
import { listFavoriteTenantIds } from "@/modules/player/favorites";

export const metadata: Metadata = {
  title: "TURNUP — Encontrá dónde jugar fútbol y pádel",
  description: "Buscá complejos, mirá horarios libres y reservá tu cancha en segundos.",
};

export default async function Home() {
  const user = await getCurrentUser().catch(() => null);
  const [catalog, news] = await Promise.all([cachedCatalog(), cachedAnnouncements()]);
  const [profile, bookings, favIds] = user
    ? await Promise.all([getPlayerProfile(user.id), listPlayerBookings(user.id), listFavoriteTenantIds(user.id)])
    : [null, [], [] as string[]];
  const now = new Date();
  const next = bookings.filter((b) => (b.status === "CONFIRMED" || b.status === "PENDING") && b.endsAt > now).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  const favorites = catalog.filter((c) => favIds.includes(c.id));
  const city = profile?.city ?? null;
  // Destacados: primero los de la ciudad del jugador, luego los mejor valorados (solo valoraciones reales).
  const featured = [...catalog]
    .sort((a, b) => Number(Boolean(city && b.city === city)) - Number(Boolean(city && a.city === city)) || (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0) || b.ratingCount - a.ratingCount)
    .slice(0, 8);
  const cities = catalogCities(catalog);

  return (
    <PlayerShell user={user}>
      <h1 className={styles.hello}>{user ? `Hola, ${user.name.split(" ")[0]}` : "¿Dónde jugamos hoy?"}</h1>
      <p className={ui.muted} style={{ margin: 0 }}>Encontrá cancha, mirá los horarios libres y reservá en segundos.</p>

      <form action="/explorar" method="get" className={styles.searchRow} role="search" aria-label="Buscar complejos">
        <div className={styles.searchBox}>
          <Search size={18} strokeWidth={1.75} aria-hidden />
          <label className="sr-only" htmlFor="q">Buscar complejo</label>
          <input id="q" name="q" className={ui.input} placeholder="Buscar complejo o zona" maxLength={80} />
        </div>
        {cities.length > 1 ? (
          <>
            <label className="sr-only" htmlFor="ciudad">Ciudad</label>
            <select id="ciudad" name="ciudad" className={ui.select} defaultValue={city && cities.includes(city) ? city : ""}>
              <option value="">Todas las ciudades</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </>
        ) : null}
        <button className={ui.button} type="submit">Buscar</button>
      </form>
      <div className={styles.chips} style={{ marginTop: "0.6rem" }} aria-label="Deportes">
        {Object.entries(SPORT_GROUP_LABEL).filter(([k]) => k !== "otros" || catalog.some((c) => c.sports.includes("OTHER"))).map(([k, v]) => (
          <Link key={k} href={`/explorar?deporte=${k}`} className={styles.chip}>{v}</Link>
        ))}
      </div>

      {next ? (
        <section className={styles.section} aria-labelledby="proxima">
          <div className={styles.sectionHead}><h2 id="proxima">Tu próximo turno</h2><Link href="/mis-turnos">Ver todos</Link></div>
          <Link href="/mis-turnos" className={styles.next}>
            <span className={styles.nextDate}>
              <small>{next.startsAt.toLocaleDateString("es-AR", { weekday: "short", timeZone: next.tenantTimezone })}</small>
              {next.startsAt.toLocaleDateString("es-AR", { day: "numeric", timeZone: next.tenantTimezone })}
            </span>
            <span>
              <strong>{next.tenantName}</strong>
              <span className={styles.meta} style={{ display: "block" }}>
                {next.startsAt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: next.tenantTimezone })} hs · {next.courtName} · {SPORT_LABEL[next.sport] ?? next.sport}
              </span>
              <span style={{ display: "block", marginTop: 6 }}><StatusBadge status={next.status} paymentStatus={next.paymentStatus} /></span>
            </span>
          </Link>
        </section>
      ) : null}

      <section className={styles.section}>
        <Link href="/explorar" className={styles.cta}><CalendarPlus size={20} strokeWidth={1.75} aria-hidden />Reservar una cancha</Link>
      </section>

      {favorites.length ? (
        <section className={styles.section} aria-labelledby="favoritos">
          <div className={styles.sectionHead}><h2 id="favoritos">Tus favoritos</h2></div>
          <ul className={styles.rail}>{favorites.map((c) => <li key={c.id}><ComplexCard c={c} favorite /></li>)}</ul>
        </section>
      ) : null}

      {news.length ? (
        <section className={styles.section} aria-labelledby="novedades">
          <div className={styles.sectionHead}><h2 id="novedades">Novedades y promociones</h2></div>
          <ul className={styles.turns}>
            {news.map((n) => (
              <li key={n.slug}>
                <Link href={`/${n.slug}?desde=marketplace`} className={styles.turn} style={{ textDecoration: "none", color: "inherit" }}>
                  <strong>{n.name}{n.city ? <span className={styles.meta}> · {n.city}</span> : null}</strong>
                  <span>{n.text}</span>
                  {n.until ? <span className={styles.meta}>Válido hasta el {n.until.toISOString().slice(0, 10).split("-").reverse().join("/")}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="destacados">
        <div className={styles.sectionHead}><h2 id="destacados">Complejos destacados</h2><Link href="/explorar">Explorar todos</Link></div>
        {featured.length ? (
          <ul className={styles.rail}>{featured.map((c) => <li key={c.id}><ComplexCard c={c} favorite={favIds.includes(c.id)} /></li>)}</ul>
        ) : (
          <p className={styles.empty}>Todavía no hay complejos publicados. ¡Volvé pronto!</p>
        )}
      </section>

      <section className={styles.section}>
        <p className={ui.faint} style={{ textAlign: "center" }}>
          ¿Tenés un complejo? <Link href="/para-complejos">Conocé TURNUP para complejos</Link>
        </p>
      </section>
    </PlayerShell>
  );
}
