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
     * Proveedor de email: brevo (activo), resend (alternativo), log (desarrollo), memory (pruebas)
     * o disabled. Un valor desconocido NO impide arrancar: los emails quedan desactivados y
     * /admin/correos lo informa (un error de configuración del correo nunca debe tirar el sitio).
     */
    EMAIL_PROVIDER: z.string().trim().toLowerCase().optional(),
    RESEND_API_KEY: z.string().optional(),
    /** Clave de la API transaccional de Brevo (solo servidor). */
    BREVO_API_KEY: z.string().trim().optional(),
    /** Remitente: "avisos@dominio" o "TURNUP <avisos@dominio>". Con Brevo, debe ser un remitente verificado. */
    EMAIL_FROM: z.string().max(200).default("TURNUP <no-reply@turnup.invalid>"),
    /** Nombre visible del remitente (si EMAIL_FROM no lo trae). */
    EMAIL_FROM_NAME: z.string().trim().max(70).default("TURNUP"),
    /** Límite diario del plan del proveedor (Brevo gratuito: 300). La app reserva cupo para lo crítico. */
    EMAIL_DAILY_LIMIT: z.coerce.number().int().min(1).max(1_000_000).default(300),
    /** Secreto del webhook de eventos de entrega de Brevo (Bearer o usuario/contraseña). Vacío = webhook apagado. */
    BREVO_WEBHOOK_SECRET: z.union([z.literal(""), z.string().min(24)]).default(""),
    /** Direcciones extra autorizadas para el correo de prueba del superadmin (separadas por coma). */
    EMAIL_TEST_RECIPIENTS: z.string().max(1000).default(""),
    /** Webhook (Slack/Discord compatible) para alertas críticas. Opcional. */
    ALERT_WEBHOOK_URL: z.union([z.literal(""), z.url()]).default(""),
    /** Almacenamiento de imágenes: database (actual) u object (protocolo S3: Supabase Storage). */
    IMAGE_STORAGE: z.enum(["database", "object"]).default("database"),
    /** Solo desarrollo/pruebas: permite guardar imágenes nuevas en PostgreSQL en producción. Nunca en el sitio real. */
    ALLOW_DB_IMAGES: z.enum(["true", "false"]).default("false"),
    S3_ENDPOINT: z.string().default(""),
    S3_BUCKET: z.string().default(""),
    S3_REGION: z.string().default("auto"),
    S3_ACCESS_KEY_ID: z.string().default(""),
    /** Base pública de lectura de las imágenes del catálogo, p. ej. https://<ref>.supabase.co/storage/v1/object/public/turnup-images */
    IMAGE_PUBLIC_BASE_URL: z.union([z.literal(""), z.url()]).default(""),
    /** Cupo de almacenamiento del proveedor (MB) para las alertas de consumo. Supabase gratuito: 1024. */
    IMAGE_STORAGE_QUOTA_MB: z.coerce.number().int().min(10).max(1_000_000).default(1024),
    S3_SECRET_ACCESS_KEY: z.string().default(""),
    /** Solo para probar el build de producción en la máquina local (http://localhost). */
    ALLOW_INSECURE_LOCALHOST: z.enum(["true", "false"]).default("false"),
  })
  .superRefine((env, ctx) => {
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
    let dbUser = "";
    try {
      dbUser = decodeURIComponent(new URL(env.DATABASE_URL).username).toLowerCase();
    } catch {
      dbUser = "";
    }
    // Rol dueño/administrador: local (reservas_owner, postgres) o el que crea Neon (<base>_owner, neon_superuser).
    if (!dbUser || dbUser === "postgres" || dbUser === "reservas_owner" || dbUser.endsWith("_owner") || dbUser.startsWith("neon")) {
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

export const EMAIL_PROVIDERS = ["brevo", "resend", "log", "memory", "disabled"] as const;
export type EmailProviderName = (typeof EMAIL_PROVIDERS)[number];

export function emailProviderName(): EmailProviderName {
  const env = getEnv();
  const v = env.EMAIL_PROVIDER;
  if (v) return (EMAIL_PROVIDERS as readonly string[]).includes(v) ? (v as EmailProviderName) : "disabled";
  return env.NODE_ENV === "test" ? "memory" : env.NODE_ENV === "production" ? "disabled" : "log";
}

/** Problemas de configuración del correo (no fatales): se muestran en /admin/correos y /admin/sistema. */
export function emailConfigIssues(): string[] {
  const env = getEnv();
  const issues: string[] = [];
  const v = env.EMAIL_PROVIDER;
  if (v && !(EMAIL_PROVIDERS as readonly string[]).includes(v)) issues.push(`EMAIL_PROVIDER="${v.slice(0, 20)}" no es válido: los emails están desactivados.`);
  const name = emailProviderName();
  if (name === "brevo" && !env.BREVO_API_KEY) issues.push("Falta BREVO_API_KEY: los emails no se pueden enviar.");
  if (name === "resend" && !env.RESEND_API_KEY) issues.push("Falta RESEND_API_KEY: los emails no se pueden enviar.");
  if ((name === "brevo" || name === "resend") && !parseSender(env.EMAIL_FROM, env.EMAIL_FROM_NAME)) issues.push("EMAIL_FROM no es una dirección válida.");
  return issues;
}

/** "Nombre <a@b.c>" o "a@b.c" → { email, name }. null si no hay una dirección válida. */
export function parseSender(raw: string, fallbackName: string): { email: string; name: string } | null {
  const m = raw.trim().match(/^(?:"?([^"<]*?)"?\s*<)?([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>?$/);
  if (!m || !m[2] || m[2].endsWith(".invalid")) return null;
  return { email: m[2].toLowerCase(), name: (m[1] ?? "").trim() || fallbackName };
}
