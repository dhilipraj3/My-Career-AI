// Live end-to-end check of the sourcing engine: real registry boards → normalise → dedupe → index → search.
// Usage: npx tsx scripts/live-sourcing.ts   (uses a throwaway in-memory store; nothing is persisted)
import { FileStore, setStore } from "../server/db/store.js";
import { runDiscovery } from "../server/jobs/discovery.js";
import { searchJobs, indexSize } from "../server/search/index.js";
import { getStore } from "../server/db/store.js";
import type { Job } from "../shared/types.js";

setStore(new FileStore());
const t0 = Date.now();
const report = await runDiscovery({ keywords: [] });
console.log(`Discovery finished in ${Math.round((Date.now() - t0) / 1000)}s`);
for (const c of report.connectors) console.log(`  ${c.id.padEnd(16)} fetched=${String(c.fetched).padStart(4)} new=${String(c.inserted).padStart(4)} merged=${String(c.merged).padStart(3)} rejected=${String(c.rejected).padStart(3)} nonIndia=${String(c.regionFiltered).padStart(4)} ${c.error ? `ERROR ${c.error}` : ""} (${Math.round(c.durationMs / 1000)}s)`);

const jobs = await (await getStore()).query<Job>("jobs");
const count = (f: (j: Job) => string | undefined) => Object.entries(jobs.reduce<Record<string, number>>((m, j) => { const k = f(j) || "—"; m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log(`\nJobs stored: ${jobs.length}, searchable: ${await indexSize()}, suspicious: ${jobs.filter((j) => j.quality.suspicious).length}`);
console.log("Suspicious flags:", count((j) => (j.quality.suspicious ? j.quality.flags.join("+") : undefined)).filter(([k]) => k !== "—"));
for (const j of jobs.filter((x) => x.quality.suspicious).slice(0, 8)) console.log(`  ⚑ ${j.title} | ${j.company} | ${j.quality.flags.join(", ")}`);
console.log("Top cities:", count((j) => (j.panIndia ? "Pan India" : j.workMode === "remote" ? "Remote" : j.city)));
console.log("Categories:", count((j) => j.category));
console.log("With salary:", jobs.filter((j) => j.salaryDisplay).length, "e.g.", jobs.filter((j) => j.salaryDisplay).slice(0, 3).map((j) => j.salaryDisplay));
console.log("Education stated:", count((j) => j.education));
for (const q of [{ q: "data analyst", cities: ["Bengaluru"] }, { q: "sales", freshersOnly: true }, { q: "delivery boy" }, { cities: ["Pune"], sort: "newest" as const }]) {
  const r = await searchJobs("probe", q);
  console.log(`\nSearch ${JSON.stringify(q)} → ${r.total} results${r.expandedTerms.length ? ` (also: ${r.expandedTerms.slice(0, 3).join(", ")})` : ""}`);
  for (const h of r.hits.slice(0, 3)) console.log(`  - ${h.job.title} | ${h.job.company} | ${h.job.cities?.join("/") || h.job.city || h.job.location} | ${h.job.salaryDisplay || ""}`);
}
process.exit(0);
