import Link from "next/link";
import ui from "./ui.module.css";

export function TopBar({ children, title }: { children?: React.ReactNode; title?: string }) {
  return (
    <header className={ui.topbar}>
      <div className={`${ui.container} ${ui.topbarInner}`}>
        <Link href="/" className={ui.brand}>
          Reser<span>vas</span>
          {title ? <span className="sr-only"> — {title}</span> : null}
        </Link>
        <nav className={ui.nav} aria-label="Principal">
          {children}
        </nav>
      </div>
    </header>
  );
}
