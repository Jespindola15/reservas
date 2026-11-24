import Link from "next/link";
import ui from "@/components/ui.module.css";

const LINKS = [
  { href: "/admin", label: "Complejos" },
  { href: "/admin/planes", label: "Planes" },
  { href: "/admin/auditoria", label: "Auditoría" },
  { href: "/admin/seguridad", label: "Seguridad" },
];

export function AdminNav({ current }: { current: string }) {
  return (
    <nav aria-label="Superadministrador" className={ui.row} style={{ gap: "0.4rem", flexWrap: "wrap" }}>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.href === current ? "page" : undefined} className={`${ui.button} ${ui.buttonSmall} ${l.href === current ? "" : ui.buttonGhost}`}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
