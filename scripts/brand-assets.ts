// Renders the PNG icons and the social share image from the SVG sources in public/.
// Usage: npx tsx scripts/brand-assets.ts   (re-run after changing public/favicon.svg or public/brand/archer.svg)
import fs from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { BRAND } from "../shared/brand.js";

const read = (p: string) => fs.readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");
const write = (p: string, data: Buffer | string) => fs.writeFileSync(new URL(`../public/${p}`, import.meta.url), data);
const render = (svg: string, width: number) =>
  new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: true, defaultFontFamily: "Segoe UI" } }).render().asPng();

const mark = read("favicon.svg");
const inner = (svg: string) => svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<title>.*?<\/title>/, "");

fs.mkdirSync(new URL("../public/icons", import.meta.url), { recursive: true });
// Browser tabs and the web manifest: the freestanding mark on a transparent background.
for (const size of [32, 192, 512]) write(`icons/icon-${size}.png`, render(mark, size));
// Home-screen icons can't be transparent (iOS fills it black): the mark on white, with room around it.
const onWhite = (pad: number) => { const size = 64 + pad * 2; return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#ffffff"/><g transform="translate(${pad} ${pad})">${inner(mark)}</g></svg>`; };
write("icons/icon-180.png", render(onWhite(10), 180));
// Android "maskable": the launcher may crop to a circle, so keep the mark inside the central safe zone.
write("icons/maskable-512.png", render(onWhite(22), 512));

// 1200×630 share image: brand, promise, archer illustration.
const archer = inner(read("brand/archer.svg"));
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ecf8fb"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1080" cy="80" r="220" fill="#d3f0f6" opacity="0.6"/>
  <g transform="translate(72 72) scale(1.25)">${inner(mark)}</g>
  <text x="170" y="122" font-family="Segoe UI" font-weight="800" font-size="44" fill="#0a2230">MyCareer<tspan fill="#07a384">.AI</tspan></text>
  <text x="72" y="250" font-family="Segoe UI" font-weight="800" font-size="64" fill="#0a2230">Hit the right job.</text>
  <text x="72" y="330" font-family="Segoe UI" font-weight="800" font-size="64" fill="#07a384">First time.</text>
  <text x="72" y="400" font-family="Segoe UI" font-size="27" fill="#475569">AI that understands you and finds jobs that fit —</text>
  <text x="72" y="440" font-family="Segoe UI" font-size="28" fill="#475569">then stays with you until you are placed. Free.</text>
  <text x="72" y="560" font-family="Segoe UI" font-weight="600" font-size="24" fill="#0b8db3">${new URL(BRAND.defaultUrl).host}</text>
  <g transform="translate(690 270) scale(2.0)">${archer}</g>
</svg>`;
write("og-image.png", render(og, 1200));
console.log("Wrote public/icons/*.png and public/og-image.png");
