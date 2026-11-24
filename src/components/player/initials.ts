/** Iniciales para el avatar automático (sin fotos personales). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const out = (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "");
  return (out || "?").toUpperCase();
}
