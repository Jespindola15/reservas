/**
 * Logger estructurado mínimo (JSON por línea) para que un agregador de logs
 * pueda indexarlo. No registrar contraseñas, tokens ni cookies.
 */
type Level = "info" | "warn" | "error";

function write(level: Level, msg: string, data?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...data });
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
