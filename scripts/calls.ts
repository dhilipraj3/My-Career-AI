// How many API calls does each screen make when it opens, and in what order? npx tsx scripts/calls.ts
import { startDemo, wait } from "./lib/demo-app.js";
const d = await startDemo({ port: 3191, admin: true });
const { page } = await d.tab();
const log: Array<{ t: number; url: string; ms?: number }> = [];
let t0 = 0;
page.on("request", (r) => { if (r.url().includes("/api/") && !r.url().includes("/analytics")) (r as any).__i = log.push({ t: Math.round(performance.now() - t0), url: r.method() + " " + r.url().split("/api")[1].split("?")[0] }) - 1; });
page.on("requestfinished", (r) => { const i = (r as any).__i; if (i !== undefined) log[i].ms = Math.round(performance.now() - t0) - log[i].t; });
for (const route of ["", "matches", "search", "applications", "profile", "resume", "interview", "insights", "settings"]) {
  log.length = 0; await page.goto("about:blank"); t0 = performance.now();
  await page.goto(`${d.base}/?dev=demo&notour#${route}`, { waitUntil: "networkidle0" }); await wait(800);
  const dup = log.map((l) => l.url).filter((u, i, a) => a.indexOf(u) !== i);
  console.log(`#${route || "home"}: ${log.length} calls, done at ${Math.max(...log.map((l) => l.t + (l.ms || 0)))} ms${dup.length ? `, repeated: ${[...new Set(dup)].join(", ")}` : ""}`);
  if (process.env.CALLS_VERBOSE) for (const l of log) console.log(`   +${l.t}ms ${l.url} (${l.ms}ms)`);
}
await d.close(); process.exit(0);
