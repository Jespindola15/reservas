"use client";

import { useActionState } from "react";
import ui from "./ui.module.css";

type ActionResult = { ok: boolean; message: string } | null;

/**
 * Formulario genérico para Server Actions con estado de carga y resultado
 * accesible. La autorización y validación ocurren SIEMPRE en la acción.
 */
export function ActionForm(props: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  small?: boolean;
  className?: string;
  confirmMessage?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(props.action, null);
  const variant =
    props.variant === "danger" ? ui.buttonDanger : props.variant === "secondary" ? ui.buttonSecondary : "";
  return (
    <form
      action={formAction}
      className={props.className}
      onSubmit={(e) => {
        if (props.confirmMessage && !window.confirm(props.confirmMessage)) e.preventDefault();
      }}
    >
      {props.children}
      <button
        type="submit"
        disabled={pending}
        className={`${ui.button} ${variant} ${props.small ? ui.buttonSmall : ""}`}
      >
        {pending ? (props.pendingLabel ?? "Guardando…") : props.submitLabel}
      </button>
      {state ? (
        <p role={state.ok ? "status" : "alert"} className={`${ui.alert} ${state.ok ? ui.alertOk : ui.alertError}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
