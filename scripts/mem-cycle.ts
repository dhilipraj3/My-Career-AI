// Runs one real job-fetch cycle on a copy of the local data and watches the heap, to prove a small server survives it.
// Run exactly like Render's 512 MB instance:
//   FORCE_SMALL_SERVER=1 node --expose-gc --max-old-space-size=307 --import tsx scripts/mem-cycle.ts
process.env.DISCOVERY_INTERVAL_MINUTES = "0";
import fs from "node:fs";
import path from "node:path";
import v8 from "node:v8";
const copy = path.resolve("data", "mem-cycle.json");
fs.copyFileSync(path.resolve("data", "store.json"), copy);
const { setStore, FileStore } = await import("../server/db/store.js");
setStore(new FileStore(copy));
const { indexSize } = await import("../server/search/index.js");
await indexSize();
const { runDiscovery } = await import("../server/jobs/discovery.js");
const limit = v8.getHeapStatistics().heap_size_limit / 1048576;
let peak = 0, peakRss = 0, peakLive = 0;
const t = setInterval(() => { const m = process.memoryUsage(); peak = Math.max(peak, m.heapUsed / 1048576); peakRss = Math.max(peakRss, m.rss / 1048576); }, 200);
const live = setInterval(() => { (globalThis as { gc?: () => void }).gc?.(); peakLive = Math.max(peakLive, process.memoryUsage().heapUsed / 1048576); }, 4000);
const t0 = Date.now();
console.log(`heap limit ${Math.round(limit)} MB; starting a full cycle…`);
const report = await runDiscovery({ trigger: "manual" });
clearInterval(t); clearInterval(live);
console.log(`cycle finished in ${Math.round((Date.now() - t0) / 1000)} s: ${report.newJobIds.length} new, ${report.touchedJobIds.length} touched; peak heap ${Math.round(peak)} MB, peak LIVE heap (after forced collection) ${Math.round(peakLive)} MB, limit ${Math.round(limit)} MB, peak rss ${Math.round(peakRss)} MB`);
for (const c of report.connectors) console.log(`  ${c.id.padEnd(16)} fetched ${String(c.fetched).padStart(5)}  ${c.error ? "ERROR: " + c.error : ""}`);
fs.rmSync(copy, { force: true });
process.exit(0);
