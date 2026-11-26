import { emailProviderName, getEnv, parseSender } from "@/lib/env";
import { logger } from "@/lib/logger";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Clave de idempotencia del proveedor (= id de la notificación, UUID). */
  idempotencyKey: string;
  /** A quién responder (p. ej. el email de contacto del complejo). */
  replyTo?: string | null;
  /** Categoría para filtrar en el proveedor (tipo de aviso). */
  tag?: string;
};

/**
 * Resultado del envío. "ok" significa ACEPTADO por el proveedor, no entregado: la entrega
 * (o el rebote) llega después por el webhook de eventos.
 *  - retryable: error temporal (red, 429, 5xx) → se reintenta con espera creciente.
 *  - providerDown: la cuenta no puede enviar (clave inválida, sin créditos, remitente no
 *    autorizado). Se corta el lote para no gastar intentos y se avisa al superadmin.
 */
export type SendResult =
  | { ok: true; providerMessageId: string; duplicate?: boolean }
  | { ok: false; retryable: boolean; error: string; providerDown?: boolean };

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

/** Oculta direcciones de email y cadenas tipo token antes de guardar o loguear un error. */
export function sanitizeError(raw: string): string {
  return raw
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>")
    .replace(/Bearer\s+\S+/gi, "Bearer <redacted>")
    .replace(/\b(token|key|secret|password|signature)=[^\s&"']+/gi, "$1=<redacted>")
    .replace(/\bre_[A-Za-z0-9_]{8,}/g, "<redacted>")
    .replace(/\bxkeysib-[A-Za-z0-9-]+/g, "<redacted>")
    .replace(/[A-Za-z0-9_-]{32,}/g, "<redacted>")
    .slice(0, 300);
}

/**
 * Resend (https://resend.com). Preparado pero APAGADO hasta que se configure
 * EMAIL_PROVIDER=resend + RESEND_API_KEY + EMAIL_FROM con dominio verificado.
 * No se probó contra el servicio real (sin cuenta): las pruebas usan un fetch simulado.
 */
export class ResendProvider implements EmailProvider {
  readonly name = "resend";
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(m: EmailMessage): Promise<SendResult> {
    let res: Response;
    try {
      res = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          // Resend descarta reenvíos con la misma clave (24 h): evita duplicados si
          // un worker se cae después de enviar y antes de registrar el éxito.
          "Idempotency-Key": m.idempotencyKey,
        },
        body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      return { ok: false, retryable: true, error: sanitizeError(`network: ${e instanceof Error ? e.message : String(e)}`) };
    }
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { id?: string };
      return { ok: true, providerMessageId: body.id ?? "unknown" };
    }
    const text = await res.text().catch(() => "");
    // 429 y 5xx: temporales. 4xx restantes (dirección inválida, dominio no verificado): permanentes.
    const retryable = res.status === 429 || res.status >= 500;
    const providerDown = res.status === 401 || res.status === 403;
    return { ok: false, retryable: retryable || providerDown, providerDown, error: sanitizeError(`resend ${res.status}: ${text}`) };
  }
}

/**
 * Brevo (API transaccional v3, https://api.brevo.com/v3/smtp/email). Solo desde el servidor.
 *  - Idempotencia: cabecera "idempotencyKey" (UUID, 30 min): un reintento del mismo aviso
 *    dentro de ese plazo no genera un segundo email.
 *  - 201 = aceptado (messageId). La entrega real se conoce por el webhook de eventos.
 */
export class BrevoProvider implements EmailProvider {
  readonly name = "brevo";
  constructor(
    private readonly apiKey: string,
    private readonly sender: { email: string; name: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(m: EmailMessage): Promise<SendResult> {
    let res: Response;
    try {
      res = await this.fetchImpl("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": this.apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          sender: this.sender,
          to: [{ email: m.to }],
          ...(m.replyTo ? { replyTo: { email: m.replyTo } } : {}),
          subject: m.subject,
          htmlContent: m.html,
          textContent: m.text,
          ...(m.tag ? { tags: [m.tag] } : {}),
          headers: { idempotencyKey: m.idempotencyKey },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      return { ok: false, retryable: true, error: sanitizeError(`network: ${e instanceof Error ? e.message : String(e)}`) };
    }
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { messageId?: string; messageIds?: string[] };
      return { ok: true, providerMessageId: body.messageId ?? body.messageIds?.[0] ?? "unknown" };
    }
    const raw = await res.text().catch(() => "");
    let code = "";
    try {
      code = String((JSON.parse(raw) as { code?: unknown }).code ?? "");
    } catch {
      code = "";
    }
    const error = sanitizeError(`brevo ${res.status}${code ? ` ${code}` : ""}: ${raw}`);
    // El mismo aviso ya se aceptó en los últimos 30 min (reintento tras una caída): no es un error.
    if (code === "duplicate_parameter" || code === "duplicate_request") return { ok: true, providerMessageId: "duplicate", duplicate: true };
    if (res.status === 429 || res.status >= 500) return { ok: false, retryable: true, error };
    // Problemas de la CUENTA (no del destinatario): clave, permisos, créditos, remitente.
    const accountProblem =
      res.status === 401 || res.status === 402 || res.status === 403 ||
      ["unauthorized", "permission_denied", "not_enough_credits", "account_under_validation"].includes(code) ||
      /credits|sender|ip address/i.test(raw);
    if (accountProblem) return { ok: false, retryable: true, providerDown: true, error };
    return { ok: false, retryable: false, error };
  }
}

/** Desarrollo: no envía nada; registra solo tipo y dominio del destinatario. */
export class LogProvider implements EmailProvider {
  readonly name = "log";
  async send(m: EmailMessage): Promise<SendResult> {
    logger.info("email.dev_log", { subject: m.subject, toDomain: m.to.split("@")[1] ?? "?" });
    return { ok: true, providerMessageId: `log-${m.idempotencyKey}` };
  }
}

/** Pruebas: guarda los mensajes en memoria y permite simular fallas. */
export class MemoryProvider implements EmailProvider {
  readonly name = "memory";
  readonly sent: EmailMessage[] = [];
  private failures: { retryable: boolean; error: string; providerDown?: boolean }[] = [];

  failNext(times: number, retryable = true, error = "simulated failure", providerDown = false) {
    for (let i = 0; i < times; i++) this.failures.push({ retryable, error, providerDown });
  }

  reset() {
    this.sent.length = 0;
    this.failures = [];
  }

  async send(m: EmailMessage): Promise<SendResult> {
    const f = this.failures.shift();
    if (f) return { ok: false, ...f };
    this.sent.push(m);
    return { ok: true, providerMessageId: `mem-${this.sent.length}` };
  }
}

const g = globalThis as unknown as { __turnupMemoryEmail?: MemoryProvider };

export function memoryEmailProvider(): MemoryProvider {
  g.__turnupMemoryEmail ??= new MemoryProvider();
  return g.__turnupMemoryEmail;
}

/** Proveedor activo según configuración, o null si los emails están desactivados. */
export function getEmailProvider(): EmailProvider | null {
  const name = emailProviderName();
  if (name === "disabled") return null;
  if (name === "memory") return memoryEmailProvider();
  if (name === "log") return new LogProvider();
  const env = getEnv();
  if (name === "brevo") {
    const sender = parseSender(env.EMAIL_FROM, env.EMAIL_FROM_NAME);
    // Mal configurado => sin proveedor: los avisos quedan en cola y /admin/correos lo informa.
    if (!env.BREVO_API_KEY || !sender) return null;
    return new BrevoProvider(env.BREVO_API_KEY, sender);
  }
  if (!env.RESEND_API_KEY) return null;
  return new ResendProvider(env.RESEND_API_KEY, env.EMAIL_FROM);
}
