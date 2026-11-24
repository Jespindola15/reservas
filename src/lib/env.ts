import { z } from "zod";

/**
 * Variables de entorno validadas al arrancar. Si falta algo o es inseguro en
 * producción, la app no inicia (mejor fallar temprano que operar mal configurada).
 * Solo para código de servidor: nunca importar desde componentes cliente.
 */
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url(),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET debe tener al menos 32 caracteres"),
    BETTER_AUTH_URL: z.url(),
    /**
     * Cantidad de proxies confiables delante de la app (0 = ninguno).
     * Con 1, la IP del cliente es la última entrada de X-Forwarded-For.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    /**
     * Cabecera con la IP del cliente que tu proxy SOBRESCRIBE (p. ej.
     * "x-real-ip" o "cf-connecting-ip"). Vacía = no se confía en ninguna.
     */
    AUTH_CLIENT_IP_HEADER: z
      .string()
      .regex(/^[a-z0-9-]*$/)
      .default(""),
    /**
     * Secreto para disparar el job de vencimiento desde un cron externo
     * (POST /api/internal/jobs/expire-pending). Vacío = endpoint deshabilitado.
     */
    CRON_SECRET: z.union([z.literal(""), z.string().min(32)]).default(""),
    /** Programador interno de vencimientos (en el proceso del servidor). */
    EXPIRATION_SCHEDULER: z.enum(["internal", "off"]).default("internal"),
    EXPIRATION_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3600).default(60),
    /**
     * Proveedor de email. Por defecto: memory en test (nunca envía), log en
     * desarrollo, disabled en producción hasta que se configure Resend.
     */
    EMAIL_PROVIDER: z.enum(["resend", "log", "memory", "disabled"]).optional(),
    RESEND_API_KEY: z.string().optional(),
    /** Remitente verificado en Resend, p. ej. "TURNUP <avisos@tudominio.com>". */
    EMAIL_FROM: z.string().max(200).default("TURNUP <no-reply@turnup.invalid>"),
    /** Webhook (Slack/Discord compatible) para alertas críticas. Opcional. */
    ALERT_WEBHOOK_URL: z.union([z.literal(""), z.url()]).default(""),
    /** Almacenamiento de imágenes: database (actual) u object (S3/R2). */
    IMAGE_STORAGE: z.enum(["database", "object"]).default("database"),
    S3_ENDPOINT: z.string().default(""),
    S3_BUCKET: z.string().default(""),
    S3_REGION: z.string().default("auto"),
    S3_ACCESS_KEY_ID: z.string().default(""),
    S3_SECRET_ACCESS_KEY: z.string().default(""),
    /** Solo para probar el build de producción en la máquina local (http://localhost). */
    ALLOW_INSECURE_LOCALHOST: z.enum(["true", "false"]).default("false"),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_PROVIDER === "resend" && !env.RESEND_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "Requerida con EMAIL_PROVIDER=resend" });
    }
    if (env.IMAGE_STORAGE === "object" && !(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY)) {
      ctx.addIssue({ code: "custom", path: ["S3_ENDPOINT"], message: "IMAGE_STORAGE=object requiere S3_ENDPOINT, S3_BUCKET y credenciales" });
    }
    if (env.NODE_ENV !== "production") return;
    // Durante `next build` no se exigen los controles de producción: se aplican al arrancar el servidor.
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    const url = new URL(env.BETTER_AUTH_URL);
    const localInsecureOk =
      env.ALLOW_INSECURE_LOCALHOST === "true" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !localInsecureOk) {
      ctx.addIssue({ code: "custom", path: ["BETTER_AUTH_URL"], message: "En producción debe usar https" });
    }
    if (/test-secret|change-me|changeme/i.test(env.BETTER_AUTH_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["BETTER_AUTH_SECRET"], message: "Secreto de ejemplo en producción" });
    }
    if (/reservas_owner|postgres:/i.test(env.DATABASE_URL)) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "La app no debe conectarse con el rol dueño ni con superusuario (RLS no aplicaría)",
      });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/**
 * Durante `next build` (Netlify, CI) no hay secretos ni base: se usan valores
 * de marcador SOLO para poder evaluar los módulos. Ninguna página estática
 * consulta la base, y en runtime el proceso vuelve a validar el entorno real.
 */
const BUILD_PLACEHOLDERS = {
  DATABASE_URL: "postgresql://build:build@localhost:5432/build-placeholder",
  BETTER_AUTH_SECRET: "build-time-placeholder-secret-never-used-at-runtime",
  BETTER_AUTH_URL: "https://build.invalid",
};

export function getEnv(): Env {
  if (cached) return cached;
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  const source = isBuild ? { ...BUILD_PLACEHOLDERS, ...process.env } : process.env;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuración de entorno inválida: ${detail}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = () => getEnv().NODE_ENV === "production";

export function emailProviderName(): "resend" | "log" | "memory" | "disabled" {
  const env = getEnv();
  if (env.EMAIL_PROVIDER) return env.EMAIL_PROVIDER;
  return env.NODE_ENV === "test" ? "memory" : env.NODE_ENV === "production" ? "disabled" : "log";
}
