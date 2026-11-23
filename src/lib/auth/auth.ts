import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { logger } from "@/lib/logger";

const env = getEnv();
const isProd = env.NODE_ENV === "production";

/**
 * Autenticación con Better Auth (mantenida, compatible con Next.js App Router).
 *
 * Decisiones de seguridad:
 *  - Sesiones en base de datos (revocables), cookie httpOnly + SameSite=Lax +
 *    Secure en producción (prefijo __Secure-).
 *  - Registro público DESHABILITADO: los administradores los crea el
 *    superadministrador (o el seed). Nadie puede auto-registrarse como dueño.
 *  - Better Auth valida el Origin en solicitudes con cookies (protección CSRF)
 *    contra trustedOrigins.
 *  - Rate limiting persistente en PostgreSQL (compartido entre instancias),
 *    con regla estricta para el inicio de sesión (fuerza bruta).
 *  - Además, límite POR CUENTA (email) para frenar fuerza bruta distribuida
 *    desde muchas IPs.
 *  - Solo se confía en la cabecera de IP que sobrescribe el proxy
 *    (AUTH_CLIENT_IP_HEADER). Sin ella, el límite es un contador compartido:
 *    no se puede evadir falsificando X-Forwarded-For.
 *  - Usuarios deshabilitados no pueden crear sesión.
 */
export const auth = betterAuth({
  appName: "Reservas",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.BETTER_AUTH_URL],
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 días
    updateAge: 60 * 60 * 24, // renueva como máximo una vez por día
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 15 * 60, max: 5 },
    },
    customStorage: {
      consume: (key, rule) => consumeRateLimit(`auth:${key}`, rule),
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const email = typeof ctx.body?.email === "string" ? ctx.body.email.trim().toLowerCase().slice(0, 254) : "";
      if (!email) return;
      // Se guarda un hash, no el email en claro.
      const emailKey = createHash("sha256").update(email).digest("hex").slice(0, 32);
      const res = await consumeRateLimit(`auth:account:${emailKey}`, { window: 15 * 60, max: 10 });
      if (!res.allowed) {
        logger.warn("auth.account_rate_limited", { retryAfter: res.retryAfter });
        throw new APIError("TOO_MANY_REQUESTS", { message: "Demasiados intentos. Probá más tarde." });
      }
    }),
  },
  advanced: {
    ipAddress: {
      ipAddressHeaders: env.AUTH_CLIENT_IP_HEADER ? [env.AUTH_CLIENT_IP_HEADER] : [],
    },
    useSecureCookies: isProd,
    cookiePrefix: "reservas",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: isProd, path: "/" },
    database: { generateId: "uuid" },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { isDisabled: true },
          });
          if (!user || user.isDisabled) {
            logger.warn("auth.session_denied_disabled_user", { userId: session.userId });
            return false;
          }
        },
      },
    },
  },
  telemetry: { enabled: false },
  plugins: [nextCookies()],
});
