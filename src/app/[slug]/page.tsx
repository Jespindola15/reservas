import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import ui from "@/components/ui.module.css";
import { isAppError } from "@/lib/errors";
import { whatsappLink } from "@/lib/contact/whatsapp";
import { formatMoney } from "@/modules/booking/pricing";
import { todayIn } from "@/modules/booking/time";
import { getPublicTenantProfile } from "@/modules/tenant/public";
import { BookingWidget } from "./BookingWidget";
import styles from "./public.module.css";

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  try {
    return { ok: true as const, data: await getPublicTenantProfile(slug) };
  } catch (e) {
    if (isAppError(e) && e.code === "TENANT_NOT_FOUND") notFound();
    if (isAppError(e) && e.code === "TENANT_SUSPENDED") return { ok: false as const };
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const res = await load(slug);
  if (!res.ok) return { title: "Complejo no disponible" };
  const t = res.data.tenant;
  return {
    title: `${t.name} — Reservá tu turno`,
    description: t.description ?? `Reservá tu cancha en ${t.name} online, sin crear cuenta.`,
    openGraph: res.data.coverId ? { images: [`/api/public/${t.slug}/assets/${res.data.coverId}`] } : undefined,
  };
}

export default async function TenantPublicPage({ params }: Props) {
  const { slug } = await params;
  const res = await load(slug);

  if (!res.ok) {
    return (
      <>
        <TopBar />
        <main className={`${ui.container} ${ui.page}`}>
          <p className={`${ui.alert} ${ui.alertWarn}`}>Este complejo no está recibiendo reservas en este momento.</p>
        </main>
      </>
    );
  }

  const { tenant, courts, logoId, coverId, galleryIds } = res.data;
  const asset = (id: string) => `/api/public/${tenant.slug}/assets/${id}`;
  const wa = whatsappLink(tenant.whatsapp ?? tenant.contactPhone, `Hola ${tenant.name}, quería consultar por un turno.`);
  const maps = tenant.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${tenant.address}`)}` : null;
  const brand = brandVars(tenant.brandColor);
  const SPORT: Record<string, string> = { FOOTBALL_5: "Fútbol 5", FOOTBALL_7: "Fútbol 7", FOOTBALL_8: "Fútbol 8", FOOTBALL_11: "Fútbol 11", PADEL: "Pádel", OTHER: "Otros deportes" };
  const sports = [...new Set(courts.map((c) => SPORT[c.sport] ?? c.sport))];

  return (
    <>
      <TopBar />
      <main style={brand}>
        <section className={styles.hero}>
          {coverId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={styles.cover} src={asset(coverId)} alt="" width={1600} height={600} fetchPriority="high" />
          ) : null}
          <div className={`${ui.container} ${styles.heroInner}`}>
            {logoId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.logo} src={asset(logoId)} alt={`Logo de ${tenant.name}`} width={76} height={76} />
            ) : (
              <div className={styles.logoFallback} aria-hidden>{tenant.name.slice(0, 1).toUpperCase()}</div>
            )}
            <div className={styles.heroText}>
              <p className={ui.eyebrow}>Reservá online{sports.length ? ` · ${sports.join(" y ")}` : ""}</p>
              <h1>{tenant.name}</h1>
              {tenant.description ? <p className={styles.lead}>{tenant.description}</p> : null}
              <p className={ui.muted}>{[tenant.address, tenant.contactPhone].filter(Boolean).join(" · ")}</p>
              <div className={styles.contactRow}>
                {wa ? <a className={styles.contactLink} href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a> : null}
                {maps ? <a className={styles.contactLink} href={maps} target="_blank" rel="noopener noreferrer">Cómo llegar</a> : null}
                {tenant.instagram ? <a className={styles.contactLink} href={`https://instagram.com/${encodeURIComponent(tenant.instagram)}`} target="_blank" rel="noopener noreferrer">Instagram</a> : null}
                {tenant.facebook ? <a className={styles.contactLink} href={`https://facebook.com/${encodeURIComponent(tenant.facebook)}`} target="_blank" rel="noopener noreferrer">Facebook</a> : null}
                {tenant.website ? <a className={styles.contactLink} href={tenant.website} target="_blank" rel="noopener noreferrer nofollow">Sitio web</a> : null}
              </div>
            </div>
          </div>
        </section>
        <div className={`${ui.container} ${ui.page}`}>
          {tenant.services.length || courts.some((c) => c.fromPrice !== null) ? (
            <section className={styles.infoGrid} aria-label="Información del complejo">
              {tenant.services.length ? (
                <div className={ui.card}>
                  <h2 className={styles.infoTitle}>Servicios</h2>
                  <ul className={styles.services}>{tenant.services.map((s) => <li key={s}>{s}</li>)}</ul>
                </div>
              ) : null}
              {courts.some((c) => c.fromPrice !== null) ? (
                <div className={ui.card}>
                  <h2 className={styles.infoTitle}>Canchas y precios</h2>
                  <ul className={styles.priceList}>
                    {courts.map((c) => (
                      <li key={c.id}><span>{c.name} <span className={ui.faint}>· {SPORT[c.sport] ?? c.sport}</span></span><strong>{c.fromPrice !== null ? `desde ${formatMoney(c.fromPrice, tenant.currency)}` : "a confirmar"}</strong></li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}
          {courts.length === 0 ? (
            <p className={`${ui.alert} ${ui.alertWarn}`}>Todavía no hay canchas habilitadas para reservar.</p>
          ) : (
            <BookingWidget
              slug={tenant.slug}
              timezone={tenant.timezone}
              today={todayIn(tenant.timezone)}
              maxAdvanceDays={tenant.maxAdvanceDays}
              requiresApproval={tenant.bookingRequiresApproval}
              courts={courts.map((c) => ({
                id: c.id,
                name: c.name,
                sport: c.sport,
                description: c.description,
                capacity: c.capacity,
                durations: c.allowedDurations,
                imageId: c.images[0]?.id ?? null,
              }))}
              cancellationPolicy={tenant.cancellationPolicy}
              cancellationMinutes={tenant.publicCancellationMinutes}
              tenantName={tenant.name}
            />
          )}
          {galleryIds.length ? (
            <section aria-labelledby="galeria" style={{ marginTop: "1.5rem" }}>
              <h2 id="galeria" className={styles.infoTitle}>Fotos</h2>
              <div className={styles.gallery}>
                {galleryIds.map((id, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={id} src={asset(id)} alt={`Foto ${i + 1} de ${tenant.name}`} loading="lazy" width={400} height={300} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </main>
    </>
  );
}

/** Color de marca del complejo como acento SOLO dentro de su página (el resto de TURNUP no cambia). */
function brandVars(hex: string | null): React.CSSProperties | undefined {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return undefined;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lum(r!) + 0.7152 * lum(g!) + 0.0722 * lum(b!);
  return {
    "--lime": hex,
    "--lime-strong": hex,
    "--lime-soft": `rgb(${r} ${g} ${b} / 14%)`,
    "--on-lime": L > 0.35 ? "#0b0f0a" : "#ffffff",
  } as React.CSSProperties;
}
