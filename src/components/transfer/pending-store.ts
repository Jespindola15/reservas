/**
 * Recuerda en ESTE dispositivo las reservas pendientes de transferencia de un invitado, para que
 * pueda volver a la pantalla de pago si cierra el navegador. Solo queda en el navegador del propio
 * jugador (nunca se envía a un servidor ni a herramientas de analítica). Se limpia sola al vencer.
 */
export type PendingTransfer = { slug: string; code: string; tenantName: string; url: string; expiresAt: string };
const KEY = "turnup.pendientes";

export function readPending(now = Date.now()): PendingTransfer[] {
  try {
    const list = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as PendingTransfer[];
    const alive = Array.isArray(list) ? list.filter((p) => p && typeof p.url === "string" && p.url.startsWith("/") && new Date(p.expiresAt).getTime() > now) : [];
    if (alive.length !== (Array.isArray(list) ? list.length : 0)) window.localStorage.setItem(KEY, JSON.stringify(alive));
    return alive;
  } catch {
    return [];
  }
}

export function savePending(p: PendingTransfer) {
  try {
    const list = readPending().filter((x) => x.code !== p.code);
    window.localStorage.setItem(KEY, JSON.stringify([p, ...list].slice(0, 5)));
  } catch {
    // Navegación privada o almacenamiento lleno: el enlace igual se mostró en pantalla.
  }
}

export function forgetPending(code: string) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(readPending().filter((x) => x.code !== code)));
  } catch {
    // sin almacenamiento disponible
  }
}
