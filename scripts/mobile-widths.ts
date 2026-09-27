// Checks the dashboard (and a couple of other screens) at several real phone widths, since a layout bug can be
// specific to one resolution. Looks for overflow, overlapping elements, and the readiness ring's number landing off
// centre (the kind of bug a single-width screenshot misses). npx tsx scripts/mobile-widths.ts
import { startDemo, wait } from "./lib/demo-app.js";

const d = await startDemo({ port: 3192, admin: true });
const WIDTHS = [320, 360, 375, 390, 412, 428];
const problems: string[] = [];

for (const width of WIDTHS) {
  const { page, go } = await d.tab({ width, height: 844 });
  await go("");
  await wait(600);
  const found = await page.evaluate(() => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) out.push(`page wider than screen (${document.documentElement.scrollWidth} > ${vw})`);
    // Every ring's number should sit within a few px of the circle's own centre.
    for (const svg of document.querySelectorAll("svg[role=img]")) {
      const circle = svg.querySelector("circle"); const text = svg.querySelector("text");
      if (!circle || !text) continue;
      const cb = circle.getBoundingClientRect(), tb = text.getBoundingClientRect();
      const cx = cb.left + cb.width / 2, cy = cb.top + cb.height / 2;
      const tx = tb.left + tb.width / 2, ty = tb.top + tb.height / 2;
      if (Math.abs(cx - tx) > 4 || Math.abs(cy - ty) > 4) out.push(`ring number off-centre by (${Math.round(cx - tx)}, ${Math.round(cy - ty)}) — "${text.textContent}"`);
    }
    // Two elements from different cards shouldn't visually overlap (a sign of a squeezed flex row).
    const cards = [...document.querySelectorAll<HTMLElement>("main [class*=rounded-2xl], main [class*=rounded-3xl]")];
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      if (cards[i].contains(cards[j]) || cards[j].contains(cards[i])) continue;
      const a = cards[i].getBoundingClientRect(), b = cards[j].getBoundingClientRect();
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlapX > 10 && overlapY > 10 && a.width > 20 && a.height > 20 && b.width > 20 && b.height > 20) out.push(`two cards overlap by ${Math.round(overlapX)}x${Math.round(overlapY)}px`);
    }
    return [...new Set(out)];
  });
  for (const f of found) problems.push(`[${width}px] ${f}`);
  console.log(`${width}px: ${found.length ? found.join(" | ") : "ok"}`);
  await page.close();
}

await d.close();
console.log(`\n${problems.length} problem(s)`);
process.exit(problems.length ? 1 : 0);
