import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { enforceIpRateLimit, jsonError } from "@/lib/http";
import { getClientIp } from "@/lib/security/client-ip";
import { applyDeliveryEvents, webhookAuthorized } from "@/modules/notifications/delivery";

/**
 * Webhook de eventos transaccionales de Brevo (entregado, rebote, bloqueado, spam…).
 * Requiere BREVO_WEBHOOK_SECRET (Bearer o Basic). Sin secreto configurado => 404.
 * No guarda el contenido del evento: solo el estado de entrega del aviso correspondiente.
 */
export async function POST(req: Request) {
  try {
    const secret = getEnv().BREVO_WEBHOOK_SECRET;
    if (!secret) return new NextResponse(null, { status: 404 });
    await enforceIpRateLimit(getClientIp(req.headers), "webhook:brevo", { window: 60, max: 120 });
    if (!webhookAuthorized(req.headers.get("authorization"), secret)) return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    const text = await req.text();
    if (text.length > 200_000) return NextResponse.json({ error: { code: "PAYLOAD_TOO_LARGE" } }, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR" } }, { status: 400 });
    }
    const events = (Array.isArray(body) ? body : [body]).filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null);
    const updated = await applyDeliveryEvents(events);
    return NextResponse.json({ ok: true, updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e, { route: "webhooks.brevo" });
  }
}
