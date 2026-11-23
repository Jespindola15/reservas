import { enforceRateLimit, jsonError, jsonOk } from "@/lib/http";
import { getClientIp } from "@/lib/security/client-ip";
import { parseOrThrow } from "@/lib/validation";
import { getDayAvailability } from "@/modules/booking/availability";
import { availabilityQuerySchema } from "@/modules/booking/schemas";
import { publicTenantContext } from "@/modules/tenant/public";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const ip = getClientIp(req.headers);
    await enforceRateLimit(`avail:ip:${ip}`, { window: 60, max: 120 });

    const url = new URL(req.url);
    const q = parseOrThrow(availabilityQuerySchema, {
      date: url.searchParams.get("date"),
      duration: url.searchParams.get("duration"),
      courtId: url.searchParams.get("courtId") ?? undefined,
    });
    const ctx = await publicTenantContext(slug);
    const day = await getDayAvailability(ctx, {
      operatingDate: q.date,
      durationMinutes: q.duration,
      courtId: q.courtId,
    });
    return jsonOk(day);
  } catch (e) {
    return jsonError(e, { route: "public.availability" });
  }
}
