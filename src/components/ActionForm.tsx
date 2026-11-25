"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import ui from "./ui.module.css";

type ActionResult = { ok: boolean; message: string } | null;

/**
 * Formulario genérico para Server Actions: estado de carga, resultado accesible
 * y modal de confirmación (dialog nativo) para acciones sensibles.
 * La autorización y validación ocurren SIEMPRE en la acción del servidor.
 */
export function ActionForm(props: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  small?: boolean;
  className?: string;
  /** Si se indica, se pide confirmación en un modal antes de enviar. */
  confirm?: { title: string; body?: string; confirmLabel?: string };
  /** Oculta el mensaje de éxito (p. ej. cuando la página se re-renderiza). */
  quietSuccess?: boolean;
  resetOnSuccess?: boolean;
  /** Clave de idempotencia inicial (generada en el servidor); se renueva tras cada envío exitoso. */
  idempotencyKey?: string;
  /** Etiqueta accesible del botón cuando el texto visible es un ícono (p. ej. "↑"). */
  ariaLabel?: string;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(props.action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmedRef = useRef(false);
  const titleId = useId();

  const [idemKey, setIdemKey] = useState(props.idempotencyKey ?? "");
  useEffect(() => {
    if (!state?.ok) return;
    // Aviso para contenedores (p. ej. EditPanel) que se cierran tras guardar.
    formRef.current?.dispatchEvent(new CustomEvent("turnup:action-ok", { bubbles: true, detail: state.message }));
    if (props.resetOnSuccess) formRef.current?.reset();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- rotar la clave tras un éxito es intencional
    if (props.idempotencyKey) setIdemKey(crypto.randomUUID());
  }, [state, props.resetOnSuccess, props.idempotencyKey]);

  const variant =
    props.variant === "danger"
      ? ui.buttonDanger
      : props.variant === "secondary"
        ? ui.buttonSecondary
        : props.variant === "ghost"
          ? ui.buttonGhost
          : "";

  return (
    <form
      ref={formRef}
      action={formAction}
      className={props.className}
      onSubmit={(e) => {
        if (props.confirm && !confirmedRef.current) {
          e.preventDefault();
          dialogRef.current?.showModal();
          return;
        }
        confirmedRef.current = false;
      }}
    >
      {props.idempotencyKey ? <input type="hidden" name="idempotencyKey" value={idemKey} /> : null}
      {props.children}
      <button type="submit" disabled={pending || props.disabled} aria-label={props.ariaLabel} className={`${ui.button} ${variant} ${props.small ? ui.buttonSmall : ""}`}>
        {pending ? <span className={ui.spinner} aria-hidden /> : null}
        {pending ? (props.pendingLabel ?? "Guardando…") : props.submitLabel}
      </button>
      {state && !(state.ok && props.quietSuccess) ? (
        <p role={state.ok ? "status" : "alert"} className={`${ui.alert} ${state.ok ? ui.alertOk : ui.alertError}`}>
          {state.message}
        </p>
      ) : null}
      {props.confirm ? (
        <dialog ref={dialogRef} className={ui.dialog} aria-labelledby={titleId}>
          <h2 id={titleId}>{props.confirm.title}</h2>
          {props.confirm.body ? <p className={ui.muted}>{props.confirm.body}</p> : null}
          <div className={ui.dialogActions}>
            <button type="button" className={`${ui.button} ${ui.buttonSecondary}`} onClick={() => dialogRef.current?.close()}>
              Volver
            </button>
            <button
              type="button"
              className={`${ui.button} ${props.variant === "danger" ? ui.buttonDanger : ""}`}
              onClick={() => {
                dialogRef.current?.close();
                confirmedRef.current = true;
                formRef.current?.requestSubmit();
              }}
            >
              {props.confirm.confirmLabel ?? props.submitLabel}
            </button>
          </div>
        </dialog>
      ) : null}
    </form>
  );
}
