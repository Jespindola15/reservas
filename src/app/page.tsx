import Link from "next/link";
import { unstable_cache } from "next/cache";
import { TopBar } from "@/components/TopBar";
import ui from "@/components/ui.module.css";
import { logger } from "@/lib/logger";
import { listPublicDirectory, type DirectoryEntry } from "@/modules/tenant/branding";
import styles from "./home.module.css";

// El listado se guarda en caché 10 minutos (y se invalida al cambiar la página de
// un complejo): la portada no consulta la base en cada visita ni la mantiene despierta.
// Solo contiene datos públicos, iguales para todos los visitantes.
const cachedDirectory = unstable_cache(() => listPublicDirectory(60), ["public-directory"], { revalidate: 600, tags: ["public-directory"] });

const SPORT: Record<string, string> = { FOOTBALL_5: "Fútbol 5", FOOTBALL_7: "Fútbol 7", FOOTBALL_8: "Fútbol 8", FOOTBALL_11: "Fútbol 11", PADEL: "Pádel", OTHER: "Otros" };

async function directory(): Promise<DirectoryEntry[]> {
  try {
    return await cachedDirectory();
  } catch (e) {
    // Sin base (p. ej. durante el build) la portada igual se muestra.
    logger.warn("home.directory.unavailable", { err: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

const FEATURES = [
  { t: "Cero turnos duplicados", d: "La base de datos garantiza que una cancha nunca se reserve dos veces, aunque 100 personas reserven al mismo tiempo." },
  { t: "Tu página de reservas", d: "Cada complejo tiene su página: deporte, cancha, fecha, horario y precio real antes de confirmar." },
  { t: "Calendario del día", d: "Columnas por cancha, estados con color, bloqueos y carga manual en un toque, desde la compu o el celular." },
  { t: "Solicitudes que vencen solas", d: "Si no aprobás una solicitud a tiempo, el turno se libera automáticamente." },
];

export default async function Home() {
  const complexes = await directory();
  return (
    <>
      <TopBar>
        <Link href="/login" className={`${ui.button} ${ui.buttonSmall}`}>Ingresar</Link>
      </TopBar>
      <main>
        <section className={styles.hero}>
          <div className={ui.container}>
            <p className={ui.eyebrow}>Fútbol 5 · 7 · 11 · Pádel</p>
            <h1 className={styles.title}>
              Llená tus canchas.<br />
              <span>Sin planillas, sin superposiciones.</span>
            </h1>
            <p className={styles.lead}>
              TURNUP es la plataforma para complejos deportivos: reservas online, calendario, precios por franja y
              clientes, en un solo lugar.
            </p>
            <div className={ui.row}>
              <Link href="/login" className={ui.button}>Ingresar al panel</Link>
              {complexes.length ? <a href="#complejos" className={`${ui.button} ${ui.buttonSecondary}`}>Ver complejos para reservar</a> : null}
            </div>
          </div>
        </section>
        {complexes.length ? (
          <section id="complejos" className={`${ui.container} ${styles.directory}`} aria-labelledby="complejos-titulo">
            <h2 id="complejos-titulo">Complejos para reservar</h2>
            <p className={ui.muted}>Elegí un complejo y reservá online, sin crear cuenta.</p>
            <ul className={styles.dirGrid}>
              {complexes.map((c) => (
                <li key={c.slug}>
                  <Link href={`/${c.slug}`} className={styles.dirCard}>
                    {c.logoAssetId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/public/${c.slug}/assets/${c.logoAssetId}`} alt="" width={56} height={56} className={styles.dirLogo} loading="lazy" />
                    ) : (
                      <span className={styles.dirLogo} aria-hidden>{c.name.slice(0, 1).toUpperCase()}</span>
                    )}
                    <span className={styles.dirText}>
                      <strong>{c.name}</strong>
                      {c.address ? <span className={ui.faint}>{c.address}</span> : null}
                      <span className={ui.muted}>{c.sports.map((s) => SPORT[s] ?? s).join(" · ")} · {c.courtCount} {c.courtCount === 1 ? "cancha" : "canchas"}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className={`${ui.container} ${styles.features}`}>
          {FEATURES.map((f) => (
            <article key={f.t} className={ui.card}>
              <h2>{f.t}</h2>
              <p className={ui.muted}>{f.d}</p>
            </article>
          ))}
        </section>
      </main>
    </>
  );
}
