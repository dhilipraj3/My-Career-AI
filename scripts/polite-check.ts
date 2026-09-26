// Does a big job import slow down people using the app? Runs the import twice (old behaviour, new behaviour) while a
// "user" keeps asking for their profile, and compares how long those requests wait. npx tsx scripts/polite-check.ts
process.env.DEV_AUTH_BYPASS = "true";
process.env.DISCOVERY_INTERVAL_MINUTES = "0";
import path from "node:path";
import fs from "node:fs";
const { createApp } = await import("../server/app.js");
const { setStore, FileStore } = await import("../server/db/store.js");
const { runDiscovery, setConnectors } = await import("../server/jobs/discovery.js");
const { setPolite } = await import("../server/busy.js");
const { rawJob, fakeConnector } = await import("../tests/fixtures.js");
const file = path.resolve("data", "polite-check.json");
const app = createApp();
const server = await new Promise<import("node:http").Server>((r) => { const s = app.listen(3390, () => r(s)); });
const H = { Authorization: "Bearer dev:demo" };
const pct = (a: number[], p: number) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
async function trial(polite: boolean) {
  fs.rmSync(file, { force: true }); setStore(new FileStore(file)); setPolite(polite);
  const raws = Array.from({ length: 600 }, (_, i) => rawJob({ sourceJobId: `p${i}`, company: `Company ${i % 300} Technologies Pvt Ltd`, title: `Program Manager ${i}`, url: `https://x.example/${i}`, applyUrl: `https://x.example/${i}` }));
  setConnectors([fakeConnector("demo", raws)]);
  let stop = false; const waits: number[] = [];
  const user = (async () => { await new Promise((r) => setTimeout(r, 300)); while (!stop) { const t = performance.now(); await fetch("http://127.0.0.1:3390/api/me", { headers: H }).then((r) => r.arrayBuffer()); waits.push(performance.now() - t); await new Promise((r) => setTimeout(r, 40)); } })();
  const t0 = performance.now(); await runDiscovery(); const took = performance.now() - t0; stop = true; await user;
  return { took: Math.round(took), n: waits.length, p50: Math.round(pct(waits, 0.5)), p95: Math.round(pct(waits, 0.95)), max: Math.round(Math.max(...waits)) };
}
const before = await trial(false), after = await trial(true);
console.log("import of 600 jobs while someone is clicking around");
console.log("  old:", JSON.stringify(before));
console.log("  new:", JSON.stringify(after));
server.close(); fs.rmSync(file, { force: true }); process.exit(0);
