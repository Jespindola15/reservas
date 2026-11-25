import Link from "next/link";
import { Icon } from "@/components/shell/icons";
import ui from "@/components/ui.module.css";

/**
 * Barra de búsqueda y filtros compartida por los listados (panel y superadmin).
 * La búsqueda queda siempre visible; los demás filtros se pliegan en "Filtros" para no ocupar
 * media pantalla en el celular. Formulario GET: los filtros quedan en la URL (se pueden compartir).
 */
export function FilterBar(props: {
  label: string;
  search: { name: string; placeholder: string; defaultValue?: string };
  hidden?: Record<string, string>;
  /** Hay filtros (además de la búsqueda) aplicados: se muestra el punto y el panel abierto. */
  active?: boolean;
  clearHref: string;
  children?: React.ReactNode;
}) {
  const any = Boolean(props.active || props.search.defaultValue);
  return (
    <form method="get" role="search" aria-label={props.label} className={ui.filterBar}>
      {Object.entries(props.hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className={ui.filterSearch}>
        <span className="sr-only">Buscar</span>
        <Icon name="search" className={ui.filterSearchIcon} />
        <input className={ui.input} type="search" name={props.search.name} defaultValue={props.search.defaultValue ?? ""} placeholder={props.search.placeholder} maxLength={80} />
      </label>
      {props.children ? (
        <details className={ui.filterMore} open={props.active || undefined}>
          <summary className={`${ui.button} ${ui.buttonSecondary}`}>
            <Icon name="filters" /> Filtros{props.active ? <span className={ui.filterDot} aria-label="(con filtros aplicados)" /> : null}
          </summary>
          <div className={ui.filterPanel}>{props.children}</div>
        </details>
      ) : null}
      <button className={ui.button} type="submit">Buscar</button>
      {any ? <Link className={`${ui.button} ${ui.buttonGhost}`} href={props.clearHref}>Limpiar</Link> : null}
    </form>
  );
}
