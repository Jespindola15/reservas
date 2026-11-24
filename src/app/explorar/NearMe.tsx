"use client";

import { useRouter } from "next/navigation";
import ui from "@/components/ui.module.css";

/** Ubicación MANUAL: elegir ciudad. (El orden por cercanía con permiso está en CatalogResults.) */
export function NearMe({ cities }: { cities: string[] }) {
  const router = useRouter();
  if (cities.length < 2) return null;
  return (
    <label className={ui.field} style={{ maxWidth: 260, marginTop: "0.4rem" }}>
      <span className="sr-only">Elegí tu ciudad</span>
      <select className={ui.select} defaultValue="" onChange={(e) => e.target.value && router.push(`/explorar?ciudad=${encodeURIComponent(e.target.value)}`)}>
        <option value="">📍 Elegí tu ciudad</option>
        {cities.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  );
}
