import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AppError, isAppError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { consumeRateLimit, type RateLimitRule } from "@/lib/security/rate-limit";

const SECURITY_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export function jsonOk(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: SECURITY_HEADERS });
}

/** Respuesta de error segura: los errores internos se registran y nunca se exponen. */
export function jsonError(e: unknown, context: Record<string, unknown> = {}) {
  const { status, body } = toPublicError(e);
  const requestId = randomUUID();
  if (!isAppError(e)) logger.error("http.unhandled_error", e, { requestId, ...context });
  // Errores de negocio (4xx): antes no dejaban rastro y eso impidió diagnosticar reservas fallidas.
  // Solo código y nombres de campos inválidos: nunca valores enviados (datos personales).
  else logger.warn("http.app_error", { requestId, code: e.code, status, fields: Array.isArray(e.details?.fields) ? e.details.fields : undefined, ...context });
  const headers: Record<string, string> = { ...SECURITY_HEADERS };
  if (isAppError(e) && e.code === "RATE_LIMITED" && typeof e.details?.retryAfter === "number") {
    headers["Retry-After"] = String(e.details.retryAfter);
  }
  return NextResponse.json({ error: { ...body, requestId } }, { status, headers });
}

/**
 * Límite por IP. Si la IP es "unknown" (proxy sin configurar), en lugar de que
 * TODOS compartan el cupo normal (bloqueo global por mala configuración), se usa
 * un techo global 20 veces mayor que sigue frenando abusos masivos.
 */
export async function enforceIpRateLimit(ip: string, key: string, rule: RateLimitRule) {
  return enforceRateLimit(`${key}:ip:${ip}`, ip === "unknown" ? { window: rule.window, max: rule.max * 20 } : rule);
}

export async function enforceRateLimit(key: string, rule: RateLimitRule) {
  const res = await consumeRateLimit(key, rule);
  if (!res.allowed) throw new AppError("RATE_LIMITED", { retryAfter: res.retryAfter ?? rule.window });
}

/** Lee JSON con tope de tamaño (evita cuerpos gigantes) y content-type correcto. */
export async function readJson(req: Request, maxBytes = 8_192): Promise<unknown> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new AppError("VALIDATION_ERROR", { reason: "content-type" });
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new AppError("VALIDATION_ERROR", { reason: "too_large" });
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_ERROR", { reason: "json" });
  }
}
