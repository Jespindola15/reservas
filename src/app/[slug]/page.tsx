import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import ui from "@/components/ui.module.css";
import { isAppError } from "@/lib/errors";
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
  return { title: res.ok ? `${res.data.tenant.name} — Reservá tu turno` : "Complejo no disponible" };
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

  const { tenant, courts } = res.data;

  return (
    <>
      <TopBar />
      <main>
        <section className={styles.hero}>
          <div className={`${ui.container} ${styles.heroInner}`}>
            <div className={styles.logoFallback} aria-hidden>{tenant.name.slice(0, 1).toUpperCase()}</div>
            <div className={styles.heroText}>
              <p className={ui.eyebrow}>Reservá online</p>
              <h1>{tenant.name}</h1>
              {tenant.description ? <p className={styles.lead}>{tenant.description}</p> : null}
              <p className={ui.muted}>{[tenant.address, tenant.contactPhone].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
        </section>
        <div className={`${ui.container} ${ui.page}`}>
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
            />
          )}
        </div>
      </main>
    </>
  );
}
