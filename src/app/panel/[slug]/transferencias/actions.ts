"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireTenant } from "@/lib/auth/dal";
import { setBookingInternalNotes } from "@/modules/booking/service";
import { confirmTransfer, openIncident, rejectTransfer, resolveIncident, updatePaymentSettings } from "@/modules/payments/transfers";

/**
 * Acciones de cobro por transferencia. Cada una re-autoriza con su permiso:
 * verificar pagos (payments.verify) y cambiar datos bancarios (payments.configure, solo dueño).
 * El tenant sale del slug + membresía; nunca del formulario.
 */
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};

function refresh(slug: string) {
  revalidatePath(`/panel/${slug}`, "layout");
}

export async function confirmTransferAction(slug: string, bookingId: string, version: number, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("transfer.confirm", async () => {
    const { ctx, user } = await requireTenant(slug, "payments.verify");
    const r = await confirmTransfer(ctx, { bookingId, expectedVersion: version, receivedAmount: str(fd, "receivedAmount") ?? "", note: str(fd, "note") }, { type: "USER", userId: user.id });
    refresh(slug);
    return `Pago verificado. La reserva ${r.code} quedó confirmada.`;
  });
}

export async function rejectTransferAction(slug: string, bookingId: string, version: number, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("transfer.reject", async () => {
    const { ctx, user } = await requireTenant(slug, "payments.verify");
    const r = await rejectTransfer(
      ctx,
      { bookingId, expectedVersion: version, reason: str(fd, "reason") ?? "", moneyReceived: fd.get("moneyReceived") === "on", receivedAmount: str(fd, "receivedAmount") },
      { type: "USER", userId: user.id },
    );
    refresh(slug);
    return `Reserva ${r.code} rechazada. El horario quedó libre.`;
  });
}

export async function openIncidentAction(slug: string, bookingId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("transfer.incident", async () => {
    const { ctx, user } = await requireTenant(slug, "payments.verify");
    await openIncident(ctx, { bookingId, kind: str(fd, "kind") ?? "", amount: str(fd, "amount"), notes: str(fd, "notes") }, { type: "USER", userId: user.id });
    refresh(slug);
    return "Incidencia registrada.";
  });
}

export async function resolveIncidentAction(slug: string, incidentId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("transfer.incident_resolve", async () => {
    const { ctx, user } = await requireTenant(slug, "payments.verify");
    await resolveIncident(ctx, { incidentId, resolution: str(fd, "resolution") ?? "", notes: str(fd, "notes") }, { type: "USER", userId: user.id });
    refresh(slug);
    return "Incidencia cerrada.";
  });
}

export async function transferNoteAction(slug: string, bookingId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("transfer.note", async () => {
    const { ctx, user } = await requireTenant(slug, "booking.manage");
    await setBookingInternalNotes(ctx, { bookingId, notes: str(fd, "notes") ?? "" }, { type: "USER", userId: user.id });
    refresh(slug);
    return "Nota interna guardada.";
  });
}

export async function savePaymentSettingsAction(slug: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("payments.settings", async () => {
    const { ctx, user } = await requireTenant(slug, "payments.configure");
    await updatePaymentSettings(
      ctx,
      {
        alias: str(fd, "alias"),
        cbuCvu: str(fd, "cbuCvu"),
        holderName: str(fd, "holderName"),
        bankName: str(fd, "bankName"),
        instructions: str(fd, "instructions"),
        transferWindowMinutes: str(fd, "transferWindowMinutes") ?? "",
        reviewWindowMinutes: str(fd, "reviewWindowMinutes") ?? "",
        depositType: (str(fd, "depositType") ?? "NONE") as "NONE",
        depositValue: str(fd, "depositValue") ?? "0",
      },
      { type: "USER", userId: user.id },
    );
    refresh(slug);
    revalidatePath(`/${slug}`);
    return "Datos de cobro guardados.";
  });
}
