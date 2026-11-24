import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { ActionForm } from "@/components/ActionForm";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { publicTenantUrl } from "@/lib/public-url";
import { getOnboarding } from "@/modules/tenant/onboarding";
import { markOnboardingStepAction } from "../config-actions";
import { CopyLink } from "../pagina/CopyLink";
import styles from "./onboarding.module.css";

export const metadata: Metadata = { title: "Puesta en marcha" };

export default async function OnboardingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await requireTenantPage(slug, "tenant.settings");
  if (!access) notFound();
  const o = await getOnboarding(access.ctx);
  const pct = Math.round((o.completed / 7) * 100);
  const url = publicTenantUrl(o.tenant.slug);
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 200 });
  const readyToPublish = o.steps.filter((s) => s.n <= 6).every((s) => s.done || s.n === 1 || s.n === 2);

  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Paso {Math.min(o.current, 7)} de 7</p>
          <h1>Puesta en marcha</h1>
          <p className={ui.muted}>Podés dejarlo y retomarlo cuando quieras: el avance se guarda solo.</p>
        </div>
      </header>

      <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={7} aria-valuenow={o.completed} aria-label="Avance de la puesta en marcha">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className={ui.faint}>{o.completed} de 7 pasos completos</p>

      <ol className={styles.steps}>
        {o.steps.map((s) => (
          <li key={s.n} className={`${styles.step} ${s.done ? styles.done : ""} ${s.n === o.current && !o.finished ? styles.current : ""}`} aria-current={s.n === o.current && !o.finished ? "step" : undefined}>
            <span className={styles.num} aria-hidden>{s.done ? "✓" : s.n}</span>
            <div className={styles.body}>
              <strong>{s.title}</strong> <span className="sr-only">{s.done ? "(completo)" : "(pendiente)"}</span>
              <p className={ui.muted}>{s.hint}</p>
              {s.n === 7 ? (
                <div className={ui.stackSm}>
                  <code>{url}</code>
                  <CopyLink url={url} title={`Reservá en ${o.tenant.name}`} />
                  <div className={ui.row}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qr} alt={`Código QR de ${url}`} width={120} height={120} style={{ borderRadius: 8 }} />
                    <a className={`${ui.button} ${ui.buttonSecondary}`} href={`/panel/${slug}/qr?formato=png`} download>Descargar QR</a>
                  </div>
                  {!o.finished ? (
                    readyToPublish ? (
                      <ActionForm action={markOnboardingStepAction.bind(null, slug, 7)} submitLabel="Terminar puesta en marcha" />
                    ) : (
                      <p className={ui.faint}>Completá canchas, horarios, precios y reglas para terminar.</p>
                    )
                  ) : <p className={ui.muted}>Puesta en marcha terminada.</p>}
                </div>
              ) : (
                <div className={ui.row}>
                  <Link className={`${ui.button} ${s.done ? ui.buttonGhost : ""} ${ui.buttonSmall}`} href={`/panel/${slug}/${s.href}`}>{s.done ? "Revisar" : "Ir"}</Link>
                  {s.n === 6 && !s.done ? <ActionForm action={markOnboardingStepAction.bind(null, slug, 6)} submitLabel="Ya revisé las reglas" variant="secondary" small /> : null}
                  {s.n === 2 && !s.done ? <ActionForm action={markOnboardingStepAction.bind(null, slug, 2)} submitLabel="Omitir por ahora" variant="ghost" small /> : null}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
