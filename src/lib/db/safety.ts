import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

/**
 * Controles de seguridad de la conexión de RUNTIME (una vez por proceso / instancia serverless).
 *
 * 1. Rol: la app nunca debe conectarse con un rol superusuario o con BYPASSRLS (en Neon, los roles
 *    creados desde la consola o la API heredan neon_superuser y tienen BYPASSRLS). Si pasa, RLS no
 *    protegería nada: se falla CERRADO.
 * 2. Zona horaria de la sesión = UTC. El driver envía las fechas como texto sin zona; PostgreSQL las
 *    interpreta con el TimeZone de la sesión. Con otra zona, vencimientos, sesiones y recordatorios se
 *    correrían horas (se detectó probando con permisos tipo Neon). Se fija UTC a nivel de base/rol
 *    (db/bootstrap-neon.sql) y además en cada transacción propia; este control detecta el resto.
 */
export type DbSafety = { ok: boolean; problems: string[]; role: string; timezone: string };

const UTC_NAMES = new Set(["UTC", "ETC/UTC", "GMT", "ETC/GMT", "UCT", "ZULU", "UNIVERSAL", "GMT0"]);
let pending: Promise<DbSafety> | null = null;

export async function inspectDbSafety(): Promise<DbSafety> {
  const rows = await prisma.$queryRaw<{ role: string; super: boolean; bypass: boolean; tz: string }[]>`
    SELECT current_user::text AS role, r.rolsuper AS super, r.rolbypassrls AS bypass, current_setting('TimeZone') AS tz
      FROM pg_roles r WHERE r.rolname = current_user`;
  const r = rows[0];
  const problems: string[] = [];
  if (!r) problems.push("rol desconocido");
  else {
    if (r.super || r.bypass) problems.push("el rol de la app es superusuario o tiene BYPASSRLS");
    if (!UTC_NAMES.has(r.tz.toUpperCase())) problems.push(`zona horaria de la sesión = ${r.tz} (se requiere UTC)`);
  }
  return { ok: problems.length === 0, problems, role: r?.role ?? "?", timezone: r?.tz ?? "?" };
}

/** Falla cerrado si la conexión no es segura. Cacheado: una consulta por instancia. */
export async function assertDbSafety(): Promise<void> {
  pending ??= inspectDbSafety().then((s) => {
    if (!s.ok) logger.error("db.unsafe_connection", new Error(s.problems.join("; ")), { role: s.role, timezone: s.timezone });
    return s;
  });
  let s: DbSafety;
  try {
    s = await pending;
  } catch (e) {
    pending = null; // error de red: reintentar en la próxima solicitud
    throw e;
  }
  if (!s.ok) throw new Error(`Conexión a la base insegura: ${s.problems.join("; ")}`);
}
