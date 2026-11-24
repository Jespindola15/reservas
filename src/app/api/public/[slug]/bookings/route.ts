import { PUBLIC_ACTOR } from "@/lib/audit";
import { enforceIpRateLimit, jsonError, jsonOk, readJson } from "@/lib/http";
import { getClientIp } from "@/lib/security/client-ip";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation";
import { publicBookingRequestSchema } from "@/modules/booking/schemas";
import { createBooking } from "@/modules/booking/service";
import { trackingPath } from "@/modules/booking/public-access";
import { publicTenantContext } from "@/modules/tenant/public";
import { getCurrentUser } from "@/lib/auth/dal";
import { getEnv } from "@/lib/env";

/**
 * Si hay sesión de jugador, la reserva se asocia a su cuenta. Solo si la petición viene
 * de nuestro propio origen (la cookie no alcanza): así otro sitio no puede crear reservas
 * a nombre de un jugador con sesión abierta (CSRF). Sin eso, se reserva como invitado.
 */
async function sessionPlayerId(req: Request): Promise<string | null> {
  const origin = req.headers.get("origin");
  const own = new URL(getEnv().BETTER_AUTH_URL).origin;
  if (!origin || origin !== own) return null;
  const user = await getCurrentUser().catch(() => null);
  return user?.id ?? null;
}

/**
 * Solicitud pública de reserva.
 * - Sin sesión ni cookies => no aplica CSRF; el riesgo es el abuso, que se
 *   mitiga con rate limiting por IP y por IP+complejo.
 * - El tenant sale del slug de la URL; el cuerpo NO puede indicar tenant,
 *   estado, precio ni origen: los decide el servidor.
 * - Idempotency-Key obligatoria (en el cuerpo) para que reintentos/doble clic
 *   no dupliquen la reserva.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const ip = getClientIp(req.headers);
    await enforceIpRateLimit(ip, "book", { window: 600, max: 20 });
    await enforceIpRateLimit(ip, `book:t:${slug}`, { window: 600, max: 8 });

    const body = parseOrThrow(publicBookingRequestSchema, await readJson(req));
    if (body.website) {
      logger.warn("booking.honeypot", { slug });
      throw new AppError("VALIDATION_ERROR");
    }
    const ctx = await publicTenantContext(slug);
    const playerUserId = await sessionPlayerId(req);
    const { booking, replayed } = await createBooking(
      ctx,
      {
        courtId: body.courtId,
        startsAt: new Date(body.startsAt),
        durationMinutes: body.durationMinutes,
        customer: body.customer,
        notes: body.notes,
        idempotencyKey: body.idempotencyKey,
        source: "ONLINE",
        playerUserId,
        origin: body.origin ?? "DIRECT",
      },
      PUBLIC_ACTOR(ip === "unknown" ? null : ip),
    );
    // Respuesta mínima: no se devuelven ids internos de cliente ni datos de otros.
    return jsonOk(
      {
        code: booking.code,
        status: booking.status,
        startsAt: booking.startsAt.toISOString(),
        endsAt: booking.endsAt.toISOString(),
        priceAmount: booking.priceAmount,
        currency: booking.currency,
        expiresAt: booking.expiresAt?.toISOString() ?? null,
        // Enlace PRIVADO para consultar/cancelar (código + token HMAC). Se muestra una sola vez al jugador.
        trackingUrl: trackingPath(slug, booking.code, booking.id),
        replayed,
        linkedToAccount: Boolean(playerUserId),
      },
      replayed ? 200 : 201,
    );
  } catch (e) {
    return jsonError(e, { route: "public.bookings" });
  }
}
