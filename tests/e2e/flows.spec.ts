import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
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

test("el dueño no accede al panel de otro complejo ni al superadmin", async ({ page }) => {
  await login(page, "duenio@padel-centro.example.com", OWNER_PW);
  await page.waitForURL("**/panel/padel-centro");
  expect((await page.goto("/panel/futbol-norte"))?.status()).toBe(404);
  expect((await page.goto("/panel/futbol-norte/clientes"))?.status()).toBe(404);
  expect((await page.goto("/admin"))?.status()).toBe(404);
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
  await login(page, "superadmin@example.com", E2E_ENV.SEED_SUPERADMIN_PASSWORD);
  await page.waitForURL("**/panel");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Plataforma" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Pádel Centro/ })).toBeVisible();
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
