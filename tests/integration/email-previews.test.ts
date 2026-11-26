import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { withSystem } from "@/lib/db/tenant-context";
import { seal } from "@/lib/security/sealed";
import { createBooking } from "@/modules/booking/service";
import { renderNotification } from "@/modules/notifications/render";
import { updatePaymentSettings } from "@/modules/payments/transfers";
import { DAY, NOW, at, makeTenant, makeUser, onlineInput, owner, publicActor, resetDb } from "../support/fixtures";

/**
 * Renderiza TODAS las plantillas con datos reales de prueba y verifica que no queden datos
 * vacíos. Con EMAIL_PREVIEW_DIR=<carpeta> además guarda el HTML y el texto para revisarlos.
 */
afterAll(async () => {
  await prisma.$disconnect();
  await owner.$disconnect();
});

describe("plantillas de email", () => {
  it("todas renderizan HTML y texto completos, en español y con formatos argentinos", async () => {
    await resetDb();
    const f = await makeTenant("prev6");
    await owner.tenant.update({ where: { id: f.tenant.id }, data: { name: "Complejo La Diez", contactEmail: "hola@ladiez.test", contactPhone: "11 4000-1234", address: "Av. Siempreviva 742", city: "San Nicolás" } });
    const o = await makeUser("dueno@prev6.test", { tenantId: f.tenant.id, role: "OWNER" });
    await updatePaymentSettings(f.ctx, { alias: "la.diez.cancha", holderName: "La Diez SRL", bankName: "Banco Nación", transferWindowMinutes: 30, reviewWindowMinutes: 120, depositType: "FIXED", depositValue: 500 }, { type: "USER", userId: o.id });
    let { booking } = await createBooking(f.ctx, onlineInput(f.court.id, at(DAY, "20:00")), publicActor, { now: NOW });
    // Los estados finales no se pueden abandonar (trigger): cada uno usa una reserva nueva.
    const finals = ["REJECTED", "CANCELLED", "EXPIRED"];
    const slots = ["08:00", "09:30", "18:00", "19:30", "21:00", "22:30"];
    let slot = 0;
    let current = "CONFIRMED";
    const su = await makeUser("super@prev6.test", { platformRole: "SUPERADMIN" });
    const player = await makeUser("jugador1@example.com");
    const sub = await owner.plan.create({ data: { code: "basico6", name: "Básico", priceAmount: 2000000, maxCourts: 4, maxMembers: 3 } }).then((p) =>
      owner.subscription.create({ data: { tenantId: f.tenant.id, planId: p.id, status: "ACTIVE", currentPeriodStart: NOW, currentPeriodEnd: new Date(NOW.getTime() + 2 * 86_400_000) } }),
    );
    const sealedUrl = await seal("https://turnup.example/restablecer?token=demo");

    // Estado de la reserva que necesita cada plantilla.
    type Case = { kind: string; status?: string; payment?: string | null; payload?: Record<string, unknown>; recipient?: string; bookingId?: string | null; tenantId?: string | null };
    const cases: Case[] = [
      { kind: "password_reset", payload: { sealedUrl }, tenantId: null, bookingId: null },
      { kind: "email_verification", payload: { sealedUrl }, tenantId: null, bookingId: null, recipient: player.email },
      { kind: "player_welcome", tenantId: null, bookingId: null, recipient: player.email },
      { kind: "tenant_welcome", bookingId: null },
      { kind: "admin_tenant_created", recipient: su.email, bookingId: null },
      { kind: "admin_quota_warning", recipient: su.email, payload: { used: 240, limit: 300, level: 80 }, tenantId: null, bookingId: null },
      { kind: "admin_email_failures", recipient: su.email, payload: { reason: "provider_down", error: "brevo 401 unauthorized" }, tenantId: null, bookingId: null },
      { kind: "admin_test", recipient: su.email, tenantId: null, bookingId: null },
      { kind: "owner_subscription_notice", payload: { subscriptionId: sub.id, stage: "soon", periodEnd: sub.currentPeriodEnd.toISOString() }, bookingId: null },
      { kind: "owner_digest", bookingId: null },
      { kind: "booking_awaiting_transfer", status: "PENDING", payment: "AWAITING_TRANSFER" },
      { kind: "booking_transfer_reported", status: "PENDING", payment: "TRANSFER_REPORTED" },
      { kind: "owner_transfer_reported", status: "PENDING", payment: "TRANSFER_REPORTED" },
      { kind: "owner_transfer_expiring", status: "PENDING", payment: "TRANSFER_REPORTED" },
      { kind: "owner_new_request", status: "PENDING", payment: "AWAITING_TRANSFER" },
      { kind: "booking_requested", status: "PENDING", payment: null },
      { kind: "payment_approved", status: "CONFIRMED", payment: "VERIFIED" },
      { kind: "booking_confirmed", status: "CONFIRMED", payment: null },
      { kind: "booking_rescheduled", status: "CONFIRMED", payload: { fromStartsAt: at(DAY, "18:30").toISOString(), fromCourtName: "Cancha 2" } },
      { kind: "booking_reminder_24h", status: "CONFIRMED" },
      { kind: "booking_reminder_2h", status: "CONFIRMED" },
      { kind: "payment_rejected", status: "REJECTED", payment: "AWAITING_TRANSFER" },
      { kind: "booking_rejected", status: "REJECTED", payment: null },
      { kind: "booking_cancelled", status: "CANCELLED", payload: { by: "complex" } },
      { kind: "owner_booking_cancelled", status: "CANCELLED" },
      { kind: "owner_payment_incident", status: "CONFIRMED", payload: { kind: "UNDERPAID" } },
      { kind: "booking_expired", status: "EXPIRED", payment: "AWAITING_TRANSFER" },
    ];
    const dir = process.env.EMAIL_PREVIEW_DIR;
    if (dir) mkdirSync(dir, { recursive: true });
    const index: string[] = [];
    for (const c of cases) {
      if (c.status && (finals.includes(c.status) || finals.includes(current))) {
        ({ booking } = await createBooking(f.ctx, onlineInput(f.court2.id, at(DAY, slots[slot++]!)), publicActor, { now: NOW }));
      }
      if (c.status) {
        const expiresAt = c.status === "PENDING" ? new Date(Date.now() + 3_600_000) : null;
        await owner.booking.update({
          where: { id: booking.id },
          data: { status: (current = c.status) as never, paymentStatus: c.payment === undefined ? undefined : c.payment, expiresAt, cancelReason: ["REJECTED", "CANCELLED"].includes(c.status) ? "Lluvia: cancha inhabilitada" : null, paymentReceivedAmount: c.payment === "VERIFIED" ? 50000 : null },
        });
      }
      const now = c.kind.startsWith("booking_reminder") ? new Date(booking.startsAt.getTime() - (c.kind.endsWith("24h") ? 20 : 1.5) * 3_600_000) : c.kind === "owner_transfer_expiring" ? new Date() : NOW;
      const r = await withSystem((tx) =>
        renderNotification(tx, { id: "preview", tenantId: c.tenantId === undefined ? f.tenant.id : c.tenantId, kind: c.kind, recipient: c.recipient ?? "jugador1@example.com", bookingId: c.bookingId === undefined ? booking.id : c.bookingId, payload: c.payload ?? null }, now),
      );
      expect(r, c.kind).toMatchObject({ send: true });
      if (!r.send) continue;
      const { html, text, subject } = r.content;
      expect(html, c.kind).not.toMatch(/undefined|NaN|\[object|\bnull\b/);
      expect(text, c.kind).not.toMatch(/undefined|NaN|\[object|\bnull\b/);
      expect(html, c.kind).toContain('lang="es"');
      expect(text.length, c.kind).toBeGreaterThan(40);
      // Fechas DD/MM/AAAA, nunca formato ISO ni de EE.UU. en el texto visible.
      expect(text, c.kind).not.toMatch(/\d{4}-\d{2}-\d{2}T|\b(AM|PM)\b/);
      if (dir) {
        writeFileSync(join(dir, `${c.kind}.html`), html);
        writeFileSync(join(dir, `${c.kind}.txt`), `Asunto: ${subject}\n\n${text}`);
        index.push(`<li><a href="${c.kind}.html">${c.kind}</a> — ${subject}</li>`);
      }
    }
    if (dir) writeFileSync(join(dir, "index.html"), `<!doctype html><meta charset="utf-8"><ul>${index.join("")}</ul>`);
  });
});
