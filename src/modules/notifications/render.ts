import type { Tx } from "@/lib/db/tenant-context";
import { getEnv } from "@/lib/env";
import { unseal } from "@/lib/security/sealed";
import { formatMoney } from "@/modules/booking/pricing";
import { trackingPath } from "@/modules/booking/public-access";
import { formatLocalDateTime, formatLocalTime } from "@/modules/booking/time";
import { PLAYER_KINDS, OWNER_KINDS } from "./outbox";
import { layout, type EmailContent } from "./templates";

export type RenderInput = {
  id: string;
  tenantId: string | null;
  kind: string;
  recipient: string;
  bookingId: string | null;
  payload: unknown;
};

export type RenderResult = { send: true; content: EmailContent } | { send: false; reason: string };

const SPORT: Record<string, string> = { FOOTBALL_5: "Fútbol 5", FOOTBALL_7: "Fútbol 7", FOOTBALL_11: "Fútbol 11", PADEL: "Pádel" };

const appUrl = () => getEnv().BETTER_AUTH_URL.replace(/\/$/, "");

/**
 * Arma el email EN EL MOMENTO DEL ENVÍO a partir de la base:
 *  - respeta los ajustes actuales del complejo (avisos desactivados => SKIPPED);
 *  - descarta avisos que ya no corresponden (p. ej. "confirmada" de una reserva
 *    que luego se canceló, o un recordatorio de un turno reprogramado);
 *  - el enlace privado del jugador se calcula ahora (HMAC), no se guarda en la cola.
 */
export async function renderNotification(tx: Tx, n: RenderInput, now: Date): Promise<RenderResult> {
  const p = (n.payload ?? {}) as Record<string, unknown>;

  if (n.kind === "password_reset") {
    if (typeof p.sealedUrl !== "string") return { send: false, reason: "missing_link" };
    const url = await unseal(p.sealedUrl);
    return {
      send: true,
      content: layout({
        preheader: "Restablecé tu contraseña de TURNUP",
        title: "Restablecé tu contraseña",
        intro: "Recibimos un pedido para cambiar la contraseña de tu cuenta. El enlace vence en 1 hora y sirve una sola vez.",
        cta: { label: "Elegir nueva contraseña", url },
        note: "Si no lo pediste, ignorá este email: tu contraseña no cambia.",
        footer: "TURNUP · Este email se envió porque alguien pidió restablecer la contraseña de esta cuenta.",
      }),
    };
  }

  if (n.kind === "team_invitation") {
    if (typeof p.sealedToken !== "string" || !n.tenantId) return { send: false, reason: "missing_link" };
    const inv = await tx.invitation.findFirst({
      where: { tenantId: n.tenantId, email: n.recipient, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      select: { role: true, expiresAt: true, tenant: { select: { name: true } } },
    });
    if (!inv) return { send: false, reason: "invitation_closed" };
    const token = await unseal(p.sealedToken);
    return {
      send: true,
      content: layout({
        preheader: `Te invitaron al equipo de ${inv.tenant.name}`,
        title: `Sumate al equipo de ${inv.tenant.name}`,
        intro: `Te invitaron a gestionar reservas en TURNUP como ${inv.role === "ADMIN" ? "administrador/a" : "personal del complejo"}.`,
        cta: { label: "Aceptar invitación", url: `${appUrl()}/invitacion?token=${encodeURIComponent(token)}` },
        note: `La invitación vence el ${inv.expiresAt.toISOString().slice(0, 10)} y sirve una sola vez.`,
        footer: "TURNUP · Si no esperabas esta invitación, podés ignorar este email.",
      }),
    };
  }

  if (n.kind === "tenant_welcome") {
    if (!n.tenantId) return { send: false, reason: "no_tenant" };
    const t = await tx.tenant.findUnique({ where: { id: n.tenantId }, select: { name: true, slug: true, status: true, onboardingCompletedAt: true } });
    if (!t || t.status !== "ACTIVE") return { send: false, reason: "tenant_inactive" };
    return {
      send: true,
      content: layout({
        preheader: `${t.name} ya está en TURNUP`,
        title: `¡Bienvenido a TURNUP, ${t.name}!`,
        intro: "Tu complejo ya tiene panel y página de reservas. En unos minutos podés dejarlo listo: datos, canchas, horarios, precios y reglas, paso a paso.",
        cta: { label: t.onboardingCompletedAt ? "Ir a mi panel" : "Empezar la puesta en marcha", url: `${appUrl()}/panel/${t.slug}${t.onboardingCompletedAt ? "" : "/bienvenida"}` },
        note: `Tu página pública para compartir con tus clientes: ${appUrl()}/${t.slug}`,
        footer: "TURNUP · Recibís este email porque te dieron de alta como responsable de un complejo.",
      }),
    };
  }

  if (!n.tenantId) return { send: false, reason: "no_tenant" };
  const tenant = await tx.tenant.findUnique({
    where: { id: n.tenantId },
    select: {
      slug: true, name: true, timezone: true, contactPhone: true, address: true, status: true,
      notificationsEnabled: true, notifyPlayers: true, notifyOwner: true,
    },
  });
  if (!tenant || tenant.status !== "ACTIVE") return { send: false, reason: "tenant_inactive" };
  if (!tenant.notificationsEnabled) return { send: false, reason: "tenant_disabled" };
  const isPlayer = (PLAYER_KINDS as readonly string[]).includes(n.kind);
  const isOwner = (OWNER_KINDS as readonly string[]).includes(n.kind);
  if (isPlayer && !tenant.notifyPlayers) return { send: false, reason: "players_disabled" };
  if (isOwner && !tenant.notifyOwner) return { send: false, reason: "owner_disabled" };
  const tz = tenant.timezone;
  const footer = `${tenant.name}${tenant.address ? ` · ${tenant.address}` : ""}${tenant.contactPhone ? ` · ${tenant.contactPhone}` : ""} — Enviado con TURNUP.`;

  if (n.kind === "owner_digest") {
    const from = now;
    const to = new Date(now.getTime() + 24 * 3_600_000);
    const list = await tx.booking.findMany({
      where: { tenantId: n.tenantId, status: { in: ["PENDING", "CONFIRMED"] }, startsAt: { gte: from, lt: to } },
      orderBy: { startsAt: "asc" },
      take: 60,
      select: { startsAt: true, status: true, customerName: true, court: { select: { name: true } } },
    });
    const pending = list.filter((b) => b.status === "PENDING").length;
    return {
      send: true,
      content: layout({
        preheader: `${list.length} turnos en las próximas 24 h`,
        title: `Resumen: ${list.length} turnos en las próximas 24 h`,
        intro: pending ? `Tenés ${pending} solicitud(es) pendiente(s) de aprobar.` : "Todo al día: no hay solicitudes pendientes.",
        rows: list.slice(0, 30).map((b) => [`${formatLocalTime(b.startsAt, tz)} · ${b.court.name}`, `${b.customerName}${b.status === "PENDING" ? " (pendiente)" : ""}`]),
        cta: { label: "Abrir calendario", url: `${appUrl()}/panel/${tenant.slug}/calendario` },
        note: list.length > 30 ? `Y ${list.length - 30} más en el panel.` : undefined,
        footer: "TURNUP · Podés desactivar este resumen en Ajustes del complejo.",
      }),
    };
  }

  if (!n.bookingId) return { send: false, reason: "no_booking" };
  const b = await tx.booking.findFirst({
    where: { id: n.bookingId, tenantId: n.tenantId },
    select: {
      id: true, code: true, status: true, startsAt: true, endsAt: true, durationMinutes: true, priceAmount: true,
      currency: true, customerName: true, expiresAt: true,
      court: { select: { name: true, sport: true } },
    },
  });
  if (!b) return { send: false, reason: "booking_missing" };

  const when = `${formatLocalDateTime(b.startsAt, tz)} a ${formatLocalTime(b.endsAt, tz)}`;
  const rows: [string, string][] = [
    ["Complejo", tenant.name],
    ["Cancha", `${b.court.name} · ${SPORT[b.court.sport] ?? ""}`],
    ["Turno", when],
    ["Precio", `${formatMoney(b.priceAmount, b.currency)} (se abona en el complejo)`],
    ["Código", b.code],
  ];
  const link = { label: "Ver mi reserva", url: `${appUrl()}${trackingPath(tenant.slug, b.code, b.id)}` };
  const first = b.customerName.trim().split(/\s+/)[0] ?? "";
  const panelLink = { label: "Abrir en el panel", url: `${appUrl()}/panel/${tenant.slug}/reservas/${b.id}` };

  switch (n.kind) {
    case "booking_requested":
      if (b.status !== "PENDING") return { send: false, reason: "stale" };
      return {
        send: true,
        content: layout({
          preheader: `Solicitud recibida para ${when}`,
          title: `Recibimos tu solicitud, ${first}`,
          intro: `${tenant.name} tiene que aprobarla. Te avisamos apenas la confirme.`,
          rows: [...rows, ...(b.expiresAt ? ([["Responde antes de", formatLocalDateTime(b.expiresAt, tz)]] as [string, string][]) : [])],
          cta: link,
          note: "Si el complejo no responde a tiempo, la solicitud vence y el turno se libera.",
          footer,
        }),
      };
    case "booking_confirmed":
      if (b.status !== "CONFIRMED") return { send: false, reason: "stale" };
      return { send: true, content: layout({ preheader: `Confirmado: ${when}`, title: "¡Tu turno está confirmado!", intro: `${first}, te esperamos en ${tenant.name}.`, rows, cta: link, note: "Con el enlace podés consultar o cancelar la reserva dentro del plazo del complejo.", footer }) };
    case "booking_cancelled": {
      const by = p.by === "player" ? "Cancelaste tu reserva." : p.by === "rejected" ? `${tenant.name} no pudo aceptar tu solicitud.` : `${tenant.name} canceló tu reserva.`;
      return { send: true, content: layout({ preheader: "Reserva cancelada", title: p.by === "rejected" ? "Solicitud rechazada" : "Reserva cancelada", intro: by, rows, note: "El turno quedó libre. Podés reservar otro horario en la página del complejo.", cta: { label: "Reservar otro turno", url: `${appUrl()}/${tenant.slug}` }, footer }) };
    }
    case "booking_rescheduled": {
      if (b.status !== "PENDING" && b.status !== "CONFIRMED") return { send: false, reason: "stale" };
      const from = typeof p.fromStartsAt === "string" ? formatLocalDateTime(new Date(p.fromStartsAt), tz) : "";
      return { send: true, content: layout({ preheader: `Nuevo horario: ${when}`, title: "Tu reserva cambió de horario", intro: `${tenant.name} reprogramó tu turno${from ? ` (antes: ${from}${typeof p.fromCourtName === "string" ? `, ${p.fromCourtName}` : ""})` : ""}.`, rows, cta: link, footer }) };
    }
    case "booking_reminder":
      if (b.status !== "CONFIRMED" || b.startsAt <= now) return { send: false, reason: "stale" };
      if (typeof p.startsAt === "string" && p.startsAt !== b.startsAt.toISOString()) return { send: false, reason: "rescheduled" };
      return { send: true, content: layout({ preheader: `Recordatorio: ${when}`, title: `Te esperamos a las ${formatLocalTime(b.startsAt, tz)}`, intro: `${first}, este es un recordatorio de tu turno.`, rows, cta: link, footer }) };
    case "booking_expired":
      if (b.status !== "EXPIRED") return { send: false, reason: "stale" };
      return { send: true, content: layout({ preheader: "Tu solicitud venció", title: "Tu solicitud venció", intro: `${tenant.name} no la confirmó a tiempo y el turno se liberó.`, rows, cta: { label: "Buscar otro turno", url: `${appUrl()}/${tenant.slug}` }, footer }) };
    case "owner_new_request":
      return { send: true, content: layout({ preheader: `Nueva reserva de ${b.customerName}`, title: b.status === "PENDING" ? "Nueva solicitud para aprobar" : "Nueva reserva online", intro: b.status === "PENDING" ? `${b.customerName} pidió un turno. Aprobala antes de que venza.` : `${b.customerName} reservó un turno online.`, rows, cta: panelLink, footer: "TURNUP · Avisos al complejo. Configurables en Ajustes." }) };
    case "owner_booking_cancelled":
      return { send: true, content: layout({ preheader: `${b.customerName} canceló`, title: "Un jugador canceló su reserva", intro: `${b.customerName} canceló con su enlace. El turno quedó libre.`, rows, cta: panelLink, footer: "TURNUP · Avisos al complejo. Configurables en Ajustes." }) };
    default:
      return { send: false, reason: "unknown_kind" };
  }
}
