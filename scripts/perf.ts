// Times the main API calls against a copy of the local data (jobs, matches, a real profile). No background jobs run.
// Run: npx tsx scripts/perf.ts [uid]      Prints slowest first; anything over 150 ms is worth a look.
process.env.DEV_AUTH_BYPASS = "true";
process.env.DISCOVERY_INTERVAL_MINUTES = "0";
import fs from "node:fs";
import path from "node:path";
const { createApp } = await import("../server/app.js");
const { setStore, FileStore } = await import("../server/db/store.js");
const copy = path.resolve("data", "perf-copy.json");
fs.copyFileSync(path.resolve("data", "store.json"), copy);
setStore(new FileStore(copy));
const uid = process.argv[2] || "yTR8Z4FwoYNeFHDdJwGllXEGrSI3";
const app = createApp();
const server = await new Promise<import("node:http").Server>((r) => { const s = app.listen(3392, () => r(s)); });
const base = "http://127.0.0.1:3392/api";
const H = { Authorization: `Bearer dev:${uid}`, "Content-Type": "application/json" };
const rows: Array<[string, number, number, number]> = [];
async function time(label: string, p: string, init?: RequestInit) {
  const runs: number[] = []; let size = 0, status = 0;
  for (let i = 0; i < 3; i++) { const t = performance.now(); const r = await fetch(base + p, { headers: H, ...init }); const b = await r.arrayBuffer(); runs.push(performance.now() - t); size = b.byteLength; status = r.status; }
  rows.push([`${label} (${status})`, Math.round(runs[0]), Math.round(Math.min(...runs.slice(1))), size]);
}
const me = await (await fetch(`${base}/me`, { headers: H })).json() as any;
const feed = await (await fetch(`${base}/feed?limit=1`, { headers: H })).json() as any;
const jobId = feed.items?.[0]?.job?.id || feed[0]?.job?.id;
await time("me", "/me");
await time("feed/summary", "/feed/summary");
await time("feed", "/feed");
await time("jobs/search (all)", "/jobs/search?pageSize=20");
await time("jobs/search city+text", "/jobs/search?q=manager&cities=Chennai&pageSize=20");
await time("jobs/search matchedOnly", "/jobs/search?matchedOnly=true&minScore=50&pageSize=20&sort=match");
await time("jobs/suggest", "/jobs/suggest?q=man");
if (jobId) { await time("job detail", `/jobs/${jobId}`); await time("job related", `/jobs/${jobId}/related`); }
await time("applications", "/applications");
await time("career/understanding", "/career/understanding");
await time("career/journey", "/career/journey");
await time("career/resume", "/career/resume");
await time("resumes", "/resumes");
await time("notifications", "/notifications");
await time("insights", "/insights").catch(() => undefined);
await time("assistant/briefing", "/assistant/briefing").catch(() => undefined);
await time("voice/status", "/voice/status");
console.log(`user ${uid.slice(0, 8)}…  profile: ${me.profile?.status}  matches feed items: ${(feed.items || feed).length}`);
console.log("call".padEnd(34), "first".padStart(7), "next".padStart(7), "size".padStart(9));
for (const [l, a, b, s] of rows.sort((x, y) => y[1] - x[1])) console.log(l.padEnd(34), `${a}ms`.padStart(7), `${b}ms`.padStart(7), `${(s / 1024).toFixed(1)}KB`.padStart(9));
server.close(); fs.rmSync(copy, { force: true });
process.exit(0);
