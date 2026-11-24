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
      },
      replayed ? 200 : 201,
    );
  } catch (e) {
    return jsonError(e, { route: "public.bookings" });
  }
}
