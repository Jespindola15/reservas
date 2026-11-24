// Genera íconos de la PWA, favicon e imágenes de email a partir de los vectores de la marca.
// Uso: npm run icons   (fuentes: public/brand/turnup-mark.svg y public/brand/turnup-wordmark-light.svg)
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";

const INK = "#05070d";
const root = new URL("../", import.meta.url);
const p = (rel) => new URL(rel, root).pathname;
const mark = await readFile(p("public/brand/turnup-mark.svg"));

/** Marca centrada sobre fondo oscuro. `scale` = alto de la marca respecto del lado; `radius` en fracción del lado. */
async function tile(size, scale, radius) {
  const h = Math.round(size * scale);
  const glyph = await sharp(mark, { density: 600 }).resize({ height: h }).png().toBuffer();
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * radius)}" fill="${INK}"/></svg>`);
  return sharp(bg).composite([{ input: glyph, gravity: "center" }]).png().toBuffer();
}

await writeFile(p("public/icons/icon-192.png"), await tile(192, 0.62, 0.22));
await writeFile(p("public/icons/icon-512.png"), await tile(512, 0.62, 0.22));
// Maskable: fondo completo y marca dentro de la zona segura (círculo del 80 %).
await writeFile(p("public/icons/maskable-512.png"), await tile(512, 0.5, 0));
// iOS redondea solo: fondo completo.
await writeFile(p("public/icons/apple-touch-icon.png"), await tile(180, 0.6, 0));

// favicon.ico con PNG embebidos (16, 32, 48).
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => tile(s, 0.74, 0.2)));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s, e); header.writeUInt8(s, e + 1); header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(pngs[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
await writeFile(p("src/app/favicon.ico"), Buffer.concat([header, ...pngs]));

// Logo para emails (los clientes de correo no muestran SVG).
const wm = await readFile(p("public/brand/turnup-wordmark-light.svg"));
await sharp(wm, { density: 300 }).resize({ height: 64 }).png().toFile(p("public/brand/turnup-email.png"));
console.log("Íconos y logos generados.");
