import type { Metadata } from "next";
import { fmtDateTime } from "@/lib/format";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { PlayerShell } from "@/components/player/PlayerShell";
import styles from "@/components/player/player.module.css";
import ui from "@/components/ui.module.css";
import { getCurrentUser } from "@/lib/auth/dal";
import { listPlayerInbox } from "@/modules/inbox/service";
import { markMyInboxReadAction } from "../cuenta/actions";

export const metadata: Metadata = { title: "Avisos — TURNUP", robots: { index: false } };


export default async function PlayerInbox() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/cuenta/ingresar?next=/avisos");
  const { rows, unread } = await listPlayerInbox(user.id, 50);
  return (
    <PlayerShell user={user}>
      <div className={ui.spread}>
        <h1 className={styles.hello}>Avisos</h1>
        {unread ? <ActionForm action={markMyInboxReadAction} submitLabel="Marcar como leídos" variant="secondary" small quietSuccess /> : null}
      </div>
      {rows.length === 0 ? (
        <p className={styles.empty}>No tenés avisos. Acá vas a ver cuando un complejo confirme, rechace o revise tu transferencia.</p>
      ) : (
        <ul className={styles.turns}>
          {rows.map((n) => (
            <li key={n.id} className={styles.turn} style={n.readAt ? { opacity: 0.75 } : undefined}>
              <div className={styles.turnHead}>
                <strong>{n.link?.startsWith("/") ? <Link href={n.link} className={ui.linkPlain}>{n.title}</Link> : n.title}</strong>
                <span className={styles.meta}>{fmtDateTime(n.createdAt)}{n.readAt ? "" : " · nuevo"}</span>
              </div>
              {n.body ? <p className={styles.meta} style={{ margin: 0 }}>{n.body}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </PlayerShell>
  );
}
