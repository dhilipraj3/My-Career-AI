// Turns the generated guide images (design/agent/*.png, on a flat green background) into transparent WebP files
// in public/agent/. Green removal is a chroma key with despill, so edges do not keep a green fringe. All poses are
// cropped to the same box (the union of every pose), so she never jumps around when the pose changes.
// Run: node scripts/agent-art.mjs
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const IN = "design/agent", OUT = "public/agent", HEIGHT = 640;
fs.mkdirSync(OUT, { recursive: true });
const files = fs.existsSync(IN) ? fs.readdirSync(IN).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)) : [];
if (!files.length) { console.log(`No images in ${IN}. See design/AGENT-ART.md.`); process.exit(0); }

const keyed = [];
for (const f of files) {
  const { data, info } = await sharp(path.join(IN, f)).ensureAlpha().resize({ height: 1400, withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  const px = Buffer.from(data);
  let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4;
    const r = px[i], g = px[i + 1], b = px[i + 2], greenness = g - Math.max(r, b);
    if (g > 120 && greenness > 60) px[i + 3] = 0; // the background
    else if (g > 90 && greenness > 22) { // edge: fade by how green it is, and pull the tint back to neutral (despill)
      px[i + 3] = Math.max(0, Math.round(255 * (1 - (greenness - 22) / 38)));
      px[i + 1] = Math.min(g, Math.max(r, b));
    }
    if (px[i + 3] > 24) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  keyed.push({ name: path.parse(f).name.toLowerCase(), px, w: info.width, h: info.height, box: [x0, y0, x1, y1] });
}

const pad = 6;
const u = keyed.reduce((a, k) => [Math.min(a[0], k.box[0]), Math.min(a[1], k.box[1]), Math.max(a[2], k.box[2]), Math.max(a[3], k.box[3])], [1e9, 1e9, 0, 0]);
for (const k of keyed) {
  const left = Math.max(0, u[0] - pad), top = Math.max(0, u[1] - pad);
  const width = Math.min(k.w - left, u[2] - u[0] + pad * 2), height = Math.min(k.h - top, u[3] - u[1] + pad * 2);
  const out = await sharp(k.px, { raw: { width: k.w, height: k.h, channels: 4 } }).extract({ left, top, width, height }).resize({ height: HEIGHT, withoutEnlargement: true }).webp({ quality: 88, alphaQuality: 92 }).toBuffer();
  fs.writeFileSync(path.join(OUT, `${k.name}.webp`), out);
  console.log(`public/agent/${k.name}.webp (${Math.round(out.length / 1024)} KB)`);
}
