import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { totp } from "../support/totp";
import { E2E_ENV } from "../../playwright.config";

const OWNER_PW = E2E_ENV.SEED_OWNER_PASSWORD;

// Cada prueba simula un cliente con IP propia (detrás de un proxy confiable).
test.beforeEach(async ({ context }, info) => {
  let h = 0;
  for (const ch of `${info.project.name}:${info.title}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  await context.setExtraHTTPHeaders({ "x-real-ip": `10.${(h >> 16) & 255}.${(h >> 8) & 255}.${(h & 253) + 1}` });
});

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
}

// ---- Superadmin con verificación en dos pasos (obligatoria desde la Fase 3.1) ----
let saSecret: string | null = null;
let lastTotpWindow = -1;
/** Código TOTP de una ventana nueva (no reutiliza el último código usado). */
async function freshTotp(page: Page) {
  while (Math.floor(Date.now() / 30_000) === lastTotpWindow) await page.waitForTimeout(1000);
  lastTotpWindow = Math.floor(Date.now() / 30_000);
  return totp(saSecret!);
}
async function loginSuperadmin(page: Page) {
  await login(page, "superadmin@example.com", E2E_ENV.SEED_SUPERADMIN_PASSWORD);
  const code = page.getByLabel("Código de verificación");
  await Promise.race([page.waitForURL("**/panel"), code.waitFor()]);
  if (await code.isVisible()) {
    await code.fill(await freshTotp(page));
    await page.getByRole("button", { name: "Verificar" }).click();
    await page.waitForURL("**/panel");
  }
  await page.goto("/admin");
  if (page.url().includes("/admin/seguridad")) {
    // Alta del segundo factor por la interfaz real.
    await page.getByLabel("Contraseña actual").fill(E2E_ENV.SEED_SUPERADMIN_PASSWORD);
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByText("¿No podés escanear?").click();
    saSecret = (await page.locator("details code").innerText()).trim();
    await page.getByLabel("Ya guardé mis códigos de respaldo").check();
    await page.getByLabel("Código de 6 dígitos").fill(await freshTotp(page));
    await page.getByRole("button", { name: "Activar verificación en dos pasos" }).click();
    await page.waitForURL("**/admin");
  }
}

function tomorrow() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(Date.now() + 86_400_000));
}

/** Reserva por la API pública (como lo haría el navegador) y devuelve la respuesta. */
async function apiBook(request: APIRequestContext, slug: string, courtIndex: number, n: number, duration = 60) {
  const avail = await (await request.get(`/api/public/${slug}/availability?date=${tomorrow()}&duration=${duration}`)).json();
  const court = avail.courts[courtIndex];
  const slot = court.slots.filter((s: { available: boolean }) => s.available).at(-1 - n);
  const res = await request.post(`/api/public/${slug}/bookings`, {
    data: {
      courtId: court.id,
      startsAt: slot.startsAt,
      durationMinutes: duration,
      customer: { name: `Persona ${n}`, phone: `11 4444-00${String(n).padStart(2, "0")}`, email: `p${n}@example.com` },
      idempotencyKey: `e2e-${slug}-${Date.now()}-${n}`,
    },
  });
  return { res, json: await res.json() };
}

// ---------------------------------------------------------------------------- Jugador

test("jugador: deporte → cancha → fecha → horario → datos → código y enlace de seguimiento @mobile", async ({ page }, info) => {
  const courtName = info.project.name === "mobile" ? "Cancha 3" : "Cancha 1";
  await page.goto("/padel-centro");
  await expect(page.getByRole("heading", { level: 1, name: "Pádel Centro" })).toBeVisible();
  await page.getByRole("radio", { name: new RegExp(`^${courtName}`) }).click();
  await page.getByRole("radiogroup", { name: "Fecha" }).getByRole("radio").nth(1).click();
  await page.getByRole("radio", { name: "90 min" }).click();

  const slot = page.getByRole("button", { name: /^20:00/ });
  await expect(slot).toBeEnabled();
  await expect(slot).toContainText("$"); // precio visible antes de confirmar
  await slot.click();
  await expect(page.getByText("(90 min)")).toBeVisible();

  await page.getByLabel("Nombre y apellido").fill("Lionel Prueba");
  await page.getByLabel("Teléfono").fill("11 5555-0001");
  await page.getByLabel("Email").fill("lionel@example.com");
  await page.getByRole("button", { name: "Confirmar reserva" }).click();

  await expect(page.getByRole("heading", { name: "¡Listo, nos vemos en la cancha!" })).toBeVisible();
  await expect(page.locator("strong").filter({ hasText: /^[A-HJ-NP-Z2-9]{8}$/ })).toBeVisible();
  await page.getByRole("link", { name: "Ver estado" }).click();
  await expect(page.getByRole("heading", { name: "Hola, Lionel" })).toBeVisible();
  await expect(page.getByText("Confirmada", { exact: true })).toBeVisible();
  await expect(page.getByText("lionel@example.com")).toHaveCount(0); // sin datos personales
  await expect(page.getByText("11 5555-0001")).toHaveCount(0);

  await page.goto("/padel-centro");
  await page.getByRole("radio", { name: new RegExp(`^${courtName}`) }).click();
  await page.getByRole("radiogroup", { name: "Fecha" }).getByRole("radio").nth(1).click();
  await page.getByRole("radio", { name: "90 min" }).click();
  // Los horarios ocupados se ocultan por defecto; se pueden mostrar para ver que quedaron tomados.
  await expect(page.getByRole("button", { name: /^20:00/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Ver también los ocupados" }).click();
  await expect(page.getByRole("button", { name: /^20:00/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^21:00/ })).toBeDisabled(); // se solapa
  await expect(page.getByRole("button", { name: /^21:30/ })).toBeEnabled(); // consecutiva
});

test("jugador: cancela con su enlace privado; con el código solo no se puede", async ({ page, request }) => {
  const { res, json } = await apiBook(request, "padel-centro", 1, 0);
  expect(res.status()).toBe(201);
  // Solo el código (sin token): no muestra nada.
  await page.goto(`/padel-centro/reserva/${json.code}`);
  await expect(page.getByRole("heading", { name: "No pudimos mostrar la reserva" })).toBeVisible();

  await page.goto(json.trackingUrl);
  await expect(page.getByRole("heading", { name: "Hola, Persona" })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar mi reserva" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sí, cancelar" }).click();
  await expect(page.getByText("Tu reserva fue cancelada")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Cancelada", { exact: true })).toBeVisible();
});

test("dos solicitudes simultáneas por HTTP al mismo turno: una 201 y una 409", async ({ request }) => {
  const avail = await (await request.get(`/api/public/padel-centro/availability?date=${tomorrow()}&duration=60`)).json();
  const court = avail.courts[1];
  const slot = court.slots.find((s: { available: boolean }) => s.available);
  const body = (n: number) => ({
    courtId: court.id,
    startsAt: slot.startsAt,
    durationMinutes: 60,
    customer: { name: `Persona ${n}`, phone: "11 4444-000" + n, email: `p${n}@example.com` },
    idempotencyKey: `e2e-concurrency-${Date.now()}-${n}`,
  });
  const [a, b] = await Promise.all([
    request.post("/api/public/padel-centro/bookings", { data: body(1) }),
    request.post("/api/public/padel-centro/bookings", { data: body(2) }),
  ]);
  expect([a.status(), b.status()].sort()).toEqual([201, 409]);
  const loser = a.status() === 409 ? await a.json() : await b.json();
  expect(loser.error.code).toBe("SLOT_UNAVAILABLE");
  expect(JSON.stringify(loser)).not.toMatch(/court_allocations|exclusion|constraint|23P01/i);
});

test("el cuerpo no puede elegir tenant, estado ni precio; datos inválidos dan 400", async ({ request }) => {
  const res = await request.post("/api/public/padel-centro/bookings", {
    data: { courtId: "not-a-uuid", startsAt: "ayer", durationMinutes: 90, tenantId: "x", status: "CONFIRMED" },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
});

// ----------------------------------------------------------------------- Administrador

test("dueño: crea cancha, horario y tarifa; carga reserva desde el calendario; busca cliente; reprograma y cancela", async ({ page }) => {
  await login(page, "duenio@padel-centro.example.com", OWNER_PW);
  await page.waitForURL("**/panel/padel-centro");
  await expect(page.getByRole("heading", { name: /^Hola,/ })).toBeVisible();

  // Cancha nueva
  await page.goto("/panel/padel-centro/canchas");
  await page.getByLabel("Nombre").fill("Cancha Panorámica");
  await page.getByLabel("Deporte").selectOption("PADEL");
  await page.getByLabel("Capacidad (jugadores)").fill("4");
  await page.getByLabel("Precio base por hora ($)").fill("25000");
  await page.getByRole("button", { name: "Crear cancha" }).click();
  await page.waitForURL(/\/canchas\/[0-9a-f-]{36}\?nueva=1/);
  await expect(page.getByText("no tiene horario")).toBeVisible();

  // Horario: todos los días 09:00 a 23:00
  for (let d = 1; d <= 7; d++) await page.locator(`input[name="open_${d}"]`).check();
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Horario guardado.")).toBeVisible();

  // Tarifa de fin de semana
  await page.getByText("+ Agregar tarifa").click();
  await page.locator('select[name="durationMinutes"]').selectOption("90");
  await page.getByLabel("Precio ($)").fill("33000");
  await page.getByLabel("Días").selectOption("weekend");
  await page.getByRole("button", { name: "Agregar tarifa" }).click();
  await expect(page.getByText("Tarifa agregada.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("cell", { name: "Sábado" })).toBeVisible();

  // Reserva manual desde una celda libre del calendario
  await page.goto(`/panel/padel-centro/calendario?date=${tomorrow()}`);
  await page.getByRole("link", { name: "Reservar Cancha Panorámica a las 10:00" }).click();
  await expect(page.getByRole("heading", { name: "Nueva reserva manual" })).toBeVisible();
  await page.getByLabel("Nombre del cliente").fill("Carla Manual");
  await page.getByLabel("Teléfono").fill("11 3333-4444");
  await page.getByRole("button", { name: "Registrar reserva" }).click();
  await expect(page.getByText(/Reserva registrada\. Código [A-HJ-NP-Z2-9]{8}/)).toBeVisible();
  await page.goto(`/panel/padel-centro/calendario?date=${tomorrow()}`);
  await expect(page.getByRole("link", { name: /Carla Manual/ })).toBeVisible();

  // Clientes
  await page.goto("/panel/padel-centro/clientes?q=3333-4444");
  await page.getByRole("link", { name: "Carla Manual" }).click();
  await expect(page.getByRole("heading", { name: "Historial de reservas" })).toBeVisible();

  // Detalle → reprogramar → cancelar
  await page.getByRole("table").getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Carla Manual" })).toBeVisible();
  await page.getByLabel("Hora").fill("12:00");
  await page.getByRole("button", { name: "Mover reserva" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mover reserva" }).click();
  await expect(page.getByText("Reserva reprogramada.")).toBeVisible();
  await page.getByRole("button", { name: "Cancelar reserva" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sí, cancelar" }).click();
  await expect(page.getByText("Reserva cancelada. El turno quedó libre.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Reserva reprogramada", { exact: true })).toBeVisible(); // historial
});

test("dueña: aprueba una solicitud pendiente del sitio público", async ({ page, request }) => {
  const { res, json } = await apiBook(request, "futbol-norte", 0, 2);
  expect(res.status()).toBe(201);
  expect(json.status).toBe("PENDING");
  await login(page, "duenio@futbol-norte.example.com", OWNER_PW);
  await page.waitForURL("**/panel/futbol-norte");
  await page.goto(`/panel/futbol-norte/reservas?q=${json.code}`);
  await page.getByRole("table").getByRole("link").first().click();
  await expect(page.getByText("Pendiente", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByText("Reserva confirmada.")).toBeVisible();
  await page.goto(json.trackingUrl);
  await expect(page.getByText("Confirmada", { exact: true })).toBeVisible();
});

test("personal (STAFF) usa el calendario pero no la configuración", async ({ page }) => {
  await login(page, "staff@futbol-norte.example.com", OWNER_PW);
  await page.waitForURL("**/panel/futbol-norte");
  expect((await page.goto("/panel/futbol-norte/calendario"))?.status()).toBe(200);
  expect((await page.goto("/panel/futbol-norte/canchas"))?.status()).toBe(404);
  expect((await page.goto("/panel/futbol-norte/ajustes"))?.status()).toBe(404);
});

test("login con contraseña incorrecta muestra mensaje genérico", async ({ page }) => {
  await login(page, "duenio@padel-centro.example.com", "contraseña-incorrecta");
  await expect(page.getByText("Email o contraseña incorrectos.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("el dueño no accede al panel de otro complejo ni al superadmin", async ({ page, request }) => {
  await login(page, "duenio@padel-centro.example.com", OWNER_PW);
  await page.waitForURL("**/panel/padel-centro");
  expect((await page.goto("/panel/futbol-norte"))?.status()).toBe(404);
  expect((await page.goto("/panel/futbol-norte/clientes"))?.status()).toBe(404);
  expect((await page.goto("/admin"))?.status()).toBe(404);
  // Contadores en vivo del panel: propios sí, de otro complejo no, sin sesión tampoco.
  const own = await page.request.get("/api/panel/padel-centro/avisos");
  expect(own.status()).toBe(200);
  expect(Object.keys(await own.json()).sort()).toEqual(["incidents", "transfers", "unread"]);
  expect([403, 404]).toContain((await page.request.get("/api/panel/futbol-norte/avisos")).status());
  expect((await request.get("/api/panel/padel-centro/avisos")).status()).toBe(401);
});

test("cookies de sesión httpOnly y cabeceras de seguridad", async ({ page, context }) => {
  await login(page, "duenio@futbol-norte.example.com", OWNER_PW);
  await page.waitForURL("**/panel/futbol-norte");
  const session = (await context.cookies()).find((c) => c.name.includes("session_token"));
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  expect(session?.secure).toBe(true);
  const res = await page.goto("/futbol-norte");
  const h = res!.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("superadmin accede al panel de plataforma", async ({ page }) => {
  await loginSuperadmin(page);
  await expect(page.getByRole("heading", { name: "Plataforma", exact: true })).toBeVisible();
  await page.goto("/admin/complejos");
  await expect(page.getByRole("cell", { name: /^Pádel Centro/ })).toBeVisible();
});

test("sin sesión, el panel redirige al login", async ({ page }) => {
  await page.goto("/panel/padel-centro/calendario");
  await expect(page).toHaveURL(/\/login\?next=%2Fpanel%2Fpadel-centro/);
});

test("el registro público está deshabilitado y el login desde otro origen se rechaza", async ({ request }) => {
  const signUp = await request.post("/api/auth/sign-up/email", {
    data: { email: "intruso@example.com", password: "una-clave-larga-123", name: "Intruso" },
    headers: { Origin: E2E_ENV.BETTER_AUTH_URL },
  });
  expect(signUp.ok()).toBe(false);
  const crossOrigin = await request.post("/api/auth/sign-in/email", {
    data: { email: "duenio@padel-centro.example.com", password: OWNER_PW },
    headers: { Origin: "https://sitio-malicioso.example" },
  });
  expect(crossOrigin.status()).toBe(403);
  expect(crossOrigin.headers()["set-cookie"] ?? "").not.toContain("session_token");
});

test("el job de vencimiento exige secreto", async ({ request }) => {
  expect((await request.post("/api/internal/jobs/expire-pending")).status()).toBe(401);
  const ok = await request.post("/api/internal/jobs/expire-pending", { headers: { authorization: `Bearer ${E2E_ENV.CRON_SECRET}` } });
  expect(ok.status()).toBe(200);
});

// ------------------------------------------------------------------ Fase 3

test("recuperar contraseña: mismo mensaje exista o no la cuenta @mobile", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();
  await expect(page).toHaveURL(/\/recuperar/);
  for (const email of ["duenio@padel-centro.example.com", "no-existe@example.com"]) {
    await page.goto("/recuperar");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: /enviar/i }).click();
    await expect(page.getByText(/Si el email corresponde a una cuenta/)).toBeVisible();
  }
  // Un enlace con token inválido no ofrece el formulario.
  await page.goto("/restablecer?token=..malo");
  await expect(page.getByText(/no es válido|venció/i)).toBeVisible();
});

test("dueño: equipo, vista mensual, exportación CSV y aviso de horario", async ({ page }) => {
  await login(page, "duenio@futbol-norte.example.com", OWNER_PW);
  await page.waitForURL("**/panel/futbol-norte");
  await page.goto("/panel/futbol-norte/equipo");
  await expect(page.getByRole("heading", { name: "Equipo" })).toBeVisible();
  await expect(page.getByText("staff@futbol-norte.example.com")).toBeVisible();
  await page.getByLabel("Email").fill(`nuevo-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(page.getByText("Invitación enviada")).toBeVisible();
  await expect(page.getByText("Invitaciones pendientes")).toBeVisible();

  await page.goto("/panel/futbol-norte/calendario?view=month");
  await expect(page.getByRole("grid", { name: "Mes" })).toBeVisible();

  await page.goto("/panel/futbol-norte/reservas");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Exportar CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^turnup-futbol-norte-reservas-\d{4}-\d{2}-\d{2}\.csv$/);
});

test("personal no puede exportar ni gestionar el equipo", async ({ page }) => {
  await login(page, "staff@futbol-norte.example.com", OWNER_PW);
  await page.waitForURL("**/panel/futbol-norte");
  expect((await page.goto("/panel/futbol-norte/equipo"))?.status()).toBe(404);
  const res = await page.request.get("/panel/futbol-norte/exportar?tipo=reservas");
  expect(res.status()).toBe(403);
  await page.goto("/panel/futbol-norte/reservas");
  await expect(page.getByRole("link", { name: "Exportar CSV" })).toHaveCount(0);
});

test("superadmin: planes y auditoría con filtros", async ({ page }) => {
  await loginSuperadmin(page);
  await page.goto("/admin/planes");
  // Los formularios ocasionales del superadmin viven en paneles modales.
  await page.getByRole("button", { name: "Nuevo plan" }).click();
  const nuevo = page.getByRole("dialog", { name: "Nuevo plan" });
  await nuevo.getByLabel("Nombre").fill("Plan E2E");
  await nuevo.getByLabel("Código").fill(`e2e-${Date.now() % 100000}`);
  await nuevo.getByRole("button", { name: "Crear plan" }).click();
  await expect(nuevo).toBeHidden();
  await expect(page.getByText("Plan creado.").filter({ visible: true })).toBeVisible();
  await page.goto("/admin/auditoria?action=platform.plan");
  await expect(page.getByText("Plan creado", { exact: true }).first()).toBeVisible();
  // Los nombres técnicos de los eventos nunca se muestran en la interfaz.
  await expect(page.getByText("platform.plan.created")).toHaveCount(0);
});

test("PWA: manifest, service worker sin caché del navegador y página offline", async ({ request, page }) => {
  const m = await request.get("/manifest.webmanifest");
  expect(m.status()).toBe(200);
  const json = await m.json();
  expect(json).toMatchObject({ short_name: "TURNUP", display: "standalone" });
  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["cache-control"]).toMatch(/no-cache|no-store/);
  for (const icon of json.icons) expect((await request.get(icon.src)).status()).toBe(200);
  const off = await page.goto("/offline");
  expect(off?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Sin conexión" })).toBeVisible();
  // El navegador instala el service worker y no guarda en caché respuestas de la API.
  await page.goto("/");
  const cached = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.active) throw new Error("service worker no activo");
    const urls: string[] = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) urls.push(new URL(r.url).pathname);
    return urls;
  });
  expect(cached.some((u) => u.startsWith("/api/") || u.startsWith("/panel"))).toBe(false);
});

test("endpoints internos: tick y salud", async ({ request }) => {
  expect((await request.post("/api/internal/jobs/tick")).status()).toBe(401);
  const ok = await request.post("/api/internal/jobs/tick", { headers: { authorization: `Bearer ${E2E_ENV.CRON_SECRET}` } });
  expect(ok.status()).toBe(200);
  const health = await request.get("/api/health");
  expect(Object.keys(await health.json())).toEqual(["status"]);
});

// ------------------------------------------------------------------ Fase 3.1

test("dueño: turno fijo semanal con revisión de fechas y pago registrado a mano", async ({ page }) => {
  await login(page, "duenio@padel-centro.example.com", OWNER_PW);
  await page.waitForURL("**/panel/padel-centro");
  await page.goto("/panel/padel-centro/reservas/fijos");
  await expect(page.getByText("Todavía no hay turnos fijos.")).toBeVisible();
  const start = tomorrow();
  const end = new Date(new Date(`${start}T12:00:00Z`).getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Cliente").fill("Los Jueves FC");
  await page.getByLabel("Teléfono").fill("11 4444-5555");
  await page.getByLabel("Primera fecha").fill(start);
  await page.getByLabel("Hasta (máx. 26 semanas)").fill(end);
  await page.getByLabel("Hora").fill("12:00");
  await page.getByRole("button", { name: "Revisar disponibilidad" }).click();
  await expect(page.getByText(/Fechas \(3 libres de 3\)/)).toBeVisible();
  await page.getByRole("button", { name: "Confirmar turno fijo" }).click();
  await expect(page.getByText("Turno fijo creado: 3 reserva(s).")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("cell", { name: /Los Jueves FC/ })).toBeVisible();

  // Pago parcial y saldo en el detalle de una de las reservas
  await page.goto("/panel/padel-centro/reservas?q=Los%20Jueves");
  await page.getByRole("link", { name: /Los Jueves FC/ }).first().click();
  await expect(page.getByRole("heading", { name: "Pagos y señas" })).toBeVisible();
  await expect(page.getByText("Se repite cada semana")).toBeVisible();
  await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/5491144445555\?text=/);
  await page.getByLabel("Importe ($)").fill("5000");
  await page.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText("Pago registrado.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Seña · Efectivo")).toBeVisible();
});

test("calendario: filtros, hora actual y reprogramar arrastrando un turno", async ({ page }) => {
  await login(page, "duenio@padel-centro.example.com", OWNER_PW);
  await page.waitForURL("**/panel/padel-centro");
  const day = tomorrow();
  await page.goto(`/panel/padel-centro/calendario?date=${day}`);
  await page.getByRole("link", { name: "Reservar Cancha 1 a las 15:00" }).click();
  await page.getByLabel("Nombre del cliente").fill("Arrastre Prueba");
  await page.getByLabel("Teléfono").fill("11 2222-3333");
  await page.getByRole("button", { name: "Registrar reserva" }).click();
  await expect(page.getByText(/Reserva registrada/)).toBeVisible();
  await page.goto(`/panel/padel-centro/calendario?date=${day}`);

  const event = page.locator("[data-booking-id]", { hasText: "Arrastre Prueba" });
  const target = page.locator('[data-court-name="Cancha 2"]');
  await event.scrollIntoViewIfNeeded();
  const from = (await event.boundingBox())!;
  const col = (await target.boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 20, { steps: 4 });
  await page.mouse.move(col.x + 30, from.y + 10, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "Confirmar cambio de horario" })).toContainText("Cancha 2");
  await page.getByRole("button", { name: "Mover", exact: true }).click();
  await expect(page.getByText("Reserva movida a las 15:00.")).toBeVisible();
  await expect(page.locator('[data-court-name="Cancha 2"]').getByText("Arrastre Prueba")).toBeVisible();

  // Filtro por estado y línea de hora actual (en el día de hoy)
  await page.goto(`/panel/padel-centro/calendario?date=${day}&status=PENDING`);
  await expect(page.getByText("Arrastre Prueba")).toHaveCount(0);
  await page.goto("/panel/padel-centro/calendario");
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  if (hour >= 8) await expect(page.locator('[class*="nowLine"]').first()).toBeAttached();
});

test("dueño: estadísticas por período y clientes con filtros; personal no ve estadísticas @mobile", async ({ page }) => {
  await login(page, "duenio@futbol-norte.example.com", OWNER_PW);
  await page.waitForURL("**/panel/futbol-norte");
  await page.goto("/panel/futbol-norte/estadisticas?period=week");
  await expect(page.getByRole("heading", { name: "Estadísticas" })).toBeVisible();
  await expect(page.getByText("Cobrado", { exact: true })).toBeVisible();
  await expect(page.getByText("Pendiente de cobro")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Turnos por hora de inicio" })).toBeVisible();
  await page.goto("/panel/futbol-norte/estadisticas?period=custom&from=2030-03-10&to=2030-03-01");
  await expect(page.getByRole("status")).toContainText("rango de fechas válido");

  await page.goto("/panel/futbol-norte/clientes?filtro=frequent");
  await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();
  await expect(page.getByLabel("Filtrar clientes")).toHaveValue("frequent");
  await page.getByLabel("Filtrar clientes").selectOption("all");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/filtro=all/);
  await page.context().clearCookies();

  await login(page, "staff@futbol-norte.example.com", OWNER_PW);
  await page.waitForURL("**/panel/futbol-norte");
  expect((await page.goto("/panel/futbol-norte/estadisticas"))?.status()).toBe(404);
});

test("portada lista los complejos y el dueño personaliza su página pública (logo, servicios, QR)", async ({ page }) => {
  await page.goto("/");
  const dir = page.getByRole("region", { name: "Complejos destacados" });
  await expect(dir.getByRole("link", { name: /Fútbol Norte/ })).toBeVisible();
  await expect(dir.getByRole("link", { name: /Pádel Centro/ })).toBeVisible();

  await login(page, "duenio@futbol-norte.example.com", OWNER_PW);
  await page.waitForURL("**/panel/futbol-norte");
  await page.goto("/panel/futbol-norte/pagina");
  await expect(page.getByRole("heading", { name: "Página pública" })).toBeVisible();
  // PNG 1×1 válido; se recorta a 512×512 WebP en el servidor.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  await page.getByLabel(/Archivo de imagen \(subir logo\)/).setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Subir logo", exact: true }).click();
  await expect(page.getByAltText("Logo actual")).toBeVisible();
  await page.getByLabel("Duchas").check();
  await page.getByLabel("Instagram").fill("@futbolnorte");
  await page.getByRole("button", { name: "Guardar página pública" }).click();
  await expect(page.getByText("Página pública actualizada.")).toBeVisible();
  const qr = await page.request.get("/panel/futbol-norte/qr?formato=png");
  expect(qr.status()).toBe(200);
  expect(qr.headers()["content-type"]).toBe("image/png");

  await page.goto("/futbol-norte");
  await expect(page.getByAltText("Logo de Fútbol Norte")).toBeVisible();
  await expect(page.getByText("Duchas")).toBeVisible();
  await expect(page.getByRole("link", { name: "Instagram" })).toHaveAttribute("href", "https://instagram.com/futbolnorte");
});

test("puesta en marcha: aviso en el inicio, pasos con avance y enlace + QR al final @mobile", async ({ page }) => {
  await login(page, "duenio@padel-centro.example.com", OWNER_PW);
  await page.waitForURL("**/panel/padel-centro");
  await page.getByRole("link", { name: /Puesta en marcha: \d de 7 pasos/ }).click();
  await expect(page.getByRole("heading", { name: "Puesta en marcha" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Avance de la puesta en marcha" })).toBeVisible();
  const rules = page.getByRole("listitem").filter({ hasText: "Reglas de reserva" });
  // El proyecto móvil corre después sobre la misma base: el paso puede venir ya hecho.
  if (await rules.getByRole("button", { name: "Ya revisé las reglas" }).isVisible()) {
    await rules.getByRole("button", { name: "Ya revisé las reglas" }).click();
  }
  await expect(rules).toContainText("(completo)");
  await expect(page.getByAltText(/Código QR de/)).toBeVisible();
  await expect(page.getByText(/\/padel-centro$/).first()).toBeVisible();
});

test("superadmin: métricas comerciales, estado del sistema y pago de suscripción registrado a mano", async ({ page }) => {
  await loginSuperadmin(page);
  await page.goto("/admin");
  await expect(page.getByText("MRR registrado")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alertas" })).toBeVisible();
  await page.goto("/admin/sistema");
  await expect(page.getByRole("heading", { name: "Tareas programadas" })).toBeVisible();
  await expect(page.getByText(/MB del plan gratuito/)).toBeVisible();
  // Fase 6: panel de correos con cupo diario, filtros y correo de prueba solo a direcciones autorizadas.
  await page.getByRole("link", { name: "Correos" }).first().click();
  await expect(page.getByRole("heading", { name: "Correos", level: 1 })).toBeVisible();
  await expect(page.getByText("Cupo diario usado")).toBeVisible();
  await expect(page.getByText(/\d+\/300/)).toBeVisible();
  await page.getByRole("button", { name: "Enviar correo de prueba" }).click();
  const test = page.getByRole("dialog", { name: "Correo de prueba" });
  await expect(test.getByLabel("Destinatario autorizado").locator("option")).toHaveCount(1);
  await test.getByRole("button", { name: "Enviar prueba" }).click();
  await expect(page.getByText(/ACEPTÓ el correo de prueba/).filter({ visible: true })).toBeVisible();
  await page.goto("/admin/correos?tipo=admin_test");
  await expect(page.getByRole("cell", { name: /Correo de prueba/ }).first()).toBeVisible();
  await page.goto("/admin/planes");
  await page.getByRole("button", { name: "Registrar pago" }).click();
  const form = page.getByRole("dialog", { name: "Registrar pago de suscripción" });
  await form.getByLabel("Complejo").selectOption({ label: "Pádel Centro" });
  await form.getByLabel("Importe ($)").fill("25000");
  await form.getByLabel("Período desde").fill("2099-01-01");
  await form.getByLabel("Período hasta").fill("2099-01-31");
  await form.getByRole("button", { name: "Registrar pago" }).click();
  await expect(page.getByText(/Pago registrado\. Suscripción activa hasta el/).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Últimos pagos registrados" })).toContainText("Pádel Centro");
});

// ---------------------------------------------------------------------------- Plataforma de jugadores (Fase 4)

test("jugador con cuenta: registro, explorar, ficha, favorito, reserva con datos precargados, Mis turnos y cancelación @mobile", async ({ page }, info) => {
  const email = `jugadora-${info.project.name}-${Date.now()}@example.com`;
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Explorar" })).toBeVisible();
  await page.goto("/cuenta/registro");
  await page.getByLabel("Nombre y apellido").fill("Juana Jugadora");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Teléfono (opcional)").fill("11 5555-7777");
  await page.getByLabel("Ciudad (opcional)").fill("Rosario");
  await page.getByLabel("Contraseña (mín. 12 caracteres)").fill("clave-jugadora-123");
  await page.getByLabel("Repetir contraseña").fill("clave-jugadora-123");
  await page.getByLabel(/Acepto los términos/).check();
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Hola, Juana" })).toBeVisible();
  // Un jugador no tiene acceso administrativo.
  expect((await page.goto("/panel/padel-centro"))?.status()).toBe(404);
  expect((await page.goto("/admin"))?.status()).toBe(404);

  await page.goto("/explorar?deporte=padel");
  await expect(page.getByRole("status")).toContainText("complejo");
  await page.getByRole("link", { name: /Pádel Centro/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Pádel Centro" })).toBeVisible();
  await page.getByRole("button", { name: "♡ Agregar a favoritos" }).click();
  await expect(page.getByRole("button", { name: "♥ En favoritos" })).toBeVisible();

  const courtName = info.project.name === "mobile" ? "Cancha 2" : "Cancha 1";
  await page.getByRole("radiogroup", { name: "Fecha" }).getByRole("radio").nth(2).click();
  await page.getByRole("radio", { name: new RegExp(`^${courtName}`) }).click();
  await page.getByRole("radio", { name: "60 min" }).click();
  await page.getByRole("button", { name: /^19:00/ }).click();
  const summary = page.getByRole("definition").filter({ hasText: "Pádel Centro" });
  await expect(summary).toBeVisible();
  await expect(page.getByText("Precio del turno")).toBeVisible();
  await expect(page.getByLabel("Nombre y apellido")).toHaveValue("Juana Jugadora");
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await page.getByLabel("Teléfono").fill("11 5555-7777");
  await page.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(page.getByRole("heading", { name: "¡Listo, nos vemos en la cancha!" })).toBeVisible();

  await page.goto("/mis-turnos");
  const turn = page.getByRole("listitem").filter({ hasText: "Pádel Centro" }).first();
  await expect(turn).toContainText(courtName);
  await turn.getByRole("button", { name: "Cancelar turno" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sí, cancelar" }).click();
  // El turno pasa al historial como cancelado (el botón desaparece).
  await expect(page.getByRole("region", { name: "Canceladas y vencidas" }).getByRole("listitem").filter({ hasText: "Pádel Centro" }).first()).toContainText("Cancelada");

  await page.goto("/perfil");
  // Fase 6: aviso para confirmar el email (no bloquea el uso de la cuenta) y reenvío del enlace.
  await expect(page.getByText("Confirmá tu email.")).toBeVisible();
  await page.getByRole("button", { name: "Enviarme el enlace" }).click();
  await expect(page.getByText(/Te enviamos un nuevo enlace/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Complejos favoritos" }).getByRole("link", { name: /Pádel Centro/ })).toBeVisible();
  await page.getByLabel("Ciudad").fill("Funes");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Perfil actualizado.")).toBeVisible();
});

test("jugador vincula una reserva hecha como invitado con su enlace privado; con un enlace inválido no", async ({ page, request }) => {
  const { res, json } = await apiBook(request, "futbol-norte", 0, 3);
  expect(res.status()).toBe(201);
  await page.goto("/cuenta/registro");
  const email = `vincula-${Date.now()}@example.com`;
  await page.getByLabel("Nombre y apellido").fill("Pedro Invitado");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña (mín. 12 caracteres)").fill("clave-jugador-456");
  await page.getByLabel("Repetir contraseña").fill("clave-jugador-456");
  await page.getByLabel(/Acepto los términos/).check();
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Hola, Pedro" })).toBeVisible();
  await page.goto("/mis-turnos");
  await page.getByLabel("Enlace privado de la reserva").fill(`${json.trackingUrl.split("?t=")[0]}?t=${"A".repeat(43)}`);
  await page.getByRole("button", { name: "Vincular reserva" }).click();
  await expect(page.getByText("El enlace no es válido o la reserva no existe.")).toBeVisible();
  await page.getByLabel("Enlace privado de la reserva").fill(`http://localhost${json.trackingUrl}`);
  await page.getByRole("button", { name: "Vincular reserva" }).click();
  await expect(page.getByText(`Reserva ${json.code} vinculada a tu cuenta.`)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Próximos" })).toContainText("Fútbol Norte");
});

test("ubicación: el dueño marca el complejo en el mapa y el jugador ordena por cercanía y ve cómo llegar", async ({ page, context }) => {
  // Las teselas de OpenStreetMap no se descargan en las pruebas (respeto de su política de uso).
  await context.route("https://tile.openstreetmap.org/**", (r) => r.fulfill({ status: 204, body: "" }));
  await login(page, "duenio@padel-centro.example.com", OWNER_PW);
  await page.waitForURL("**/panel/padel-centro");
  await page.goto("/panel/padel-centro/pagina");
  const ubic = page.getByRole("region", { name: "Ubicación" });
  await ubic.getByLabel("Provincia").selectOption("Santa Fe");
  await ubic.getByRole("textbox", { name: /^Ciudad/ }).fill("Rosario");
  await ubic.getByRole("button", { name: "Abrir mapa" }).click();
  const map = ubic.getByLabel(/Mapa: tocá o arrastrá/);
  await expect(map).toBeVisible();
  await map.click({ position: { x: 150, y: 150 } });
  await expect(ubic.getByText(/Ubicación elegida: -?\d+\.\d{5}, -?\d+\.\d{5}/)).toBeVisible();
  await page.getByRole("button", { name: "Guardar página pública" }).click();
  await expect(page.getByText("Página pública actualizada.")).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/padel-centro");
  await expect(page.getByRole("link", { name: "Cómo llegar" }).first()).toHaveAttribute("href", /maps\/dir\/\?api=1&destination=-?\d/);
  await page.getByRole("button", { name: "Ver en el mapa" }).click();
  await expect(page.getByRole("region", { name: "Mapa con la ubicación de Pádel Centro" })).toBeVisible();
  await expect(page.getByRole("link", { name: "OpenStreetMap" })).toBeVisible(); // atribución obligatoria

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: -34.6037, longitude: -58.3816 });
  await page.goto("/explorar");
  await page.getByRole("button", { name: "📍 Ordenar por cercanía" }).click();
  await expect(page.getByText(/Ordenado por cercanía/)).toBeVisible();
  await expect(page.getByRole("listitem").first()).toContainText("Pádel Centro");
  await expect(page.getByRole("listitem").first()).toContainText(/📍 a \d+/);
});

// ---------------------------------------------------------------------------- Fase 5

test("regresión: reservar en la página pública con la sesión de un dueño de otro complejo", async ({ page }) => {
  // Reproducción del error reportado: un dueño con sesión abierta reservando en otro complejo.
  const posts: number[] = [];
  page.on("response", (r) => { if (r.url().includes("/bookings") && r.request().method() === "POST") posts.push(r.status()); });
  await login(page, "duenio@futbol-norte.example.com", OWNER_PW);
  await page.waitForURL("**/panel/futbol-norte");
  await page.goto("/padel-centro?desde=marketplace");
  await page.getByRole("radiogroup", { name: "Fecha" }).getByRole("radio").nth(3).click();
  await page.getByRole("radio", { name: /^Cancha 2/ }).click();
  await page.getByRole("radio", { name: "60 min" }).click();
  await page.getByRole("button", { name: /^18:00/ }).click();
  await page.getByLabel("Teléfono").fill("11 5555 0000");
  await page.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(page.getByRole("heading", { name: /Listo/ })).toBeVisible();
  expect(posts).toEqual([201]);
});

test("transferencia: el dueño configura cobros, el jugador reserva e informa, el dueño verifica", async ({ page, browser }) => {
  await login(page, "duenio@deportivo-sur.example.com", OWNER_PW);
  await page.waitForURL("**/panel/**");
  await page.goto("/panel/complejo-deportivo-sur/cobros");
  await page.locator('select[name="depositType"]').selectOption("FIXED");
  await page.getByRole("textbox", { name: /^Valor de la seña/ }).fill("5000");
  await page.getByLabel("Alias").fill("deportivo.sur");
  await page.getByLabel("Titular de la cuenta").fill("Deportivo Sur SRL");
  await page.getByRole("button", { name: "Guardar datos de cobro" }).click();
  await page.getByRole("button", { name: "Sí, guardar" }).click();
  await expect(page.getByText("Datos de cobro guardados.")).toBeVisible();
  await expect(page.getByText("Vista previa para el jugador")).toBeVisible();
  await expect(page.getByText("deportivo.sur").first()).toBeVisible();
  // El panel queda abierto en "Hoy": debe enterarse solo de la transferencia informada.
  await page.clock.install();
  await page.goto("/panel/complejo-deportivo-sur");
  await expect(page.getByText(/transferencias? por verificar/)).toHaveCount(0);

  const player = await browser.newPage();
  await player.goto("/complejo-deportivo-sur");
  await player.getByRole("radiogroup", { name: "Fecha" }).getByRole("radio").nth(1).click();
  await player.getByRole("radio", { name: /^Pádel 1/ }).click();
  await player.getByRole("radio", { name: "60 min" }).click();
  await player.getByRole("button", { name: /^19:00/ }).click();
  await expect(player.getByText("Seña a transferir ahora")).toBeVisible();
  await player.getByLabel("Nombre y apellido").fill("Tomás Transferencia");
  await player.getByLabel("Teléfono").fill("11 5555-3333");
  await player.getByLabel("Email").fill("tomas@example.com");
  await player.getByRole("radio", { name: "No" }).check();
  await player.getByLabel("Nombre del titular de la cuenta que transfiere").fill("Marta Titular");
  await player.getByRole("button", { name: "Reservar y ver datos para transferir" }).click();
  await expect(player.getByText(/Tu turno todavía no está confirmado/)).toBeVisible();
  await expect(player.getByText("deportivo.sur")).toBeVisible();
  await expect(player.getByText("Tiempo para transferir")).toBeVisible();
  const code = (await player.locator("strong").filter({ hasText: /^[A-HJ-NP-Z2-9]{8}$/ }).first().innerText()).trim();
  await player.getByLabel("Número de operación (opcional)").fill("998877");
  await player.getByRole("button", { name: "Ya realicé la transferencia" }).click();
  await player.getByRole("button", { name: "Sí, ya transferí" }).click();
  await expect(player.getByText(/Informaste la transferencia\. El complejo la está verificando/)).toBeVisible();
  await player.close();
  // Sin recargar: el sondeo liviano (cada minuto, pestaña visible) detecta el cambio.
  await page.clock.runFor(61_000);
  await expect(page.getByText("1 transferencia por verificar.")).toBeVisible({ timeout: 15_000 });

  await page.goto("/panel/complejo-deportivo-sur/transferencias");
  const card = page.getByRole("listitem").filter({ hasText: code });
  await expect(card).toContainText("Marta Titular");
  await expect(card).toContainText("998877");
  await card.getByText("Confirmar pago").click();
  await card.getByRole("button", { name: "Confirmar: el dinero llegó" }).click();
  await page.getByRole("button", { name: "Sí, verifiqué el pago" }).click();
  await expect(page.getByText(new RegExp(`Pago verificado. La reserva ${code}`))).toBeVisible();
  // Avisos internos del complejo con contador.
  await page.goto("/panel/complejo-deportivo-sur/avisos");
  await expect(page.getByText(new RegExp(`Transferencia informada · ${code}`))).toBeVisible();
});

test("superadmin suspende a un jugador: su sesión deja de funcionar al instante", async ({ page, browser }) => {
  const email = `suspendible-${Date.now()}@example.com`;
  const player = await browser.newPage();
  await player.goto("/cuenta/registro");
  await player.getByLabel("Nombre y apellido").fill("Pepe Suspendible");
  await player.getByLabel("Email").fill(email);
  await player.getByLabel("Contraseña (mín. 12 caracteres)").fill("clave-jugador-123");
  await player.getByLabel("Repetir contraseña").fill("clave-jugador-123");
  await player.getByLabel(/Acepto los términos/).check();
  await player.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(player.getByRole("heading", { name: "Hola, Pepe" })).toBeVisible();

  await loginSuperadmin(page);
  await page.goto(`/admin/usuarios?q=${encodeURIComponent(email)}`);
  await page.getByRole("link", { name: "Pepe Suspendible" }).click();
  await page.getByRole("button", { name: "Suspender usuario" }).click();
  const susp = page.getByRole("dialog", { name: "Suspender a Pepe Suspendible" });
  await susp.getByLabel("Motivo (queda registrado)").fill("Prueba automatizada de suspensión");
  await susp.getByRole("button", { name: "Suspender usuario" }).click();
  await page.getByRole("button", { name: "Suspender", exact: true }).click();
  await expect(page.getByText(/Suspendido el .*Prueba automatizada de suspensión/)).toBeVisible();
  // Las contraseñas y sesiones nunca se muestran.
  await expect(page.getByText(/clave-jugador-123/)).toHaveCount(0);

  await player.goto("/mis-turnos");
  await expect(player.getByText("Ingresá para ver tus reservas en todos los complejos.")).toBeVisible();
  await player.close();
});
