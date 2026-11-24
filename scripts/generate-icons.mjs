// Genera los íconos PNG de la PWA a partir de public/icons/icon.svg (uso: node scripts/generate-icons.mjs).
import sharp from "sharp";
import { readFile } from "node:fs/promises";

const svg = await readFile(new URL("../public/icons/icon.svg", import.meta.url));
const out = (n) => new URL(`../public/icons/${n}`, import.meta.url).pathname;
for (const size of [192, 512]) await sharp(svg, { density: 300 }).resize(size, size).png().toFile(out(`icon-${size}.png`));
await sharp(svg, { density: 300 }).resize(180, 180).flatten({ background: "#05070d" }).png().toFile(out("apple-touch-icon.png"));
// Maskable: el contenido debe entrar en el 80 % central (zona segura).
const inner = await sharp(svg, { density: 300 }).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#05070d" } })
  .composite([{ input: inner, gravity: "center" }])
  .png()
  .toFile(out("maskable-512.png"));
console.log("Íconos generados en public/icons");
