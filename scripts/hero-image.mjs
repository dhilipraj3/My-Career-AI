// Builds the landing hero images from the rendered source in design/hero-journey-source.png:
// removes the generator's corner watermark (a soft blurred patch of the surrounding glow) and writes web-sized WebP files.
// Run: node scripts/hero-image.mjs
import fs from "node:fs";
import sharp from "sharp";

const SRC = "design/hero-journey-source.png";
const OUT = "public/hero";
fs.mkdirSync(OUT, { recursive: true });

const meta = await sharp(SRC).metadata();
const W = meta.width, H = meta.height;
// The watermark star sits near the bottom-right corner (about 91% across, 85% down).
const cx = Math.round(W * 0.9085), cy = Math.round(H * 0.8535), r = 130;

const blurred = await sharp(SRC).blur(45).png().toBuffer();
const patch = await sharp(blurred).extract({ left: cx - r, top: cy - r, width: r * 2, height: r * 2 }).png().toBuffer();
const mask = Buffer.from(`<svg width="${r * 2}" height="${r * 2}"><defs><radialGradient id="g"><stop offset="0.55" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
const feathered = await sharp(patch).composite([{ input: await sharp(mask).png().toBuffer(), blend: "dest-in" }]).png().toBuffer();
const clean = await sharp(SRC).composite([{ input: feathered, left: cx - r, top: cy - r }]).png().toBuffer();

for (const [name, width] of [["journey-2400", 2400], ["journey-1600", 1600], ["journey-900", 900]]) {
  await sharp(clean).resize({ width }).webp({ quality: 84, effort: 5 }).toFile(`${OUT}/${name}.webp`);
  console.log(`wrote ${OUT}/${name}.webp`);
}
