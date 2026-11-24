import Link from "next/link";
import { BRAND } from "./brand-paths";
import ui from "./ui.module.css";

/** Logo completo (marca "t" + "turnup"). La marca usa el verde de la marca; el texto, el color actual. */
export function Wordmark({ height = 28, className }: { height?: number; className?: string }) {
  const { width, height: h, textOffset } = BRAND.wordmark;
  return (
    <svg className={className} viewBox={`0 0 ${width} ${h}`} height={height} width={(height * width) / h} aria-hidden focusable="false">
      <g transform={BRAND.wordmarkMark.transform} fill="var(--lime, #a0f802)">
        <path d={BRAND.wordmarkMark.d} />
      </g>
      <g transform={`translate(${textOffset[0]} ${textOffset[1]})`}>
        <g transform={BRAND.wordmarkText.transform} fill="currentColor">
          <path d={BRAND.wordmarkText.d} />
        </g>
      </g>
    </svg>
  );
}

/** Solo la marca "t" con el punto. */
export function BrandMark({ size = 28, color = "var(--lime, #a0f802)" }: { size?: number; color?: string }) {
  const { width, height } = BRAND.mark;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} height={size} width={(size * width) / height} aria-hidden focusable="false">
      <g transform={BRAND.icon.transform} fill={color}>
        <path d={BRAND.icon.d} />
      </g>
    </svg>
  );
}

/** Logo enlazado para barras de navegación. */
export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className={ui.brand} aria-label="TURNUP, inicio">
      <Wordmark height={26} />
    </Link>
  );
}
