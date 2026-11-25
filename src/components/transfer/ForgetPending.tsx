"use client";

import { useEffect } from "react";
import { forgetPending } from "./pending-store";

/** Cuando la reserva ya no espera la transferencia, se borra el recordatorio de este dispositivo. */
export function ForgetPending({ code }: { code: string }) {
  useEffect(() => forgetPending(code), [code]);
  return null;
}
