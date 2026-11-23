import Link from "next/link";
import ui from "./ui.module.css";

/** Logotipo TURNUP (texto + marca). Sin dependencias externas de fuentes ni imágenes. */
export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className={ui.brand} aria-label="TURNUP, inicio">
      <span className={ui.brandMark} aria-hidden>
        T
      </span>
      <span className={ui.brandWord}>
        TURN<span>UP</span>
      </span>
    </Link>
  );
}
