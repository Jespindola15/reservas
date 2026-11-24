"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import ui from "@/components/ui.module.css";
import { MAP_ATTRIBUTION, MAP_TILE_URL } from "@/lib/geo";
import styles from "./map.module.css";

/** Mapa de solo lectura con la ubicación del complejo. Se carga recién al tocar el botón. */
export function MapView({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !box.current) return;
    let cleanup = () => {};
    (async () => {
      const L = (await import("leaflet")).default;
      if (!box.current) return;
      const map = L.map(box.current, { scrollWheelZoom: false }).setView([lat, lng], 16);
      L.tileLayer(MAP_TILE_URL, { maxZoom: 19, attribution: MAP_ATTRIBUTION }).addTo(map);
      const icon = L.divIcon({ className: styles.pin, html: "<span></span>", iconSize: [28, 28], iconAnchor: [14, 28] });
      L.marker([lat, lng], { icon, title: label }).addTo(map);
      cleanup = () => map.remove();
    })();
    return () => cleanup();
  }, [open, lat, lng, label]);
  return open ? (
    <div ref={box} className={styles.map} role="region" aria-label={`Mapa con la ubicación de ${label}`} />
  ) : (
    <button type="button" className={`${ui.button} ${ui.buttonSecondary} ${ui.buttonSmall}`} onClick={() => setOpen(true)}>Ver en el mapa</button>
  );
}
