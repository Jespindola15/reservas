"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import ui from "@/components/ui.module.css";
import { MAP_ATTRIBUTION, MAP_TILE_URL } from "@/lib/geo";
import styles from "./map.module.css";

type Point = { lat: number; lng: number };
const ARGENTINA: Point = { lat: -34.6037, lng: -58.3816 };

/**
 * Selector de ubicación del complejo: buscar la dirección (Nominatim, a pedido) y ajustar el
 * marcador arrastrándolo o tocando el mapa. Escribe latitud/longitud en campos ocultos del
 * formulario que lo contiene. El mapa (Leaflet + OpenStreetMap) se carga solo al abrirlo.
 */
export function LocationPicker({ initial, defaultQuery }: { initial: Point | null; defaultQuery: string }) {
  const [point, setPoint] = useState<Point | null>(initial);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(defaultQuery);
  const [results, setResults] = useState<{ lat: number; lng: number; label: string }[]>([]);
  const [msg, setMsg] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<{ setView: (p: Point) => void } | null>(null);

  useEffect(() => {
    if (!open || !box.current) return;
    let cleanup = () => {};
    (async () => {
      const L = (await import("leaflet")).default;
      if (!box.current) return;
      const start = point ?? ARGENTINA;
      const map = L.map(box.current, { scrollWheelZoom: false }).setView([start.lat, start.lng], point ? 16 : 11);
      L.tileLayer(MAP_TILE_URL, { maxZoom: 19, attribution: MAP_ATTRIBUTION }).addTo(map);
      const icon = L.divIcon({ className: styles.pin, html: "<span></span>", iconSize: [28, 28], iconAnchor: [14, 28] });
      const marker = L.marker([start.lat, start.lng], { draggable: true, icon, keyboard: true, title: "Ubicación del complejo" }).addTo(map);
      const set = (p: Point) => {
        marker.setLatLng([p.lat, p.lng]);
        setPoint({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 });
      };
      marker.on("dragend", () => set(marker.getLatLng()));
      map.on("click", (e: { latlng: Point }) => set(e.latlng));
      api.current = { setView: (p) => { map.setView([p.lat, p.lng], 17); set(p); } };
      cleanup = () => { map.remove(); api.current = null; };
    })();
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- el mapa se crea una sola vez al abrirlo
  }, [open]);

  async function search() {
    setMsg("Buscando…");
    setResults([]);
    try {
      const res = await fetch(`/api/panel/geocode?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) return setMsg(json?.error?.message ?? "No se pudo buscar la dirección.");
      if (!json.results.length) return setMsg("No encontramos esa dirección. Probá con calle, número y ciudad, o ubicá el marcador a mano.");
      setResults(json.results);
      setMsg("");
      if (!open) setOpen(true);
      setTimeout(() => api.current?.setView(json.results[0]), 300);
    } catch {
      setMsg("No se pudo buscar la dirección. Ubicá el marcador a mano.");
    }
  }

  return (
    <div className={ui.stackSm}>
      <input type="hidden" name="latitude" value={point?.lat ?? ""} />
      <input type="hidden" name="longitude" value={point?.lng ?? ""} />
      <div className={ui.row}>
        <label className={ui.field} style={{ flex: 1, minWidth: 220 }}>
          <span className={ui.label}>Buscar en el mapa</span>
          <input className={ui.input} value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} placeholder="Calle 123, Ciudad, Provincia"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }} />
        </label>
        <button type="button" className={`${ui.button} ${ui.buttonSecondary}`} onClick={search} disabled={q.trim().length < 4} style={{ alignSelf: "end" }}>Buscar dirección</button>
        <button type="button" className={`${ui.button} ${ui.buttonGhost}`} onClick={() => setOpen((v) => !v)} style={{ alignSelf: "end" }}>{open ? "Ocultar mapa" : "Abrir mapa"}</button>
      </div>
      <span role="status" className={ui.faint}>{msg}</span>
      {results.length > 1 ? (
        <ul className={styles.results}>
          {results.map((r) => (
            <li key={`${r.lat},${r.lng}`}><button type="button" className={ui.linkPlain} onClick={() => api.current?.setView(r)}>{r.label}</button></li>
          ))}
        </ul>
      ) : null}
      {open ? <div ref={box} className={styles.map} aria-label="Mapa: tocá o arrastrá el marcador para ubicar el complejo" /> : null}
      <span className={ui.hint}>
        {point ? `Ubicación elegida: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}. ` : "Sin ubicación en el mapa todavía. "}
        Los jugadores la usan para ordenar por distancia y para &ldquo;Cómo llegar&rdquo;.
        {point ? <> <button type="button" className={ui.linkPlain} onClick={() => setPoint(null)}>Quitar ubicación</button></> : null}
      </span>
    </div>
  );
}
