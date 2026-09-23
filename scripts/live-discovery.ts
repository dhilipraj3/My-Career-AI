// Runs real discovery against the live public sources into an in-memory store and prints data-quality stats.
// Usage: npx tsx scripts/live-discovery.ts
import type { Job } from "../shared/types.js";
import { FileStore, getStore, setStore } from "../server/db/store.js";
import { listConnectorHealth, runDiscovery } from "../server/jobs/discovery.js";

setStore(new FileStore());
const report = await runDiscovery({ keywords: ["project manager", "software engineer"] });
console.log("\nPer connector:");
for (const c of report.connectors) console.log(`  ${c.id.padEnd(16)} fetched=${String(c.fetched).padStart(4)} kept=${String(c.fetched - c.regionFiltered).padStart(4)} inserted=${String(c.inserted).padStart(4)} merged=${String(c.merged).padStart(3)} rejected=${String(c.rejected).padStart(3)} ${c.durationMs}ms ${c.error ? "ERROR " + c.error : ""}`);

const jobs = await (await getStore()).query<Job>("jobs");
const pct = (n: number) => `${Math.round((n / Math.max(1, jobs.length)) * 100)}%`;
console.log(`\nTotal canonical jobs: ${jobs.length}`);
console.log(`  India city known : ${pct(jobs.filter((j) => j.country === "India" && j.city).length)}`);
console.log(`  Remote           : ${pct(jobs.filter((j) => j.workMode === "remote").length)}`);
console.log(`  Skills extracted : ${pct(jobs.filter((j) => j.skills.length > 0).length)}`);
console.log(`  Experience parsed: ${pct(jobs.filter((j) => j.experienceMin !== undefined).length)}`);
console.log(`  Salary disclosed : ${pct(jobs.filter((j) => j.salaryMinLPA !== undefined).length)}`);
console.log(`  Suspicious       : ${jobs.filter((j) => j.quality.suspicious).length}`);
console.log(`  Multi-source     : ${jobs.filter((j) => j.sources.length > 1).length}`);
console.log("\nSample:");
for (const j of jobs.slice(0, 6)) console.log(`  - ${j.title} @ ${j.company} | ${j.city || j.location} | ${j.workMode} | exp ${j.experienceMin ?? "?"} | ${j.skills.slice(0, 5).join(",")} | ${j.status}`);
console.log("\nHealth:", (await listConnectorHealth()).map((h) => `${h.id}:${h.status}`).join(" "));
