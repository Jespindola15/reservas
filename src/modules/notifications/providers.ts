import { emailProviderName, getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Clave de idempotencia del proveedor (= id de la notificación). */
  idempotencyKey: string;
};

export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; retryable: boolean; error: string };

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
        body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
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
    return { ok: false, retryable, error: sanitizeError(`resend ${res.status}: ${text}`) };
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
  private failures: { retryable: boolean; error: string }[] = [];

  failNext(times: number, retryable = true, error = "simulated failure") {
    for (let i = 0; i < times; i++) this.failures.push({ retryable, error });
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
  return new ResendProvider(env.RESEND_API_KEY ?? "", env.EMAIL_FROM);
}
