/**
 * Auditoría responsive: recorre las tres interfaces en 9 anchos, guarda capturas y FALLA si
 * alguna página tiene desplazamiento horizontal (contenido más ancho que la pantalla).
 *   RESPONSIVE=1 npx playwright test tests/visual --config playwright.visual.config.ts
 * Capturas en test-results/responsive/<ancho>/<página>.png
 */
import { expect, test, type Page } from "@playwright/test";
import { totp } from "../support/totp";
import { E2E_ENV } from "../../playwright.config";

const WIDTHS = [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920];

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
}

async function audit(page: Page, name: string, path: string) {
  const problems: string[] = [];
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: w < 768 ? 800 : 900 });
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
    await page.screenshot({ path: `test-results/responsive/${w}/${name}.png`, fullPage: true });
  }
  return problems;
}

test.skip(!process.env.RESPONSIVE, "Solo con RESPONSIVE=1");
test.setTimeout(600_000);

test("responsive: páginas públicas y del jugador", async ({ page }) => {
  const p: string[] = [];
  p.push(...(await audit(page, "inicio", "/")));
  p.push(...(await audit(page, "explorar", "/explorar")));
  p.push(...(await audit(page, "complejo", "/padel-centro")));
  await page.goto("/cuenta/registro");
  await page.getByLabel("Nombre y apellido").fill("Ana Responsive");
  await page.getByLabel("Email").fill(`resp-${Date.now()}@example.com`);
  await page.getByLabel("Contraseña (mín. 12 caracteres)").fill("clave-responsive-1");
  await page.getByLabel("Repetir contraseña").fill("clave-responsive-1");
  await page.getByLabel(/Acepto los términos/).check();
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Hola, Ana" })).toBeVisible();
  p.push(...(await audit(page, "jugador-inicio", "/")));
  p.push(...(await audit(page, "mis-turnos", "/mis-turnos")));
  p.push(...(await audit(page, "avisos", "/avisos")));
  p.push(...(await audit(page, "perfil", "/perfil")));
  expect(p, p.join("\n")).toEqual([]);
});

test("responsive: panel del complejo", async ({ page }) => {
  await login(page, "duenio@padel-centro.example.com", E2E_ENV.SEED_OWNER_PASSWORD);
  await page.waitForURL("**/panel/**");
  const p: string[] = [];
  for (const [n, path] of [["panel-inicio", ""], ["panel-calendario", "/calendario"], ["panel-reservas", "/reservas"], ["panel-transferencias", "/transferencias"], ["panel-cobros", "/cobros"], ["panel-avisos", "/avisos"], ["panel-canchas", "/canchas"], ["panel-pagina", "/pagina"], ["panel-estadisticas", "/estadisticas"]] as const) {
    p.push(...(await audit(page, n, `/panel/padel-centro${path}`)));
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
  p.push(...(await audit(page, "admin-resumen", "/admin")));
  p.push(...(await audit(page, "admin-complejos", "/admin/complejos")));
  p.push(...(await audit(page, "admin-usuarios", "/admin/usuarios")));
  const id = await page.evaluate(async () => (await fetch("/admin/complejos")).ok);
  expect(id).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin/complejos");
  const href = await page.getByRole("link", { name: "Pádel Centro" }).first().getAttribute("href");
  p.push(...(await audit(page, "admin-complejo", href!)));
  expect(p, p.join("\n")).toEqual([]);
});
