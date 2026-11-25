import type { Metadata } from "next";
import { ActionForm } from "@/components/ActionForm";
import ui from "@/components/ui.module.css";
import { requireSuperadminPage } from "@/lib/auth/dal";
import { listOpenReports } from "@/modules/player/reviews";
import { moderateReviewAction } from "../actions";

export const metadata: Metadata = { title: "Moderación de opiniones" };

export default async function ModerationPage() {
  const user = await requireSuperadminPage("/admin/moderacion");
  const reports = await listOpenReports(user);
  return (
    <>
      <div className={ui.stack}>
        <header className={ui.pageHeader}><div><p className={ui.eyebrow}>Plataforma</p><h1>Moderación</h1></div></header>
        <p className={ui.muted}>Denuncias abiertas sobre opiniones. Ocultá solo contenido ofensivo, falso o ajeno a la experiencia; una crítica legítima se mantiene.</p>
        {reports.length === 0 ? <p className={ui.empty}>No hay denuncias pendientes.</p> : (
          <ul className={ui.stack} style={{ listStyle: "none", padding: 0 }}>
            {reports.map((r) => (
              <li key={r.id} className={ui.card}>
                <div className={ui.spread}>
                  <strong>{r.tenant.name}</strong>
                  <span className={ui.faint}>Denuncia de {r.reporterKind === "COMPLEX" ? "el complejo" : "un jugador"} · {r.createdAt.toLocaleDateString("es-AR")}</span>
                </div>
                <p><strong>Motivo:</strong> {r.reason}</p>
                <blockquote className={ui.card} style={{ margin: "0.5rem 0" }}>
                  {"★".repeat(r.review.rating)} {r.review.status === "HIDDEN" ? <em>(oculta)</em> : null}
                  <div>{r.review.comment ?? <span className={ui.faint}>Sin comentario</span>}</div>
                </blockquote>
                <div className={ui.row}>
                  <ActionForm action={moderateReviewAction.bind(null, r.review.id, "HIDE")} submitLabel="Ocultar opinión" variant="danger" small>
                    <input type="hidden" name="note" value={r.reason.slice(0, 200)} />
                  </ActionForm>
                  <ActionForm action={moderateReviewAction.bind(null, r.review.id, "KEEP")} submitLabel="Mantener publicada" variant="secondary" small />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
