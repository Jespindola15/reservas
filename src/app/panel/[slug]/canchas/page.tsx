import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { formatMoney } from "@/modules/booking/pricing";
import { minutesToHHMM } from "@/modules/booking/time";
import { listCourtsAdmin, SPORT_LABEL } from "@/modules/courts/service";
import { createCourtAction } from "../config-actions";
import { CourtFields } from "./CourtFields";
import styles from "./courts.module.css";

export const metadata: Metadata = { title: "Canchas" };
const DAYS = ["L", "M", "X", "J", "V", "S", "D"];

export default async function CourtsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await requireTenantPage(slug, "court.manage");
  if (!access) notFound();
  const courts = await listCourtsAdmin(access.ctx);

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Configuración</p>
          <h1>Canchas y precios</h1>
        </div>
      </header>

      {courts.length === 0 ? <p className={ui.empty}>Todavía no cargaste canchas. Creá la primera abajo.</p> : null}

      <div className={styles.grid}>
        {courts.map((c) => {
          const days = new Set(c.scheduleRules.map((r) => r.weekday));
          const first = c.scheduleRules[0];
          return (
            <Link key={c.id} href={`/panel/${slug}/canchas/${c.id}`} className={styles.courtCard}>
              <div className={styles.thumb}>
                {c.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/public/${slug}/courts/${c.id}/images/${c.images[0].id}`} alt="" loading="lazy" />
                ) : (
                  <span aria-hidden>{SPORT_LABEL[c.sport].slice(0, 1)}</span>
                )}
              </div>
              <div className={styles.courtBody}>
                <div className={ui.spread}>
                  <strong>{c.name}</strong>
                  <span className={`${ui.badge} ${c.isActive ? ui.badgeCONFIRMED : ui.badgeEXPIRED}`}>{c.isActive ? "Activa" : "Inactiva"}</span>
                </div>
                <span className={ui.muted}>
                  {SPORT_LABEL[c.sport]}
                  {c.capacity ? ` · ${c.capacity} jugadores` : ""} · {c.allowedDurations.join("/")} min
                </span>
                <div className={styles.days} aria-label="Días abiertos">
                  {DAYS.map((d, i) => (
                    <span key={d} className={days.has(i + 1) ? styles.dayOn : styles.dayOff}>{d}</span>
                  ))}
                </div>
                <span className={ui.faint}>
                  {first ? `${minutesToHHMM(first.openMinute)}–${minutesToHHMM(first.closeMinute)}` : "Sin horario: no ofrece turnos"}
                  {" · "}
                  {c.basePrice != null ? `Base ${formatMoney(c.basePrice, "ARS")}/h` : `${c._count.priceRules} tarifas`}
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      <section className={ui.card} style={{ marginTop: "1.5rem" }} aria-labelledby="nueva">
        <div className={ui.cardHeader}>
          <h2 id="nueva">Nueva cancha</h2>
          <span className={ui.muted}>Después vas a poder cargar horarios, tarifas e imágenes.</span>
        </div>
        <ActionForm action={createCourtAction.bind(null, slug)} submitLabel="Crear cancha" pendingLabel="Creando…" className={ui.stack}>
          <CourtFields />
        </ActionForm>
      </section>
    </>
  );
}
