import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("manifest de la PWA", () => {
  const m = manifest();
  it("es instalable: nombre, standalone, start_url dentro del scope e íconos 192/512 + maskable", () => {
    expect(m.name).toMatch(/TURNUP/);
    expect(m.short_name).toBe("TURNUP");
    expect(m.display).toBe("standalone");
    expect(m.start_url!.startsWith(m.scope!)).toBe(true);
    const sizes = (m.icons ?? []).map((i) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
    for (const i of m.icons ?? []) expect(() => readFileSync(`public${i.src}`)).not.toThrow();
    expect(m.theme_color).toBe("#05070d");
  });
});

/** Ejecuta public/sw.js en un entorno de service worker simulado. */
function loadSw() {
  const listeners: Record<string, (e: unknown) => void> = {};
  const cachePuts: string[] = [];
  const store = new Map<string, Response>();
  const cache = {
    match: async (r: Request | string) => store.get(typeof r === "string" ? r : r.url) ?? undefined,
    put: async (r: Request | string, res: Response) => {
      const k = typeof r === "string" ? r : r.url;
      cachePuts.push(k);
      store.set(k, res);
    },
  };
  let online = true;
  const sandbox = {
    self: { addEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] = fn), location: { origin: "https://turnup.example" }, clients: { claim: async () => {} }, skipWaiting: () => {} },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: async (u: string) => store.get(u) },
    fetch: async (r: Request | string) => {
      if (!online) throw new TypeError("offline");
      const res = new Response("ok", { status: 200 });
      Object.defineProperty(res, "type", { value: "basic" });
      void r;
      return res;
    },
    URL,
    Response,
    Promise,
  };
  runInNewContext(readFileSync("public/sw.js", "utf8"), sandbox);
  async function fire(url: string, init: { mode?: string; method?: string } = {}) {
    const box: { p: Promise<Response> | null } = { p: null };
    const request = { url: `https://turnup.example${url}`, method: init.method ?? "GET", mode: init.mode ?? "cors" };
    listeners.fetch!({ request, respondWith: (p: Promise<Response>) => (box.p = p) });
    return box.p ? await box.p : null;
  }
  return { fire, cachePuts, store, setOnline: (v: boolean) => (online = v) };
}

describe("service worker: caché segura", () => {
  it("nunca intercepta ni cachea API, disponibilidad, reservas, imágenes ni POST", async () => {
    const sw = loadSw();
    for (const url of ["/api/public/club/availability?date=2030-01-01", "/api/public/club/bookings", "/api/auth/get-session", "/api/public/club/courts/x/images/y", "/panel/club/reservas?_rsc=1"]) {
      expect(await sw.fire(url)).toBeNull();
    }
    expect(await sw.fire("/api/public/club/bookings", { method: "POST" })).toBeNull();
    expect(sw.cachePuts).toEqual([]);
  });

  it("las páginas van siempre a la red y no se guardan; sin red muestra /offline", async () => {
    const sw = loadSw();
    const page = await sw.fire("/club", { mode: "navigate" });
    expect(await page!.text()).toBe("ok");
    expect(sw.cachePuts).toEqual([]);
    sw.store.set("/offline", new Response("sin conexion"));
    sw.setOnline(false);
    const off = await sw.fire("/panel/club", { mode: "navigate" });
    expect(await off!.text()).toBe("sin conexion");
  });

  it("solo cachea archivos estáticos con hash e íconos", async () => {
    const sw = loadSw();
    await sw.fire("/_next/static/chunks/app-abc123.js");
    await sw.fire("/icons/icon-192.png");
    expect(sw.cachePuts).toEqual(["https://turnup.example/_next/static/chunks/app-abc123.js", "https://turnup.example/icons/icon-192.png"]);
  });
});
