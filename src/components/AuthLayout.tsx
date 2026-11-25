import Link from "next/link";
import { Wordmark } from "./Brand";
import styles from "./auth.module.css";

/** Pantallas de acceso (ingreso, recuperación, invitación): centradas, sin distracciones. */
export function AuthLayout({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className={styles.wrap}>
      <Link href="/" className={styles.brand} aria-label="TURNUP, inicio"><Wordmark height={30} /></Link>
      <div className={styles.card}>{children}</div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </main>
  );
}
