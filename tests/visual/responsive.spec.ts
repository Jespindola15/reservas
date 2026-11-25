/**
 * Auditoría responsive: recorre las tres interfaces en 9 anchos, guarda capturas y FALLA si
 * alguna página tiene desplazamiento horizontal (contenido más ancho que la pantalla).
 *   RESPONSIVE=1 npx playwright test tests/visual --config playwright.visual.config.ts
 * Capturas en capturas/<interfaz>/<ancho>x<alto>/<página>.png (fuera de test-results).
 */
import { expect, test, type Page } from "@playwright/test";
import { totp } from "../support/totp";
import { E2E_ENV } from "../../playwright.config";

/** Tamaños pedidos (ancho × alto) más 320 px para detectar desbordes en celulares chicos. */
const SIZES: [number, number][] = [[320, 640], [375, 812], [390, 844], [768, 1024], [1440, 900], [1920, 1080]];
/** Carpeta FUERA de test-results (Playwright la borra en cada corrida). */
const OUT = process.env.CAPTURAS_DIR ?? "capturas";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
}

async function audit(page: Page, name: string, path: string, group = "general") {
  const problems: string[] = [];
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(path);
    await page.waitForLoadState("load");
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      if (doc.scrollWidth <= window.innerWidth + 1) return null;
      // El elemento más ancho que la pantalla (para saber qué arreglar).
      const culprit = [...document.querySelectorAll("body *")].find((el) => {
        const r = el.getBoundingClientRect();
        return r.right > window.innerWidth + 1 && getComputedStyle(el).position !== "fixed" && !el.closest("[data-scroll-x]") && !el.closest("table") ;
      });
      return `${doc.scrollWidth}px > ${window.innerWidth}px · ${culprit ? `${culprit.tagName.toLowerCase()}.${String(culprit.className).slice(0, 60)}` : "?"}`;
    });
    if (overflow) problems.push(`${name} @${w}: ${overflow}`);
    if (w !== 320) await page.screenshot({ path: `${OUT}/${group}/${w}x${h}/${name}.png`, fullPage: true });
  }
  return problems;
}

test.skip(!process.env.RESPONSIVE, "Solo con RESPONSIVE=1");
test.setTimeout(600_000);

/** Captura del tamaño actual en capturas/flujo/<ancho>x<alto>/<nombre>.png. */
async function shot(page: Page, name: string) {
  const v = page.viewportSize()!;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/flujo/${v.width}x${v.height}/${name}.png`, fullPage: true });
}

/**
 * Recorrido completo con datos reales de la base de prueba (no maquetas):
 * registro → búsqueda → complejo → horario → reserva con seña → transferencia informada →
 * verificación del complejo → confirmación → historial. Deja datos para las capturas del panel.
 */
test("flujo completo de reserva con transferencia (capturas)", async ({ browser }) => {
  for (const [w, h] of [[390, 844], [1440, 900]] as const) {
    const owner = await browser.newPage({ viewport: { width: w, height: h }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
    await login(owner, "duenio@padel-centro.example.com", E2E_ENV.SEED_OWNER_PASSWORD);
    await owner.waitForURL("**/panel/**");
    if (w === 390) {
      await owner.goto("/panel/padel-centro/cobros");
      await owner.locator('select[name="depositType"]').selectOption("PERCENT");
      await owner.getByRole("textbox", { name: /^Valor de la seña/ }).fill("30");
      await owner.getByLabel("Alias").fill("padel.centro.mp");
      await owner.getByLabel("Titular de la cuenta").fill("Pádel Centro SRL");
      await owner.getByRole("button", { name: "Guardar datos de cobro" }).click();
      await shot(owner, "10-cobros-confirmacion-modal");
      await owner.getByRole("button", { name: "Sí, guardar" }).click();
      await expect(owner.getByText("Datos de cobro guardados.")).toBeVisible();
    }
    await owner.goto("/panel/padel-centro/cobros");
    await shot(owner, "11-panel-datos-de-cobro");

    const player = await browser.newPage({ viewport: { width: w, height: h }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
    await player.goto("/cuenta/registro");
    await shot(player, "01-registro");
    await player.getByLabel("Nombre y apellido").fill(w === 390 ? "Lucía Gómez" : "Martín Pérez");
    await player.getByLabel("Email").fill(`flujo-${w}-${Date.now()}@example.com`);
    await player.getByLabel("Contraseña (mín. 12 caracteres)").fill("clave-de-flujo-123");
    await player.getByLabel("Repetir contraseña").fill("clave-de-flujo-123");
    await player.getByLabel(/Acepto los términos/).check();
    await player.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(player.getByRole("heading", { name: /^Hola, / })).toBeVisible();
    await player.goto("/explorar?q=P%C3%A1del");
    await shot(player, "02-busqueda");
    await player.getByRole("link", { name: /Pádel Centro/ }).first().click();
    await player.waitForURL("**/padel-centro**");
    await shot(player, "03-ficha-complejo");
    await player.getByRole("radiogroup", { name: "Fecha" }).getByRole("radio").nth(w === 390 ? 1 : 2).click();
    await player.getByRole("radio", { name: "90 min" }).click();
    await player.getByRole("button", { name: /^20:00/ }).first().click();
    await player.getByLabel("Teléfono").fill("11 5555 1234");
    await shot(player, "04-resumen-y-datos");
    await player.getByRole("button", { name: "Reservar y ver datos para transferir" }).click();
    await expect(player.getByText(/Tu turno todavía no está confirmado/)).toBeVisible();
    await shot(player, "05-datos-para-transferir");
    await player.getByLabel("Número de operación (opcional)").fill(w === 390 ? "120045" : "120046");
    await player.getByRole("button", { name: "Ya realicé la transferencia" }).click();
    await player.getByRole("button", { name: "Sí, ya transferí" }).click();
    await expect(player.getByText(/avisamos al complejo/)).toBeVisible();
    await shot(player, "06-transferencia-informada");
    await player.goto("/mis-turnos");
    await shot(player, "07-mis-turnos-pendiente");

    await owner.goto("/panel/padel-centro");
    await shot(owner, "12-panel-dashboard-con-pendientes");
    await owner.goto("/panel/padel-centro/transferencias");
    await shot(owner, "13-transferencias-por-verificar");
    const card = owner.getByRole("listitem").filter({ hasText: w === 390 ? "120045" : "120046" });
    await card.getByText("Confirmar pago").click();
    await shot(owner, "14-confirmar-pago");
    await card.getByRole("button", { name: "Confirmar: el dinero llegó" }).click();
    await owner.getByRole("button", { name: "Sí, verifiqué el pago" }).click();
    await expect(owner.getByText(/Pago verificado/)).toBeVisible();
    await shot(owner, "15-pago-verificado");
    const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
    await owner.goto(`/panel/padel-centro/calendario?date=${tomorrow}`);
    await shot(owner, "16-calendario");
    await owner.goto("/panel/padel-centro/reservas");
    await shot(owner, "17-reservas");
    if (w === 390) {
      await owner.getByRole("button", { name: "Más" }).click({ timeout: 3000 }).catch(() => undefined);
      await shot(owner, "18-menu-movil");
    }

    await player.goto("/mis-turnos");
    await shot(player, "08-mis-turnos-confirmada");
    await player.goto("/avisos");
    await shot(player, "09-avisos");
    await owner.close();
    await player.close();
  }
});

test("responsive: páginas públicas y del jugador", async ({ page }) => {
  const p: string[] = [];
  p.push(...(await audit(page, "inicio", "/", "jugadores")));
  p.push(...(await audit(page, "explorar", "/explorar", "jugadores")));
  p.push(...(await audit(page, "explorar-busqueda", "/explorar?deporte=padel", "jugadores")));
  p.push(...(await audit(page, "ingresar", "/cuenta/ingresar", "jugadores")));
  p.push(...(await audit(page, "registro", "/cuenta/registro", "jugadores")));
  p.push(...(await audit(page, "login-panel", "/login", "panel")));
  p.push(...(await audit(page, "complejo", "/padel-centro", "jugadores")));
  await page.goto("/cuenta/registro");
  await page.getByLabel("Nombre y apellido").fill("Ana Responsive");
  await page.getByLabel("Email").fill(`resp-${Date.now()}@example.com`);
  await page.getByLabel("Contraseña (mín. 12 caracteres)").fill("clave-responsive-1");
  await page.getByLabel("Repetir contraseña").fill("clave-responsive-1");
  await page.getByLabel(/Acepto los términos/).check();
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Hola, Ana" })).toBeVisible();
  p.push(...(await audit(page, "jugador-inicio", "/", "jugadores")));
  p.push(...(await audit(page, "mis-turnos", "/mis-turnos", "jugadores")));
  p.push(...(await audit(page, "avisos", "/avisos", "jugadores")));
  p.push(...(await audit(page, "perfil", "/perfil", "jugadores")));
  expect(p, p.join("\n")).toEqual([]);
});

test("responsive: panel del complejo", async ({ page }) => {
  await login(page, "duenio@padel-centro.example.com", E2E_ENV.SEED_OWNER_PASSWORD);
  await page.waitForURL("**/panel/**");
  const p: string[] = [];
  for (const [n, path] of [["panel-inicio", ""], ["panel-calendario", "/calendario"], ["panel-reservas", "/reservas"], ["panel-transferencias", "/transferencias"], ["panel-cobros", "/cobros"], ["panel-avisos", "/avisos"], ["panel-canchas", "/canchas"], ["panel-pagina", "/pagina"], ["panel-estadisticas", "/estadisticas"], ["panel-finanzas", "/finanzas"], ["panel-plan", "/plan"], ["panel-clientes", "/clientes"], ["panel-equipo", "/equipo"], ["panel-horarios", "/horarios"], ["panel-ajustes", "/ajustes"]] as const) {
    p.push(...(await audit(page, n, `/panel/padel-centro${path}`, "panel")));
  }
  expect(p, p.join("\n")).toEqual([]);
});

test("responsive: superadministrador", async ({ page }) => {
  await login(page, "superadmin@example.com", E2E_ENV.SEED_SUPERADMIN_PASSWORD);
  await page.waitForURL("**/panel");
  await page.goto("/admin");
  await page.getByLabel("Contraseña actual").fill(E2E_ENV.SEED_SUPERADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByText("¿No podés escanear?").click();
  const secret = (await page.locator("details code").innerText()).trim();
  await page.getByLabel("Ya guardé mis códigos de respaldo").check();
  await page.getByLabel("Código de 6 dígitos").fill(totp(secret));
  await page.getByRole("button", { name: "Activar verificación en dos pasos" }).click();
  await page.waitForURL("**/admin");
  const p: string[] = [];
  p.push(...(await audit(page, "admin-resumen", "/admin", "superadmin")));
  p.push(...(await audit(page, "admin-complejos", "/admin/complejos", "superadmin")));
  p.push(...(await audit(page, "admin-usuarios", "/admin/usuarios", "superadmin")));
  p.push(...(await audit(page, "admin-planes", "/admin/planes", "superadmin")));
  p.push(...(await audit(page, "admin-sistema", "/admin/sistema", "superadmin")));
  p.push(...(await audit(page, "admin-auditoria", "/admin/auditoria", "superadmin")));
  const id = await page.evaluate(async () => (await fetch("/admin/complejos")).ok);
  expect(id).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin/complejos");
  const href = await page.getByRole("link", { name: "Pádel Centro" }).first().getAttribute("href");
  p.push(...(await audit(page, "admin-complejo", href!, "superadmin")));
  expect(p, p.join("\n")).toEqual([]);
});
