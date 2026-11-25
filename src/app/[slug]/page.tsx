import type { Metadata } from "next";
import { fmtDate } from "@/lib/format";
import { MapPin, MessageCircle, Phone } from "lucide-react";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { ActionForm } from "@/components/ActionForm";
import { PlayerShell } from "@/components/player/PlayerShell";
import { getCurrentUser } from "@/lib/auth/dal";
import { trackProfileView } from "@/modules/marketplace/catalog";
import { listFavoriteTenantIds } from "@/modules/player/favorites";
import { listPublicReviews } from "@/modules/player/reviews";
import { reportReviewAction, toggleFavoriteAction } from "../cuenta/actions";
import ui from "@/components/ui.module.css";
import { isAppError } from "@/lib/errors";
import { whatsappLink } from "@/lib/contact/whatsapp";
import { directionsUrl } from "@/lib/geo";
import { MapView } from "@/components/map/MapView";
import { formatMoney } from "@/modules/booking/pricing";
import { todayIn } from "@/modules/booking/time";
import { getPublicTenantProfile } from "@/modules/tenant/public";
import { BookingWidget } from "./BookingWidget";
import styles from "./public.module.css";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ desde?: string }> };

const SURFACE: Record<string, string> = { SINTETICO: "Césped sintético", CESPED: "Césped natural", CEMENTO: "Cemento", PARQUET: "Parquet", POLVO_LADRILLO: "Polvo de ladrillo", OTRA: "Otra superficie" };

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

export default async function TenantPublicPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { desde } = await searchParams;
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

  const { tenant, courts, logoId, coverId, galleryIds, transferReady } = res.data;
  const user = await getCurrentUser().catch(() => null);
  const [reviews, favIds] = await Promise.all([listPublicReviews(tenant.slug, 20), user ? listFavoriteTenantIds(user.id) : Promise.resolve([] as string[])]);
  const isFavorite = favIds.includes(tenant.id);
  const ratingAvg = reviews.length ? reviews.reduce((a, r) => a + r.rating, 0) / reviews.length : null;
  // Contador de visitas (sin IP ni datos personales); un fallo nunca rompe la página.
  await trackProfileView(tenant.slug).catch(() => undefined);
  const deposit =
    tenant.depositType === "PERCENT" && tenant.depositValue > 0
      ? `Seña del ${tenant.depositValue} % del turno.`
      : tenant.depositType === "FIXED" && tenant.depositValue > 0
        ? `Seña de ${formatMoney(tenant.depositValue, tenant.currency)}.`
        : tenant.depositType === "FULL"
          ? "Se transfiere el total del turno al reservar."
          : null;
  const asset = (id: string) => `/api/public/${tenant.slug}/assets/${id}`;
  const wa = whatsappLink(tenant.whatsapp ?? tenant.contactPhone, `Hola ${tenant.name}, quería consultar por un turno.`);
  const maps = directionsUrl(tenant);
  const brand = brandVars(tenant.brandColor);
  const SPORT: Record<string, string> = { FOOTBALL_5: "Fútbol 5", FOOTBALL_7: "Fútbol 7", FOOTBALL_8: "Fútbol 8", FOOTBALL_11: "Fútbol 11", PADEL: "Pádel", OTHER: "Otros deportes" };
  const sports = [...new Set(courts.map((c) => SPORT[c.sport] ?? c.sport))];

  return (
      <PlayerShell user={user} wide>
      <div style={brand} className={styles.fichaWrap}>
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
              <p className={ui.muted}>{[tenant.address, tenant.city, tenant.province, tenant.contactPhone].filter(Boolean).join(" · ")}</p>
              {ratingAvg !== null ? (
                <p className={styles.ratingLine}><strong>★ {ratingAvg.toFixed(1)}</strong> <a href="#opiniones">{reviews.length} {reviews.length === 1 ? "opinión verificada" : "opiniones verificadas"}</a></p>
              ) : null}
              <div className={styles.contactRow}>
                {wa ? <a className={styles.contactLink} href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} strokeWidth={1.75} aria-hidden />WhatsApp</a> : null}
                {maps ? <a className={styles.contactLink} href={maps} target="_blank" rel="noopener noreferrer"><MapPin size={16} strokeWidth={1.75} aria-hidden />Cómo llegar</a> : null}
                {tenant.instagram ? <a className={styles.contactLink} href={`https://instagram.com/${encodeURIComponent(tenant.instagram)}`} target="_blank" rel="noopener noreferrer">Instagram</a> : null}
                {tenant.facebook ? <a className={styles.contactLink} href={`https://facebook.com/${encodeURIComponent(tenant.facebook)}`} target="_blank" rel="noopener noreferrer">Facebook</a> : null}
                {tenant.website ? <a className={styles.contactLink} href={tenant.website} target="_blank" rel="noopener noreferrer nofollow">Sitio web</a> : null}
                {tenant.contactPhone ? <a className={styles.contactLink} href={`tel:${tenant.contactPhone.replace(/[^0-9+]/g, "")}`}><Phone size={16} strokeWidth={1.75} aria-hidden />Llamar</a> : null}
                {user ? (
                  <ActionForm action={toggleFavoriteAction.bind(null, tenant.slug)} submitLabel={isFavorite ? "♥ En favoritos" : "♡ Agregar a favoritos"} variant={isFavorite ? "primary" : "secondary"} small quietSuccess />
                ) : null}
              </div>
            </div>
          </div>
        </section>
        <div className={`${ui.container} ${ui.page}`}>
          <div className={styles.fichaGrid}>
            <div className={styles.bookCol}>
          <div id="reservar" />
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
                surface: c.surface,
                covered: c.covered,
                dimensions: c.dimensions,
                lighting: c.lighting,
              }))}
              cancellationPolicy={tenant.cancellationPolicy}
              cancellationMinutes={tenant.publicCancellationMinutes}
              tenantName={tenant.name}
              tenantAddress={[tenant.address, tenant.city].filter(Boolean).join(", ") || null}
              currency={tenant.currency}
              deposit={{ type: tenant.depositType as "NONE" | "PERCENT" | "FIXED" | "FULL", value: tenant.depositValue, note: tenant.depositNote }}
              transferReady={transferReady}
              origin={desde === "marketplace" ? "MARKETPLACE" : "DIRECT"}
              player={user ? { name: user.name, email: user.email } : null}
            />
          )}
            </div>
            <aside className={styles.side} aria-label="Información del complejo">
          {tenant.services.length || courts.length ? (
            <section className={styles.infoGrid} aria-label="Información del complejo">
              {tenant.services.length ? (
                <div className={ui.card}>
                  <h2 className={styles.infoTitle}>Servicios</h2>
                  <ul className={styles.services}>{tenant.services.map((s) => <li key={s}>{s}</li>)}</ul>
                </div>
              ) : null}
              {courts.length ? (
                <div className={ui.card}>
                  <h2 className={styles.infoTitle}>Canchas y precios</h2>
                  <ul className={styles.priceList}>
                    {courts.map((c) => (
                      <li key={c.id}>
                        <span>
                          {c.name} <span className={ui.faint}>· {SPORT[c.sport] ?? c.sport}</span>
                          <span className={styles.courtFeatures}>
                            {[c.surface ? SURFACE[c.surface] : null, c.covered === true ? "Techada" : c.covered === false ? "Descubierta" : null, c.dimensions, c.lighting ? "Iluminación" : null, c.capacity ? `${c.capacity} por equipo` : null].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <strong>{c.fromPrice !== null ? `desde ${formatMoney(c.fromPrice, tenant.currency)} el turno` : "a confirmar"}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}
          {deposit || tenant.cancellationPolicy ? (
            <section className={ui.card} aria-labelledby="politicas" >
              <h2 id="politicas" className={styles.infoTitle}>Políticas de reserva</h2>
              {deposit ? <p style={{ margin: "0 0 0.4rem" }}><strong>{deposit}</strong> {tenant.depositNote ?? "Se transfiere directo a la cuenta del complejo; TURNUP no recibe ni retiene dinero."}</p> : null}
              {tenant.cancellationPolicy ? <p className={ui.muted} style={{ margin: 0 }}>{tenant.cancellationPolicy}</p> : null}
            </section>
          ) : null}
          {tenant.latitude !== null && tenant.longitude !== null ? (
            <section aria-labelledby="ubicacion-titulo" className={ui.card} >
              <div className={ui.spread}>
                <h2 id="ubicacion-titulo" className={styles.infoTitle} style={{ margin: 0 }}>Ubicación</h2>
                {maps ? <a className={`${ui.button} ${ui.buttonSmall}`} href={maps} target="_blank" rel="noopener noreferrer">Cómo llegar</a> : null}
              </div>
              <p className={ui.muted}>{[tenant.address, tenant.city, tenant.province].filter(Boolean).join(", ")}</p>
              <MapView lat={tenant.latitude} lng={tenant.longitude} label={tenant.name} />
            </section>
          ) : null}
            </aside>
          </div>
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
          <section id="opiniones" aria-labelledby="opiniones-titulo" style={{ marginTop: "1.5rem" }}>
            <h2 id="opiniones-titulo" className={styles.infoTitle}>Opiniones verificadas</h2>
            {reviews.length === 0 ? (
              <p className={ui.muted}>Todavía no hay opiniones. Solo pueden opinar jugadores que reservaron y jugaron acá.</p>
            ) : (
              <ul className={styles.reviews}>
                {reviews.map((r) => (
                  <li key={r.id} className={ui.card}>
                    <div className={ui.spread}>
                      <strong aria-label={`${r.rating} de 5 estrellas`}>{"★".repeat(r.rating)}<span className={ui.faint}>{"★".repeat(5 - r.rating)}</span></strong>
                      <span className={ui.faint}>{r.author} · {fmtDate(r.createdAt, tenant.timezone)}</span>
                    </div>
                    {r.comment ? <p style={{ margin: "0.4rem 0 0" }}>{r.comment}</p> : null}
                    {r.reply ? <p className={styles.reply}><strong>Respuesta del complejo:</strong> {r.reply}</p> : null}
                    {user ? (
                      <details className={ui.faint}>
                        <summary style={{ cursor: "pointer" }}>Denunciar</summary>
                        <ActionForm action={reportReviewAction.bind(null, tenant.slug, r.id)} submitLabel="Enviar denuncia" variant="ghost" small resetOnSuccess>
                          <label className={ui.field}><span className={ui.label}>Motivo</span><input className={ui.input} name="reason" required minLength={3} maxLength={300} /></label>
                        </ActionForm>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      </PlayerShell>
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
