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
    /** Solo para probar el build de producción en la máquina local (http://localhost). */
    ALLOW_INSECURE_LOCALHOST: z.enum(["true", "false"]).default("false"),
  })
  .superRefine((env, ctx) => {
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

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuración de entorno inválida: ${detail}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = () => getEnv().NODE_ENV === "production";
