import type { Metadata } from "next";
import Link from "next/link";
import { PlayerShell } from "@/components/player/PlayerShell";
import styles from "@/components/player/player.module.css";
import ui from "@/components/ui.module.css";
import { getCurrentUser } from "@/lib/auth/dal";
import { todayIn } from "@/modules/booking/time";
import { cachedCatalog } from "@/modules/marketplace/cached";
import { availabilityForDate, catalogCities, catalogFilterSchema, filterCatalog, SPORT_GROUP_LABEL, SPORT_GROUPS } from "@/modules/marketplace/catalog";
import { listFavoriteTenantIds } from "@/modules/player/favorites";
import { SERVICE_OPTIONS } from "@/modules/tenant/branding";
import { NearMe } from "./NearMe";
import { CatalogResults } from "./CatalogResults";

export const metadata: Metadata = { title: "Explorar complejos — TURNUP" };

type SP = Record<string, string | string[] | undefined>;

export default async function ExplorePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) || undefined;
  const services = ([] as string[]).concat(sp.servicio ?? []).filter((s) => (SERVICE_OPTIONS as readonly string[]).includes(s));
  const f = catalogFilterSchema.parse({
    q: one("q"), ciudad: one("ciudad"), deporte: one("deporte"), precioMax: one("precioMax"),
    servicio: services.length ? services : undefined, techada: one("techada"), fecha: one("fecha"), orden: one("orden"),
  });
  const user = await getCurrentUser().catch(() => null);
  const [all, favIds] = await Promise.all([cachedCatalog(), user ? listFavoriteTenantIds(user.id) : Promise.resolve([] as string[])]);
  let results = filterCatalog(all, f);
  const today = todayIn("America/Argentina/Buenos_Aires");
  // Disponibilidad real para la fecha elegida (solo los primeros 24 resultados, para cuidar la base).
  const avail = f.fecha && f.fecha >= today ? await availabilityForDate(results, f.fecha) : null;
  if (avail) results = results.filter((c) => !avail.has(c.id) || (avail.get(c.id) ?? 0) > 0);
  const cities = catalogCities(all);
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | undefined> = { q: f.q, ciudad: f.ciudad, deporte: f.deporte, precioMax: f.precioMax?.toString(), techada: f.techada, fecha: f.fecha, orden: f.orden, ...patch };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    for (const s of services) p.append("servicio", s);
    return `/explorar?${p.toString()}`;
  };

  return (
    <PlayerShell user={user} wide>
      <h1 className={styles.hello}>Explorar</h1>
      <form method="get" className={ui.stackSm} role="search" aria-label="Filtros de búsqueda">
        <div className={styles.searchRow}>
          <label className="sr-only" htmlFor="q">Buscar por nombre o zona</label>
          <input id="q" name="q" className={ui.input} defaultValue={f.q ?? ""} placeholder="Nombre, barrio o dirección" maxLength={80} style={{ flex: 2 }} />
          <button className={ui.button} type="submit">Buscar</button>
        </div>
        <details>
          <summary className={ui.linkPlain} style={{ cursor: "pointer", fontWeight: 700 }}>Filtros</summary>
          <div className={ui.grid3} style={{ marginTop: "0.7rem" }}>
            <label className={ui.field}><span className={ui.label}>Ciudad</span>
              <select name="ciudad" className={ui.select} defaultValue={f.ciudad ?? ""}>
                <option value="">Todas</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className={ui.field}><span className={ui.label}>Deporte</span>
              <select name="deporte" className={ui.select} defaultValue={f.deporte ?? ""}>
                <option value="">Todos</option>
                {Object.entries(SPORT_GROUP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className={ui.field}><span className={ui.label}>Precio máximo por hora ($)</span>
              <input name="precioMax" type="number" min={1} step={500} inputMode="numeric" className={ui.input} defaultValue={f.precioMax ?? ""} />
            </label>
            <label className={ui.field}><span className={ui.label}>Con turnos libres el día</span>
              <input name="fecha" type="date" min={today} className={ui.input} defaultValue={f.fecha ?? ""} />
            </label>
            <label className={ui.field}><span className={ui.label}>Ordenar por</span>
              <select name="orden" className={ui.select} defaultValue={f.orden ?? "nombre"}>
                <option value="nombre">Nombre</option><option value="precio">Precio</option><option value="valoracion">Valoración</option>
              </select>
            </label>
            <label className={ui.checkbox} style={{ alignSelf: "end" }}><input type="checkbox" name="techada" value="1" defaultChecked={Boolean(f.techada)} /> Canchas techadas</label>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: "0.7rem 0 0" }}>
            <legend className={ui.label}>Prestaciones</legend>
            <div className={ui.grid3}>
              {SERVICE_OPTIONS.map((s) => (
                <label key={s} className={ui.checkbox}><input type="checkbox" name="servicio" value={s} defaultChecked={services.includes(s)} />{s}</label>
              ))}
            </div>
          </fieldset>
          <button className={ui.button} type="submit" style={{ marginTop: "0.7rem" }}>Aplicar filtros</button>
        </details>
      </form>

      <div className={styles.chips} style={{ marginTop: "0.8rem" }} aria-label="Deporte">
        <Link href={qs({ deporte: undefined })} className={!f.deporte ? styles.chipOn : styles.chip}>Todos</Link>
        {Object.entries(SPORT_GROUP_LABEL).filter(([k]) => all.some((c) => c.sports.some((s) => SPORT_GROUPS[k]!.includes(s)))).map(([k, v]) => (
          <Link key={k} href={qs({ deporte: k })} className={f.deporte === k ? styles.chipOn : styles.chip} aria-current={f.deporte === k ? "true" : undefined}>{v}</Link>
        ))}
      </div>
      <NearMe cities={cities} />

      {f.fecha ? <p className={ui.faint} style={{ margin: "0.4rem 0 0" }}>Mostrando complejos con turnos libres el {f.fecha.split("-").reverse().join("/")}.</p> : null}
      <CatalogResults entries={results} favIds={favIds} avail={avail ? Object.fromEntries(avail) : null} />
      {results.length === 0 ? <p className={styles.empty}>No encontramos complejos con esos filtros. <Link href="/explorar">Ver todos</Link></p> : null}
    </PlayerShell>
  );
}
