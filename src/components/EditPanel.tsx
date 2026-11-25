"use client";

import { useEffect, useId, useRef, useState } from "react";
import ui from "./ui.module.css";

/**
 * Panel de edición en modal (dialog nativo) para formularios ocasionales del superadmin.
 * Se cierra solo cuando el ActionForm interno informa un guardado exitoso y deja el
 * mensaje de resultado visible junto al botón que lo abrió.
 */
export function EditPanel(props: {
  label: string;
  title: string;
  description?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  /** Abre el panel al cargar si la URL termina en #hash (p. ej. enlaces "Nuevo complejo"). */
  hash?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onOk = (e: Event) => {
      setDone((e as CustomEvent<string>).detail ?? "Cambios guardados.");
      d.close();
    };
    d.addEventListener("turnup:action-ok", onOk);
    if (props.hash && window.location.hash === `#${props.hash}`) d.showModal();
    return () => d.removeEventListener("turnup:action-ok", onOk);
  }, [props.hash]);

  const variant =
    props.variant === "danger" ? ui.buttonDanger : props.variant === "primary" ? "" : props.variant === "ghost" ? ui.buttonGhost : ui.buttonSecondary;

  return (
    <div className={ui.editPanel}>
      <button type="button" className={`${ui.button} ${ui.buttonSmall} ${variant}`} onClick={() => { setDone(null); ref.current?.showModal(); }}>
        {props.label}
      </button>
      {done ? <p role="status" className={`${ui.alert} ${ui.alertOk}`}>{done}</p> : null}
      <dialog ref={ref} className={`${ui.dialog} ${ui.dialogWide}`} aria-labelledby={titleId}>
        <div className={ui.dialogHead}>
          <h2 id={titleId}>{props.title}</h2>
          <button type="button" className={ui.dialogClose} aria-label="Cerrar" onClick={() => ref.current?.close()}>×</button>
        </div>
        {props.description ? <p className={ui.muted}>{props.description}</p> : null}
        {props.children}
      </dialog>
    </div>
  );
}
