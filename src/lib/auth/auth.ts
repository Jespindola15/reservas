import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { seal } from "@/lib/security/sealed";
import { withSystem } from "@/lib/db/tenant-context";
import { enqueue } from "@/modules/notifications/outbox";
import { logger } from "@/lib/logger";


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
function hasClientIp(req: Request, header: string): boolean {
  return Boolean(header && req.headers.get(header));
}

function createAuth() {
  const env = getEnv();
  const isProd = env.NODE_ENV === "production";
  return betterAuth({
  appName: "TURNUP",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.BETTER_AUTH_URL],
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    // Recuperación: token de un solo uso (Better Auth lo borra al usarse), 1 hora,
    // y se cierran todas las sesiones al cambiar la contraseña.
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, token }) => {
      // El enlace apunta a nuestra pantalla; viaja CIFRADO por la cola y se borra al enviarse.
      const url = `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/restablecer?token=${encodeURIComponent(token)}`;
      const sealedUrl = await seal(url);
      await withSystem((tx) =>
        enqueue(tx, { tenantId: null, kind: "password_reset", recipient: user.email, dedupeKey: `password_reset:${createHash("sha256").update(token).digest("hex").slice(0, 32)}`, payload: { sealedUrl } }),
      );
      logger.info("auth.password_reset_requested", { userId: user.id });
    },
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
      // Sin la cabecera de IP del proxy no se aplica el límite POR IP (evita que
      // una mala configuración bloquee el login de todos); siguen los límites por cuenta.
      // Por IP: 30 cada 15 min. Un complejo con varios empleados detrás de la misma conexión
      // no se bloquea entre sí; la fuerza bruta contra UNA cuenta la frena el límite por
      // cuenta (10 cada 15 min, hook de abajo), que no depende de la IP.
      "/sign-in/email": (req) => (hasClientIp(req, env.AUTH_CLIENT_IP_HEADER) ? { window: 15 * 60, max: 30 } : false),
      "/request-password-reset": (req) => (hasClientIp(req, env.AUTH_CLIENT_IP_HEADER) ? { window: 15 * 60, max: 5 } : false),
      "/reset-password": { window: 15 * 60, max: 10 },
      // Segundo factor: pocos intentos por ventana (además del bloqueo propio del plugin).
      "/two-factor/verify-totp": { window: 10 * 60, max: 10 },
      "/two-factor/verify-backup-code": { window: 10 * 60, max: 5 },
      "/two-factor/enable": { window: 10 * 60, max: 5 },
    },
    customStorage: {
      consume: (key, rule) => consumeRateLimit(`auth:${key}`, rule),
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email" && ctx.path !== "/request-password-reset") return;
      const email = typeof ctx.body?.email === "string" ? ctx.body.email.trim().toLowerCase().slice(0, 254) : "";
      if (!email) return;
      // Se guarda un hash, no el email en claro.
      const emailKey = createHash("sha256").update(email).digest("hex").slice(0, 32);
      const rule = ctx.path === "/sign-in/email" ? { window: 15 * 60, max: 10 } : { window: 60 * 60, max: 3 };
      const res = await consumeRateLimit(`auth:${ctx.path === "/sign-in/email" ? "account" : "reset"}:${emailKey}`, rule);
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
  plugins: [
    // TOTP (Google Authenticator, Authy, 1Password...). Obligatorio para superadministradores
    // (lo exige la capa de acceso). El secreto se guarda cifrado con BETTER_AUTH_SECRET.
    twoFactor({ issuer: "TURNUP", skipVerificationOnEnable: false }),
    nextCookies(),
  ],
});
}

let instance: ReturnType<typeof createAuth> | undefined;

/** Instancia perezosa (ver lib/db/prisma.ts): se crea en el primer uso. */
export function getAuth() {
  instance ??= createAuth();
  return instance;
}
