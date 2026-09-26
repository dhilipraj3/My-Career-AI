// Exploration helper: prints the buttons, inputs and selects on a screen. npx tsx scripts/dump-ui.ts profile
import { startDemo } from "./lib/demo-app.js";
const d = await startDemo({ port: 3195, admin: true });
const t = await d.tab(); await t.go(process.argv[2] || "");
console.log(await t.page.evaluate(() => [...document.querySelectorAll<HTMLElement>("main button, main a[href], main input, main select, main textarea, main [role=tab]")].map((e) => `${e.tagName.toLowerCase()}${e.getAttribute("type") ? "[" + e.getAttribute("type") + "]" : ""} ${(e.getAttribute("aria-label") || e.getAttribute("placeholder") || e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60)}`).join("\n")));
await d.close(); process.exit(0);
