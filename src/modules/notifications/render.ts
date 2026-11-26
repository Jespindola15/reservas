import type { Tx } from "@/lib/db/tenant-context";
import { getEnv } from "@/lib/env";
import { fmtDate, fmtDateTime, fmtMoney, fmtTime, fmtWeekdayDate } from "@/lib/format";
import { unseal } from "@/lib/security/sealed";
import { trackingPath } from "@/modules/booking/public-access";
import { INCIDENT_LABEL, readTransferSnapshot } from "@/modules/payments/transfers";
import { OWNER_KINDS, OWNER_MUTABLE_KINDS, PLAYER_KINDS } from "./outbox";
import { layout, type EmailContent, type Tone } from "./templates";

export type RenderInput = {
  id: string;
  tenantId: string | null;
  kind: string;
  recipient: string;
  bookingId: string | null;
  payload: unknown;
};

export type RenderResult = { send: true; content: EmailContent } | { send: false; reason: string };

const SPORT: Record<string, string> = {
  FOOTBALL_5: "Fútbol 5",
  FOOTBALL_7: "Fútbol 7",
  FOOTBALL_8: "Fútbol 8",
  FOOTBALL_11: "Fútbol 11",
  PADEL: "Pádel",
  TENNIS: "Tenis",
  OTHER: "Otro",
};

const STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Pendiente", tone: "warn" },
  CONFIRMED: { label: "Confirmada", tone: "ok" },
  CANCELLED: { label: "Cancelada", tone: "bad" },
  REJECTED: { label: "Rechazada", tone: "bad" },
  EXPIRED: { label: "Vencida", tone: "bad" },
  COMPLETED: { label: "Jugada", tone: "info" },
  NO_SHOW: { label: "No se presentó", tone: "bad" },
};

const REMINDER_KINDS = new Set(["booking_reminder", "booking_reminder_24h", "booking_reminder_2h"]);

const appUrl = () => getEnv().BETTER_AUTH_URL.replace(/\/$/, "");
const durationLabel = (min: number) => (min % 60 === 0 ? `${min / 60} h` : min > 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

/**
 * Arma el email EN EL MOMENTO DEL ENVÍO a partir de la base:
 *  - respeta los ajustes actuales del complejo y del jugador (desactivados => SKIPPED);
 *  - descarta avisos que ya no corresponden (p. ej. "confirmada" de una reserva que luego se
 *    canceló, o un recordatorio de un turno reprogramado o que ya empezó);
 *  - el enlace privado del jugador se calcula ahora (HMAC), no se guarda en la cola;
 *  - cada consulta filtra por el complejo del aviso: un email nunca mezcla datos de otro complejo.
 */
export async function renderNotification(tx: Tx, n: RenderInput, now: Date): Promise<RenderResult> {
  const p = (n.payload ?? {}) as Record<string, unknown>;

  // ---------------------------------------------------------------- Cuenta (sin complejo)
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

  if (n.kind === "email_verification") {
    if (typeof p.sealedUrl !== "string") return { send: false, reason: "missing_link" };
    const user = await tx.user.findUnique({ where: { email: n.recipient }, select: { emailVerified: true, isDisabled: true } });
    if (!user || user.isDisabled) return { send: false, reason: "user_inactive" };
    if (user.emailVerified) return { send: false, reason: "already_verified" };
    const url = await unseal(p.sealedUrl);
    return {
      send: true,
      content: layout({
        preheader: "Confirmá tu email para TURNUP",
        title: "Confirmá tu email",
        intro: "Tocá el botón para confirmar que esta dirección es tuya. El enlace vence en 24 horas.",
        cta: { label: "Confirmar mi email", url },
        note: "Confirmarlo nos permite avisarte de tus reservas y ayudarte a recuperar la cuenta. Si no creaste una cuenta en TURNUP, ignorá este email.",
        footer: "TURNUP · Email de verificación de cuenta.",
      }),
    };
  }

  if (n.kind === "player_welcome") {
    const user = await tx.user.findUnique({ where: { email: n.recipient }, select: { name: true, isDisabled: true } });
    if (!user || user.isDisabled) return { send: false, reason: "user_inactive" };
    const first = user.name.trim().split(/\s+/)[0] ?? "";
    return {
      send: true,
      content: layout({
        preheader: "Tu cuenta de TURNUP está lista",
        title: `¡Bienvenido/a a TURNUP${first ? `, ${first}` : ""}!`,
        intro: "Ya podés reservar canchas en los complejos de TURNUP y seguir todos tus turnos desde un solo lugar.",
        cta: { label: "Buscar una cancha", url: `${appUrl()}/explorar` },
        secondaryCta: { label: "Ir a Mis turnos", url: `${appUrl()}/mis-turnos` },
        note: "Te avisamos por email cuando un complejo confirme, cambie o cancele tus reservas. Podés elegir qué avisos recibir desde tu perfil.",
        footer: "TURNUP · Recibís este email porque creaste una cuenta de jugador.",
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
        note: `La invitación vence el ${fmtDate(inv.expiresAt)} y sirve una sola vez.`,
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
        intro: "Tu complejo ya tiene panel y página de reservas. En unos minutos podés dejarlo listo: datos, canchas, horarios, precios, datos para transferencias y reglas, paso a paso.",
        cta: { label: t.onboardingCompletedAt ? "Ir a mi panel" : "Empezar la puesta en marcha", url: `${appUrl()}/panel/${t.slug}${t.onboardingCompletedAt ? "" : "/bienvenida"}` },
        note: `Tu página pública para compartir con tus clientes: ${appUrl()}/${t.slug}`,
        footer: "TURNUP · Recibís este email porque te dieron de alta como responsable de un complejo.",
      }),
    };
  }

  // ---------------------------------------------------------------- Superadministrador
  if (n.kind.startsWith("admin_")) {
    const admin = await tx.user.findUnique({ where: { email: n.recipient }, select: { platformRole: true, isDisabled: true } });
    // El correo de prueba puede ir a una dirección autorizada que no sea superadmin (la elige el superadmin).
    if (n.kind !== "admin_test" && (!admin || admin.isDisabled || admin.platformRole !== "SUPERADMIN")) return { send: false, reason: "not_superadmin" };
    const footer = "TURNUP · Aviso para el superadministrador de la plataforma.";
    switch (n.kind) {
      case "admin_test":
        return { send: true, content: layout({ preheader: "Prueba de envío", title: "Correo de prueba de TURNUP", intro: "Si leés esto, el envío por el proveedor de correo funciona. Revisá también en qué carpeta llegó (Recibidos, Promociones o Spam) y el remitente que se muestra.", rows: [["Enviado", fmtDateTime(now)]], cta: { label: "Abrir panel de correos", url: `${appUrl()}/admin/correos` }, footer }) };
      case "admin_tenant_created": {
        if (!n.tenantId) return { send: false, reason: "no_tenant" };
        const t = await tx.tenant.findUnique({ where: { id: n.tenantId }, select: { name: true, slug: true, city: true, createdAt: true } });
        if (!t) return { send: false, reason: "tenant_missing" };
        return { send: true, content: layout({ preheader: `Nuevo complejo: ${t.name}`, title: "Nuevo complejo registrado", intro: `Se dio de alta ${t.name} en TURNUP.`, rows: [["Complejo", t.name], ["Dirección web", `/${t.slug}`], ...(t.city ? ([["Ciudad", t.city]] as [string, string][]) : []), ["Alta", fmtDateTime(t.createdAt)]], cta: { label: "Ver complejo", url: `${appUrl()}/admin/complejos/${n.tenantId}` }, footer }) };
      }
      case "admin_quota_warning":
        return { send: true, content: layout({ preheader: "Cupo diario de emails", title: `Se usó el ${Number(p.level) || 80}% del cupo diario de emails`, intro: "Los recordatorios y bienvenidas dejan de salir antes de agotar el cupo; contraseñas, verificaciones y confirmaciones tienen lugar reservado. Lo que no salga hoy se aplaza al día siguiente.", rows: [["Usados hoy", `${Number(p.used) || 0} de ${Number(p.limit) || 0}`], ["Fecha", fmtDate(now)]], cta: { label: "Ver correos", url: `${appUrl()}/admin/correos` }, footer }) };
      case "admin_email_failures":
        return {
          send: true,
          content: layout({
            preheader: "Problemas con el envío de emails",
            title: p.reason === "provider_down" ? "El proveedor de email rechaza los envíos" : "Varios emails no se pudieron enviar",
            intro: p.reason === "provider_down" ? "La cuenta del proveedor no aceptó envíos (clave, créditos o remitente). Los emails quedaron en cola y se reintentan solos; revisá la configuración." : `Hubo ${Number(p.failed) || 0} envíos fallidos en la última hora.`,
            ...(typeof p.error === "string" ? { rows: [["Último error", p.error]] as [string, string][] } : {}),
            cta: { label: "Revisar correos", url: `${appUrl()}/admin/correos?estado=FAILED` },
            footer,
          }),
        };
      default:
        return { send: false, reason: "unknown_kind" };
    }
  }

  // ---------------------------------------------------------------- Complejo
  if (!n.tenantId) return { send: false, reason: "no_tenant" };
  const tenant = await tx.tenant.findUnique({
    where: { id: n.tenantId },
    select: {
      slug: true, name: true, timezone: true, contactPhone: true, contactEmail: true, address: true, city: true, status: true,
      notificationsEnabled: true, notifyPlayers: true, notifyOwner: true, ownerEmailMuted: true,
    },
  });
  if (!tenant || tenant.status !== "ACTIVE") return { send: false, reason: "tenant_inactive" };
  if (!tenant.notificationsEnabled) return { send: false, reason: "tenant_disabled" };
  const isPlayer = (PLAYER_KINDS as readonly string[]).includes(n.kind);
  const isOwner = (OWNER_KINDS as readonly string[]).includes(n.kind);
  if (isPlayer && !tenant.notifyPlayers) return { send: false, reason: "players_disabled" };
  if (isOwner && !tenant.notifyOwner) return { send: false, reason: "owner_disabled" };
  if (isOwner && (OWNER_MUTABLE_KINDS as readonly string[]).includes(n.kind) && tenant.ownerEmailMuted.includes(n.kind)) return { send: false, reason: "owner_muted" };
  const tz = tenant.timezone;
  const contact = [tenant.contactPhone, tenant.contactEmail, [tenant.address, tenant.city].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || undefined;
  const playerFooter = `${tenant.name} — Reserva gestionada con TURNUP. TURNUP no recibe ni retiene el dinero de las reservas.`;
  const ownerFooter = "TURNUP · Avisos al complejo. Elegí cuáles recibir en Ajustes → Avisos por email.";
  const replyTo = tenant.contactEmail;

  if (n.kind === "owner_digest") {
    const to = new Date(now.getTime() + 24 * 3_600_000);
    const list = await tx.booking.findMany({
      where: { tenantId: n.tenantId, status: { in: ["PENDING", "CONFIRMED"] }, startsAt: { gte: now, lt: to } },
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
        rows: list.slice(0, 30).map((b) => [`${fmtTime(b.startsAt, tz)} · ${b.court.name}`, `${b.customerName}${b.status === "PENDING" ? " (pendiente)" : ""}`]),
        cta: { label: "Abrir calendario", url: `${appUrl()}/panel/${tenant.slug}/calendario` },
        note: list.length > 30 ? `Y ${list.length - 30} más en el panel.` : undefined,
        footer: "TURNUP · Podés desactivar este resumen en Ajustes del complejo.",
      }),
    };
  }

  if (n.kind === "owner_subscription_notice") {
    if (typeof p.subscriptionId !== "string") return { send: false, reason: "missing_subscription" };
    const sub = await tx.subscription.findFirst({
      where: { id: p.subscriptionId, tenantId: n.tenantId },
      select: { status: true, currentPeriodEnd: true, plan: { select: { name: true } } },
    });
    if (!sub) return { send: false, reason: "subscription_missing" };
    // Si ya se renovó (otro período más largo), el aviso no corresponde.
    const newer = await tx.subscription.count({ where: { tenantId: n.tenantId, currentPeriodEnd: { gt: sub.currentPeriodEnd }, status: { in: ["TRIAL", "ACTIVE"] } } });
    if (newer > 0 || (typeof p.periodEnd === "string" && p.periodEnd !== sub.currentPeriodEnd.toISOString())) return { send: false, reason: "renewed" };
    const expired = p.stage === "expired";
    const trial = sub.status === "TRIAL";
    return {
      send: true,
      content: layout({
        preheader: expired ? "Tu suscripción venció" : "Tu suscripción vence pronto",
        title: expired ? `${trial ? "Terminó la prueba gratuita" : "Venció la suscripción"} de ${tenant.name}` : `${trial ? "La prueba gratuita" : "La suscripción"} de ${tenant.name} vence pronto`,
        intro: expired
          ? "Para seguir recibiendo reservas sin interrupciones, comunicate con TURNUP para renovar el plan."
          : `Vence el ${fmtDate(sub.currentPeriodEnd, tz)}. Comunicate con TURNUP para renovarla y evitar interrupciones.`,
        badge: expired ? { label: "Vencida", tone: "bad" } : { label: "Por vencer", tone: "warn" },
        rows: [["Plan", sub.plan.name], ["Vencimiento", fmtDate(sub.currentPeriodEnd, tz)]],
        cta: { label: "Ver mi plan", url: `${appUrl()}/panel/${tenant.slug}/plan` },
        footer: ownerFooter,
      }),
    };
  }

  // ---------------------------------------------------------------- Reservas
  if (!n.bookingId) return { send: false, reason: "no_booking" };
  const b = await tx.booking.findFirst({
    where: { id: n.bookingId, tenantId: n.tenantId },
    select: {
      id: true, code: true, status: true, startsAt: true, endsAt: true, durationMinutes: true, priceAmount: true,
      currency: true, customerName: true, expiresAt: true, playerUserId: true, paymentStatus: true, amountDue: true, transferSnapshot: true,
      cancelReason: true, paymentReceivedAmount: true,
      court: { select: { name: true, sport: true } },
    },
  });
  if (!b) return { send: false, reason: "booking_missing" };
  // Preferencias del jugador con cuenta (los invitados reciben solo los avisos que el complejo tenga activos).
  if (isPlayer && b.playerUserId) {
    const pref = await tx.playerProfile.findUnique({ where: { userId: b.playerUserId }, select: { notifyEmail: true, notifyReminders: true } });
    if (pref && !pref.notifyEmail) return { send: false, reason: "player_opted_out" };
    if (pref && REMINDER_KINDS.has(n.kind) && !pref.notifyReminders) return { send: false, reason: "player_no_reminders" };
  }

  const money = (cents: number | null) => fmtMoney(cents, b.currency);
  const hasDeposit = b.amountDue !== null && b.priceAmount !== null && b.amountDue < b.priceAmount;
  const balance = b.priceAmount !== null && b.amountDue !== null ? Math.max(0, b.priceAmount - b.amountDue) : null;
  const status = STATUS[b.status] ?? { label: b.status, tone: "info" as Tone };
  const rows: [string, string][] = [
    ["Complejo", tenant.name],
    ["Cancha", b.court.name],
    ["Deporte", SPORT[b.court.sport] ?? "—"],
    ["Fecha", fmtWeekdayDate(b.startsAt, tz)],
    ["Horario", `${fmtTime(b.startsAt, tz)} a ${fmtTime(b.endsAt, tz)}`],
    ["Duración", durationLabel(b.durationMinutes)],
    ["Código", b.code],
    ["Precio total", b.priceAmount === null ? "A confirmar por el complejo" : money(b.priceAmount)],
    ...(b.amountDue !== null ? ([[hasDeposit ? "Seña" : "A transferir", money(b.amountDue)]] as [string, string][]) : []),
    ...(hasDeposit && balance ? ([["Saldo a pagar en el complejo", money(balance)]] as [string, string][]) : []),
    ...(b.amountDue === null && b.priceAmount !== null ? ([["Pago", "En el complejo"]] as [string, string][]) : []),
    ["Estado", status.label],
  ];
  const tracking = `${appUrl()}${trackingPath(tenant.slug, b.code, b.id)}`;
  const misTurnos = `${appUrl()}/mis-turnos`;
  // Con cuenta: Mis turnos primero. Invitado: el enlace privado (Mis turnos requiere cuenta).
  const ctas = b.playerUserId
    ? { cta: { label: "Ir a Mis turnos", url: misTurnos }, secondaryCta: { label: "Ver esta reserva", url: tracking } }
    : { cta: { label: "Ver mi reserva", url: tracking }, secondaryCta: { label: "Mis turnos", url: misTurnos } };
  const first = b.customerName.trim().split(/\s+/)[0] ?? "";
  const when = `${fmtWeekdayDate(b.startsAt, tz)} ${fmtTime(b.startsAt, tz)}`;
  const panelLink = { label: "Abrir en el panel", url: `${appUrl()}/panel/${tenant.slug}/reservas/${b.id}` };
  const player = (o: { preheader: string; title: string; intro: string; tone?: Tone; badge?: string; note?: string; extraRows?: [string, string][]; cta?: { label: string; url: string } | null }) =>
    layout({
      preheader: o.preheader,
      title: o.title,
      intro: o.intro,
      badge: { label: o.badge ?? status.label, tone: o.tone ?? status.tone },
      rows: [...rows, ...(o.extraRows ?? [])],
      ...(o.cta === null ? {} : o.cta ? { cta: o.cta, secondaryCta: { label: "Mis turnos", url: misTurnos } } : ctas),
      note: o.note,
      contact,
      footer: playerFooter,
      replyTo,
    });
  const owner = (o: { preheader: string; title: string; intro: string; cta?: { label: string; url: string } }) =>
    layout({ preheader: o.preheader, title: o.title, intro: o.intro, badge: { label: status.label, tone: status.tone }, rows: [...rows, ["Jugador", b.customerName]], cta: o.cta ?? panelLink, footer: ownerFooter });

  switch (n.kind) {
    case "booking_requested":
      if (b.status !== "PENDING") return { send: false, reason: "stale" };
      return {
        send: true,
        content: player({
          preheader: `Solicitud recibida para ${when}`,
          title: `Recibimos tu solicitud, ${first}`,
          intro: `${tenant.name} tiene que aprobarla. Te avisamos apenas la confirme.`,
          badge: "Pendiente de aprobación",
          extraRows: b.expiresAt ? [["El complejo responde antes de", fmtDateTime(b.expiresAt, tz)]] : [],
          note: "Si el complejo no responde a tiempo, la solicitud vence y el turno se libera.",
        }),
      };
    case "booking_confirmed":
      if (b.status !== "CONFIRMED") return { send: false, reason: "stale" };
      return { send: true, content: player({ preheader: `Confirmado: ${when}`, title: "¡Tu turno está confirmado!", intro: `${first}, te esperamos en ${tenant.name}.`, note: "Con el enlace podés consultar la reserva o cancelarla dentro del plazo del complejo." }) };
    case "payment_approved":
      if (b.status !== "CONFIRMED") return { send: false, reason: "stale" };
      return {
        send: true,
        content: player({
          preheader: `Pago aprobado: ${when}`,
          title: "Pago aprobado: tu turno está confirmado",
          intro: `${tenant.name} verificó tu transferencia. ${first}, ¡te esperamos!`,
          extraRows: b.paymentReceivedAmount !== null ? [["Recibido por el complejo", money(b.paymentReceivedAmount)]] : [],
          note: hasDeposit ? "El saldo se paga en el complejo." : undefined,
        }),
      };
    case "payment_rejected":
      if (b.status !== "REJECTED") return { send: false, reason: "stale" };
      return {
        send: true,
        content: player({
          preheader: "No se pudo verificar tu transferencia",
          title: "No se pudo verificar tu pago",
          intro: `${tenant.name} no encontró o no aceptó la transferencia informada, y la reserva quedó rechazada.`,
          extraRows: b.cancelReason ? [["Motivo", b.cancelReason]] : [],
          note: "Si ya transferiste, comunicate con el complejo con el comprobante: la devolución la resuelve el complejo directamente (TURNUP no recibe ni devuelve dinero).",
          cta: { label: "Reservar otro turno", url: `${appUrl()}/${tenant.slug}` },
        }),
      };
    case "booking_cancelled": {
      // Avisos encolados antes de la Fase 6: el rechazo usaba este tipo.
      if (b.status === "REJECTED" && p.by === "rejected") return renderNotification(tx, { ...n, kind: "booking_rejected" }, now);
      if (b.status !== "CANCELLED") return { send: false, reason: "stale" };
      const intro = p.by === "player" ? "Cancelaste tu reserva." : `${tenant.name} canceló tu reserva.`;
      return {
        send: true,
        content: player({
          preheader: "Reserva cancelada",
          title: "Reserva cancelada",
          intro,
          extraRows: p.by !== "player" && b.cancelReason ? [["Motivo", b.cancelReason]] : [],
          note: b.amountDue !== null && b.paymentStatus === "VERIFIED" ? "Si pagaste una seña, la devolución se acuerda con el complejo." : "El turno quedó libre.",
          cta: { label: "Reservar otro turno", url: `${appUrl()}/${tenant.slug}` },
        }),
      };
    }
    case "booking_rejected":
      if (b.status !== "REJECTED") return { send: false, reason: "stale" };
      return {
        send: true,
        content: player({
          preheader: "Solicitud rechazada",
          title: "Tu solicitud fue rechazada",
          intro: `${tenant.name} no pudo aceptar tu solicitud.`,
          extraRows: b.cancelReason ? [["Motivo", b.cancelReason]] : [],
          cta: { label: "Buscar otro horario", url: `${appUrl()}/${tenant.slug}` },
        }),
      };
    case "booking_rescheduled": {
      if (b.status !== "PENDING" && b.status !== "CONFIRMED") return { send: false, reason: "stale" };
      const from = typeof p.fromStartsAt === "string" ? `${fmtWeekdayDate(new Date(p.fromStartsAt), tz)} ${fmtTime(new Date(p.fromStartsAt), tz)}` : "";
      return {
        send: true,
        content: player({
          preheader: `Nuevo horario: ${when}`,
          title: "Tu reserva cambió",
          intro: `${tenant.name} modificó tu turno${from ? ` (antes: ${from}${typeof p.fromCourtName === "string" ? `, ${p.fromCourtName}` : ""})` : ""}. Estos son los datos actualizados.`,
        }),
      };
    }
    case "booking_reminder":
    case "booking_reminder_24h":
    case "booking_reminder_2h": {
      if (b.status !== "CONFIRMED" || b.startsAt <= now) return { send: false, reason: "stale" };
      if (typeof p.startsAt === "string" && p.startsAt !== b.startsAt.toISOString()) return { send: false, reason: "rescheduled" };
      // Un recordatorio de 24 h que se atrasó hasta menos de 3 h ya no aporta (sale el de 2 h).
      if (n.kind === "booking_reminder_24h" && b.startsAt.getTime() - now.getTime() < 3 * 3_600_000) return { send: false, reason: "stale" };
      const tomorrow = n.kind === "booking_reminder_24h";
      return {
        send: true,
        content: player({
          preheader: `Recordatorio: ${when}`,
          title: tomorrow ? `Mañana jugás a las ${fmtTime(b.startsAt, tz)}` : `Hoy jugás a las ${fmtTime(b.startsAt, tz)}`,
          intro: `${first}, este es un recordatorio de tu turno en ${tenant.name}.`,
          note: hasDeposit && balance ? `Recordá que el saldo (${money(balance)}) se paga en el complejo.` : undefined,
        }),
      };
    }
    case "booking_expired":
      if (b.status !== "EXPIRED") return { send: false, reason: "stale" };
      return {
        send: true,
        content: player({
          preheader: "Tu reserva venció",
          title: b.amountDue !== null ? "Venció el plazo para pagar" : "Tu solicitud venció",
          intro:
            b.paymentStatus === "TRANSFER_REPORTED"
              ? `${tenant.name} no llegó a verificar tu transferencia a tiempo y el turno se liberó. Si transferiste, comunicate con el complejo: ellos resuelven la reserva o la devolución.`
              : b.amountDue !== null
                ? "No se informó la transferencia dentro del plazo y el turno se liberó."
                : `${tenant.name} no la confirmó a tiempo y el turno se liberó.`,
          cta: { label: "Buscar otro turno", url: `${appUrl()}/${tenant.slug}` },
        }),
      };
    case "booking_awaiting_transfer": {
      if (b.status !== "PENDING" || b.paymentStatus !== "AWAITING_TRANSFER") return { send: false, reason: "stale" };
      const snap = readTransferSnapshot(b.transferSnapshot);
      // Solo los datos necesarios para transferir (de la copia guardada al reservar).
      const bank: [string, string][] = snap
        ? ([
            snap.alias ? ["Alias", snap.alias] : null,
            snap.cbuCvu ? ["CBU / CVU", snap.cbuCvu] : null,
            snap.holderName ? ["Titular", snap.holderName] : null,
            snap.bankName ? ["Banco o billetera", snap.bankName] : null,
          ].filter(Boolean) as [string, string][])
        : [];
      return {
        send: true,
        content: player({
          preheader: `Transferí ${money(b.amountDue)} para confirmar tu turno`,
          title: "Transferí para confirmar tu turno",
          intro: `${first}, tu turno está reservado provisoriamente. Transferí ${money(b.amountDue)} a la cuenta de ${tenant.name} e informá el pago desde tu reserva.`,
          badge: "Pendiente de pago",
          tone: "warn",
          extraRows: [...bank, ...(b.expiresAt ? ([["Transferí antes de", fmtDateTime(b.expiresAt, tz)]] as [string, string][]) : [])],
          cta: { label: "Ya transferí: informar pago", url: tracking },
          note: "La transferencia va directo a la cuenta del complejo: TURNUP no recibe ni retiene dinero. No hace falta adjuntar comprobante. Si el plazo vence, el turno se libera.",
        }),
      };
    }
    case "booking_transfer_reported":
      if (b.status !== "PENDING" || b.paymentStatus !== "TRANSFER_REPORTED") return { send: false, reason: "stale" };
      return {
        send: true,
        content: player({
          preheader: "Recibimos tu aviso de transferencia",
          title: "Transferencia informada",
          intro: `Le avisamos a ${tenant.name} que transferiste. Cuando verifique el dinero en su cuenta, te confirmamos el turno por email.`,
          badge: "Pago en verificación",
          tone: "warn",
          extraRows: b.expiresAt ? [["El complejo verifica antes de", fmtDateTime(b.expiresAt, tz)]] : [],
          note: "Informar la transferencia no confirma el turno: lo confirma el complejo al ver el pago. Si no recibís respuesta, comunicate con el complejo.",
        }),
      };
    case "owner_transfer_reported":
      if (b.status !== "PENDING" || b.paymentStatus !== "TRANSFER_REPORTED") return { send: false, reason: "stale" };
      return { send: true, content: owner({ preheader: `${b.customerName} informó una transferencia`, title: "Transferencia para verificar", intro: `${b.customerName} informó que transfirió${b.amountDue !== null ? ` ${money(b.amountDue)}` : ""}. Revisá tu cuenta bancaria y confirmá o rechazá antes de ${b.expiresAt ? fmtDateTime(b.expiresAt, tz) : "que venza el plazo"}. Informar no es pagar: verificá el dinero antes de confirmar.`, cta: { label: "Verificar transferencia", url: `${appUrl()}/panel/${tenant.slug}/transferencias` } }) };
    case "owner_transfer_expiring":
      if (b.status !== "PENDING" || b.paymentStatus !== "TRANSFER_REPORTED" || !b.expiresAt || b.expiresAt <= now) return { send: false, reason: "stale" };
      return { send: true, content: owner({ preheader: "Una transferencia está por vencer", title: "Transferencia por vencer sin verificar", intro: `La transferencia informada por ${b.customerName} vence a las ${fmtTime(b.expiresAt, tz)}. Si no la verificás, la reserva vence y el turno se libera.`, cta: { label: "Verificar ahora", url: `${appUrl()}/panel/${tenant.slug}/transferencias` } }) };
    case "owner_payment_incident":
      return { send: true, content: owner({ preheader: `Incidencia de pago · ${b.code}`, title: "Incidencia de pago para resolver", intro: `Hay una incidencia de pago (${INCIDENT_LABEL[p.kind as keyof typeof INCIDENT_LABEL] ?? "otra"}) en la reserva de ${b.customerName}.`, cta: { label: "Ver incidencias", url: `${appUrl()}/panel/${tenant.slug}/transferencias?estado=incidencias` } }) };
    case "owner_new_request":
      return { send: true, content: owner({ preheader: `Nueva reserva de ${b.customerName}`, title: b.status === "PENDING" ? (b.paymentStatus === "AWAITING_TRANSFER" ? "Nueva reserva esperando transferencia" : "Nueva solicitud para aprobar") : "Nueva reserva online", intro: b.status === "PENDING" ? (b.paymentStatus === "AWAITING_TRANSFER" ? `${b.customerName} reservó y tiene que transferir${b.amountDue !== null ? ` ${money(b.amountDue)}` : ""}. Te avisamos cuando informe el pago.` : `${b.customerName} pidió un turno. Aprobalo antes de que venza.`) : `${b.customerName} reservó un turno online.` }) };
    case "owner_booking_cancelled":
      return { send: true, content: owner({ preheader: `${b.customerName} canceló`, title: "Un jugador canceló su reserva", intro: `${b.customerName} canceló su reserva. El turno quedó libre.` }) };
    default:
      return { send: false, reason: "unknown_kind" };
  }
}
