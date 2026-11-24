/**
 * Logger estructurado mínimo (JSON por línea) para que un agregador de logs
 * pueda indexarlo. No registrar contraseñas, tokens ni cookies.
 */
type Level = "info" | "warn" | "error";

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|sealed/i;

/**
 * Red de seguridad: aunque un error traiga datos sensibles en el mensaje (p. ej. la URL de la
 * base con contraseña), no llegan a los logs. Redacta credenciales en URLs, Bearer, parámetros
 * token=/key=, claves conocidas y emails (dato personal).
 */
export function redact(text: string): string {
  return text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:"']+:[^\s/@"']+@/gi, "$1<redacted>@")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>")
    .replace(/\b(token|key|secret|password|signature)=[^\s&"']+/gi, "$1=<redacted>")
    .replace(/\bre_[A-Za-z0-9_]{8,}/g, "<redacted>")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>");
}

function write(level: Level, msg: string, data?: Record<string, unknown>) {
  const line = redact(
    JSON.stringify({ level, msg, time: new Date().toISOString(), ...data }, (k, v) => (k && SENSITIVE_KEY.test(k) && typeof v === "string" ? "<redacted>" : v)),
  );
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (msg: string, data?: Record<string, unknown>) => write("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write("warn", msg, data),
  error: (msg: string, err?: unknown, data?: Record<string, unknown>) =>
    write("error", msg, {
      ...data,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
    }),
};
