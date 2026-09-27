// How much memory does the app's data take? Loads a copy of the local data and the search index, and reports the heap
// after each step. Run with the same heap limit as the small server: node --max-old-space-size=307 --import tsx scripts/mem-check.ts
process.env.DISCOVERY_INTERVAL_MINUTES = "0";
import fs from "node:fs";
import path from "node:path";
const mb = () => { global.gc?.(); return Math.round(process.memoryUsage().heapUsed / 1048576); };
const copy = path.resolve("data", "mem-copy.json");
fs.copyFileSync(path.resolve("data", "store.json"), copy);
console.log("start                     ", mb(), "MB");
const { setStore, FileStore, getStore } = await import("../server/db/store.js");
setStore(new FileStore(copy));
const store = await getStore();
console.log("store loaded              ", mb(), "MB");
const { indexSize } = await import("../server/search/index.js");
console.log("search index ready        ", await indexSize(), "jobs,", mb(), "MB");
const jobs = await store.query<any>("jobs", { readOnly: true });
const desc = jobs.reduce((n: number, j: any) => n + (j.description?.length || 0), 0);
console.log("job descriptions total    ", Math.round(desc / 1048576), "MB of text in", jobs.length, "jobs");
console.log("rss                       ", Math.round(process.memoryUsage().rss / 1048576), "MB");
fs.rmSync(copy, { force: true });
process.exit(0);
