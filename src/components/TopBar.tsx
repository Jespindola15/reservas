import { Brand } from "./Brand";
import ui from "./ui.module.css";

export function TopBar({ children }: { children?: React.ReactNode }) {
  return (
    <header className={ui.topbar}>
      <div className={`${ui.container} ${ui.topbarInner}`}>
        <Brand />
        <nav className={ui.nav} aria-label="Principal">
          {children}
        </nav>
      </div>
    </header>
  );
}
