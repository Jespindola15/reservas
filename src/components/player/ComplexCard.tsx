import Link from "next/link";
import { formatMoney } from "@/modules/booking/pricing";
import type { CatalogEntry } from "@/modules/marketplace/catalog";
import styles from "./player.module.css";

export const SPORT_LABEL: Record<string, string> = { FOOTBALL_5: "Fútbol 5", FOOTBALL_7: "Fútbol 7", FOOTBALL_8: "Fútbol 8", FOOTBALL_11: "Fútbol 11", PADEL: "Pádel", OTHER: "Otros" };

export function ComplexCard({ c, freeSlots, favorite = false, distance }: { c: CatalogEntry; freeSlots?: number; favorite?: boolean; distance?: string }) {
  const asset = (id: string) => `/api/public/${c.slug}/assets/${id}`;
  return (
    <Link href={`/${c.slug}?desde=marketplace`} className={styles.card}>
      {c.coverAssetId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.cardCover} src={asset(c.coverAssetId)} alt="" loading="lazy" width={480} height={270} />
      ) : (
        <span className={styles.cardCoverEmpty} aria-hidden />
      )}
      <span className={styles.cardBody}>
        {c.logoAssetId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.cardLogo} src={asset(c.logoAssetId)} alt="" width={44} height={44} loading="lazy" />
        ) : (
          <span className={styles.cardLogo} aria-hidden>{c.name.slice(0, 1).toUpperCase()}</span>
        )}
        <span className={styles.cardText}>
          <strong>{c.name}{favorite ? <span className="sr-only"> (favorito)</span> : null}</strong>
          <span className={styles.meta}>{[c.address, c.city, c.province].filter(Boolean).join(" · ") || "Ubicación a confirmar"}</span>
          <span className={styles.meta}>
            {c.ratingAvg !== null ? <><span className={styles.rating}>★ {c.ratingAvg.toFixed(1)}</span> ({c.ratingCount}) · </> : null}
            {c.minHourPrice !== null ? <span className={styles.price}>desde {formatMoney(c.minHourPrice, c.currency)}/h</span> : "Precio a consultar"}
          </span>
          <span className={styles.badgeRow}>
            {[...new Set(c.sports.map((s) => SPORT_LABEL[s] ?? s))].map((s) => <span key={s} className={styles.badge}>{s}</span>)}
            {c.hasCovered ? <span className={styles.badge}>Techada</span> : null}
            {favorite ? <span className={styles.badgeLime}>♥ Favorito</span> : null}
            {distance ? <span className={styles.badgeLime}>📍 a {distance}</span> : null}
            {freeSlots !== undefined ? <span className={freeSlots > 0 ? styles.badgeLime : styles.badge}>{freeSlots > 0 ? `${freeSlots} turnos libres` : "Sin turnos libres"}</span> : null}
          </span>
        </span>
      </span>
    </Link>
  );
}
