import { expect, test, type Page } from "@playwright/test";
import { E2E_ENV } from "../../playwright.config";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
}

function tomorrow() {
  const d = new Date(Date.now() + 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(d);
}

test("cliente reserva online, recibe código y el turno queda ocupado @mobile", async ({ page }, testInfo) => {
  // Cada proyecto (escritorio / móvil) usa su propia cancha para no depender del otro.
  const courtName = testInfo.project.name === "mobile" ? "Cancha 3" : "Cancha 1";
  await page.goto("/padel-centro");
  await expect(page.getByRole("heading", { level: 1, name: "Pádel Centro" })).toBeVisible();
  await page.getByLabel("Fecha").fill(tomorrow());
  await page.getByRole("radio", { name: "90 min" }).click();

  const court = page.locator("article").filter({ has: page.getByRole("heading", { name: courtName }) });
  const slot = court.getByRole("button", { name: /^20:00/ });
  await expect(slot).toBeEnabled();
  await slot.click();

  await page.getByLabel("Nombre y apellido").fill("Lionel Prueba");
  await page.getByLabel("Teléfono").fill("11 5555-0001");
  await page.getByLabel("Email").fill("lionel@example.com");
  await page.getByRole("button", { name: "Confirmar reserva" }).click();

  await expect(page.getByRole("heading", { name: "¡Reserva confirmada!" })).toBeVisible();
  await expect(page.getByText(/^[A-HJ-NP-Z2-9]{8}$/)).toBeVisible();

  await page.getByRole("button", { name: "Hacer otra reserva" }).click();
  await page.getByLabel("Fecha").fill(tomorrow());
  await page.getByRole("radio", { name: "90 min" }).click();
  const again = page.locator("article").filter({ has: page.getByRole("heading", { name: courtName }) });
  await expect(again.getByRole("button", { name: /^20:00/ })).toBeDisabled();
  await expect(again.getByRole("button", { name: /^21:00/ })).toBeDisabled(); // se solapa con 20:00–21:30
  await expect(again.getByRole("button", { name: /^21:30/ })).toBeEnabled(); // consecutiva
});

test("dos solicitudes simultáneas por HTTP al mismo turno: una 201 y una 409", async ({ request, page }) => {
  await page.goto("/padel-centro");
  const avail = await request.get(`/api/public/padel-centro/availability?date=${tomorrow()}&duration=60`);
  const day = await avail.json();
  const court = day.courts[1];
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
  // El error no expone detalles internos de PostgreSQL.
  expect(JSON.stringify(loser)).not.toMatch(/court_allocations|exclusion|constraint|23P01/i);
});

test("el cuerpo no puede elegir tenant, estado ni precio; datos inválidos dan 400", async ({ request }) => {
  const res = await request.post("/api/public/padel-centro/bookings", {
    data: { courtId: "not-a-uuid", startsAt: "ayer", durationMinutes: 90, tenantId: "x", status: "CONFIRMED" },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
});

test("login con contraseña incorrecta muestra mensaje genérico", async ({ page }) => {
  await login(page, "duenio@padel-centro.example.com", "contraseña-incorrecta");
  await expect(page.getByText("Email o contraseña incorrectos.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("el dueño ve la reserva en su panel y no accede al panel de otro complejo", async ({ page }) => {
  await login(page, "duenio@padel-centro.example.com", E2E_ENV.SEED_OWNER_PASSWORD);
  await page.waitForURL("**/panel/padel-centro");
  await page.goto(`/panel/padel-centro?date=${tomorrow()}`);
  await expect(page.getByText("Lionel Prueba")).toBeVisible();

  const res = await page.goto("/panel/futbol-norte");
  expect(res?.status()).toBe(404);
  const admin = await page.goto("/admin");
  expect(admin?.status()).toBe(404);
});

test("cookies de sesión httpOnly y cabeceras de seguridad", async ({ page, context }) => {
  await login(page, "duenio@futbol-norte.example.com", E2E_ENV.SEED_OWNER_PASSWORD);
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
  await page.goto("/panel/padel-centro");
  await expect(page).toHaveURL(/\/login\?next=%2Fpanel%2Fpadel-centro/);
});

test("el registro público está deshabilitado y el login desde otro origen se rechaza", async ({ request }) => {
  const signUp = await request.post("/api/auth/sign-up/email", {
    data: { email: "intruso@example.com", password: "una-clave-larga-123", name: "Intruso" },
    headers: { Origin: E2E_ENV.BETTER_AUTH_URL },
  });
  expect(signUp.ok()).toBe(false);

  const crossOrigin = await request.post("/api/auth/sign-in/email", {
    data: { email: "duenio@padel-centro.example.com", password: E2E_ENV.SEED_OWNER_PASSWORD },
    headers: { Origin: "https://sitio-malicioso.example" },
  });
  expect(crossOrigin.status()).toBe(403);
  expect(crossOrigin.headers()["set-cookie"] ?? "").not.toContain("session_token");
});
