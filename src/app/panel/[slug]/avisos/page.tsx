import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import ui from "@/components/ui.module.css";
import { requireTenantPage } from "@/lib/auth/page";
import { formatLocalDateTime } from "@/modules/booking/time";
import { listTenantInbox, panelLink } from "@/modules/inbox/service";
import { markInboxReadAction } from "./actions";
import styles from "../transferencias/transfers.module.css";

export const metadata: Metadata = { title: "Avisos" };

export default async function InboxPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await requireTenantPage(slug, "booking.read");
  if (!access) notFound();
  const { rows, unread } = await listTenantInbox(access.ctx, 50);
  return (
    <>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Bandeja</p>
          <h1>Avisos</h1>
          <p className={ui.muted}>Novedades de reservas y transferencias de tu complejo. Se guardan dentro de TURNUP; no se envían por WhatsApp.</p>
        </div>
        {unread ? <ActionForm action={markInboxReadAction.bind(null, slug)} submitLabel={`Marcar ${unread} como leídos`} variant="secondary" quietSuccess /> : null}
      </header>
      {rows.length === 0 ? (
        <p className={ui.empty}>Todavía no hay avisos.</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((n) => {
            const href = panelLink(slug, n.link);
            return (
              <li key={n.id} className={`${ui.card} ${styles.item}`} style={n.readAt ? { opacity: 0.75 } : undefined}>
                <div className={styles.head}>
                  <strong>{href ? <Link href={href} className={ui.linkPlain}>{n.title}</Link> : n.title}</strong>
                  <span className={ui.faint}>{formatLocalDateTime(n.createdAt, access.tenant.timezone)}{n.readAt ? "" : " · nuevo"}</span>
                </div>
                {n.body ? <p className={ui.muted} style={{ margin: 0 }}>{n.body}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
