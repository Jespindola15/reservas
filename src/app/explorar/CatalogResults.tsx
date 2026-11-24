"use client";

import { useState } from "react";
import { ComplexCard } from "@/components/player/ComplexCard";
import styles from "@/components/player/player.module.css";
import ui from "@/components/ui.module.css";
import { distanceKm, formatDistance } from "@/lib/geo";
import type { CatalogEntry } from "@/modules/marketplace/catalog";

/**
 * Lista del catálogo con orden por cercanía. La ubicación del jugador se pide SOLO al tocar
 * el botón (permiso del navegador), se usa en este dispositivo y nunca se envía a TURNUP.
 */
export function CatalogResults({ entries, favIds, avail }: { entries: CatalogEntry[]; favIds: string[]; avail: Record<string, number> | null }) {
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [msg, setMsg] = useState("");
  const withCoords = entries.filter((c) => c.latitude !== null && c.longitude !== null).length;
  const dist = (c: CatalogEntry) => (me && c.latitude !== null && c.longitude !== null ? distanceKm(me, { lat: c.latitude, lng: c.longitude }) : null);
  const list = me ? [...entries].sort((a, b) => (dist(a) ?? Infinity) - (dist(b) ?? Infinity)) : entries;

  function locate() {
    if (!("geolocation" in navigator)) return setMsg("Tu navegador no permite usar la ubicación. Elegí la ciudad a mano.");
    setMsg("Pidiendo tu ubicación…");
    navigator.geolocation.getCurrentPosition(
      (p) => { setMe({ lat: p.coords.latitude, lng: p.coords.longitude }); setMsg("Ordenado por cercanía. Tu ubicación no sale de este dispositivo."); },
      () => setMsg("No diste permiso de ubicación. Podés elegir la ciudad a mano."),
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 10_000 },
    );
  }

  return (
    <>
      <div className={ui.row} style={{ margin: "0.6rem 0" }}>
        <p className={ui.muted} role="status" style={{ margin: 0, flex: 1 }}>{entries.length === 1 ? "1 complejo" : `${entries.length} complejos`}</p>
        {withCoords > 0 ? (
          me ? (
            <button type="button" className={`${ui.button} ${ui.buttonGhost} ${ui.buttonSmall}`} onClick={() => { setMe(null); setMsg(""); }}>Quitar orden por cercanía</button>
          ) : (
            <button type="button" className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} onClick={locate}>📍 Ordenar por cercanía</button>
          )
        ) : null}
      </div>
      {msg ? <p className={ui.faint} aria-live="polite" style={{ marginTop: 0 }}>{msg}</p> : null}
      {list.length ? (
        <ul className={styles.cards}>
          {list.map((c) => {
            const d = dist(c);
            return <li key={c.id}><ComplexCard c={c} favorite={favIds.includes(c.id)} freeSlots={avail?.[c.id]} distance={d === null ? undefined : formatDistance(d)} /></li>;
          })}
        </ul>
      ) : null}
    </>
  );
}
