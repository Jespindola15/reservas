import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { formatLocalDateTime } from "@/modules/booking/time";
import { listTenantReviews } from "@/modules/player/reviews";
import { replyReviewAction, reportReviewComplexAction } from "../config-actions";

export const metadata: Metadata = { title: "Opiniones" };

export default async function ReviewsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await requireTenantPage(slug, "tenant.settings");
  if (!access) notFound();
  const { rows, avg, count } = await listTenantReviews(access.ctx);
  const tz = access.tenant.timezone;
  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Marketplace</p>
          <h1>Opiniones</h1>
          <p className={ui.muted}>{count ? `★ ${Number(avg).toFixed(1)} · ${count} publicadas` : "Todavía no hay opiniones publicadas."}</p>
        </div>
      </header>
      <p className={ui.faint}>Solo opinan jugadores con una reserva jugada en tu complejo. Podés responder públicamente o denunciar una opinión; la moderación la hace TURNUP (no se pueden borrar críticas legítimas).</p>
      {rows.length === 0 ? <p className={ui.empty}>Cuando tus jugadores opinen, vas a verlas acá.</p> : (
        <ul className={ui.stack} style={{ listStyle: "none", padding: 0 }}>
          {rows.map((r) => (
            <li key={r.id} className={ui.card}>
              <div className={ui.spread}>
                <strong aria-label={`${r.rating} de 5 estrellas`}>{"★".repeat(r.rating)}<span className={ui.faint}>{"★".repeat(5 - r.rating)}</span></strong>
                <span className={ui.faint}>{r.booking.customerName} · turno {r.booking.code} · {formatLocalDateTime(r.createdAt, tz)}</span>
              </div>
              {r.status === "HIDDEN" ? <p className={`${ui.alert} ${ui.alertWarn}`}>Oculta por moderación.</p> : null}
              {r._count.reports ? <p className={ui.faint}>Denuncia en revisión.</p> : null}
              {r.comment ? <p>{r.comment}</p> : <p className={ui.faint}>Sin comentario.</p>}
              {r.reply ? <p className={ui.muted}><strong>Tu respuesta:</strong> {r.reply}</p> : null}
              <details>
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>{r.reply ? "Editar respuesta" : "Responder"}</summary>
                <ActionForm action={replyReviewAction.bind(null, slug, r.id)} submitLabel="Publicar respuesta" className={ui.stack}>
                  <label className={ui.field}><span className={ui.label}>Respuesta pública</span><textarea className={ui.textarea} name="reply" required minLength={2} maxLength={1000} defaultValue={r.reply ?? ""} /></label>
                </ActionForm>
              </details>
              <details>
                <summary style={{ cursor: "pointer" }} className={ui.faint}>Denunciar</summary>
                <ActionForm action={reportReviewComplexAction.bind(null, slug, r.id)} submitLabel="Enviar denuncia" variant="secondary" small resetOnSuccess>
                  <label className={ui.field}><span className={ui.label}>Motivo</span><input className={ui.input} name="reason" required minLength={3} maxLength={300} /></label>
                </ActionForm>
              </details>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
