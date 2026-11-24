/*
 * Service worker de TURNUP.
 *
 * Política de caché (deliberadamente mínima):
 *  - Páginas HTML, /api/*, disponibilidad, reservas, panel y cualquier dato personal: SIEMPRE red.
 *    Nunca se guardan en caché. Si no hay conexión, se muestra /offline.
 *  - /_next/static/* (archivos con hash, inmutables) e /icons/*: cache-first.
 *  - Nada más se intercepta.
 * La confirmación de una reserva depende siempre del servidor y de PostgreSQL; sin conexión no se
 * puede reservar ni confirmar nada.
 */
const VERSION = "turnup-v1";
const STATIC_CACHE = `${VERSION}-static`;
const SHELL_CACHE = `${VERSION}-shell`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(PRECACHE.map((url) => fetch(url, { cache: "reload", credentials: "omit" }).then((res) => (res.ok ? cache.put(url, res) : undefined)))),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isCacheableStatic(url) {
  return url.origin === self.location.origin && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/"));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (req.mode === "navigate") {
    // Red siempre; solo ante un fallo de red se muestra la página offline (no datos viejos).
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE }).then((r) => r || Response.error())));
    return;
  }

  if (isCacheableStatic(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.type === "basic") cache.put(req, res.clone());
        return res;
      }),
    );
  }
  // Todo lo demás (API, imágenes de canchas, RSC, etc.) pasa directo a la red sin tocar la caché.
});
