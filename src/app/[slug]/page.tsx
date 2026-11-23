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
  return { title: res.ok ? res.data.tenant.name : "Complejo no disponible" };
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
  const durations = [...new Set(courts.flatMap((c) => c.allowedDurations))].sort((a, b) => a - b);

  return (
    <>
      <TopBar />
      <main className={`${ui.container} ${ui.page}`}>
        <section className={styles.hero}>
          {tenant.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tenant.logoUrl} alt="" className={styles.logo} width={72} height={72} />
          ) : (
            <div className={styles.logoFallback} aria-hidden>
              {tenant.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <h1>{tenant.name}</h1>
            {tenant.description ? <p className={ui.muted}>{tenant.description}</p> : null}
            <p className={ui.muted}>
              {[tenant.address, tenant.contactPhone].filter(Boolean).join(" · ")}
            </p>
          </div>
        </section>

        {courts.length === 0 ? (
          <p className={`${ui.alert} ${ui.alertWarn}`}>Todavía no hay canchas habilitadas para reservar.</p>
        ) : (
          <BookingWidget
            slug={tenant.slug}
            timezone={tenant.timezone}
            today={todayIn(tenant.timezone)}
            maxAdvanceDays={tenant.maxAdvanceDays}
            durations={durations}
            requiresApproval={tenant.bookingRequiresApproval}
          />
        )}
      </main>
    </>
  );
}
