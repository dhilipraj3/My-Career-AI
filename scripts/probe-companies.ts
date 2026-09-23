// Verifies candidate employers against the live careers systems and writes the working ones to the seed registry.
// Usage: npm run probe:companies            (dry run: prints results)
//        npm run probe:companies -- --write (also updates server/jobs/seed/companies.json)
import fs from "node:fs";
import { fetchJson } from "../server/jobs/http.js";
import { regionOk } from "../server/jobs/discovery.js";
import { parseWorkdayBoard, parseOracleBoard } from "../server/jobs/ats.js";
import { loadSeed, type SeedCompany } from "../server/jobs/registry.js";
import type { CompanyAts } from "../shared/types.js";
import { EXACT, GUESS } from "./company-candidates.js";

type Probe = { total: number; india: number; boardName?: string };
const loc = (location: string, remote = false) => regionOk({ location, remote });

const PROBES: Partial<Record<CompanyAts, (slug: string) => Promise<Probe>>> = {
  async greenhouse(s) {
    const d = await fetchJson<any>(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`);
    const jobs = d?.jobs || [];
    const name = jobs.length ? (await fetchJson<any>(`https://boards-api.greenhouse.io/v1/boards/${s}`).catch(() => null))?.name : undefined;
    return { total: jobs.length, india: jobs.filter((j: any) => loc(j.location?.name || "")).length, boardName: name };
  },
  async lever(s) {
    const d = await fetchJson<any[]>(`https://api.lever.co/v0/postings/${s}?mode=json`);
    const jobs = Array.isArray(d) ? d : [];
    return { total: jobs.length, india: jobs.filter((j) => loc(j.categories?.location || (j.categories?.allLocations || []).join(", "), j.workplaceType === "remote")).length };
  },
  async ashby(s) {
    const d = await fetchJson<any>(`https://api.ashbyhq.com/posting-api/job-board/${s}`);
    const jobs = d?.jobs || [];
    return { total: jobs.length, india: jobs.filter((j: any) => loc([j.location, ...(j.secondaryLocations || []).map((x: any) => x.location)].join("; "), j.isRemote)).length };
  },
  async recruitee(s) {
    const d = await fetchJson<any>(`https://${s}.recruitee.com/api/offers/`);
    const jobs = d?.offers || [];
    return { total: jobs.length, india: jobs.filter((o: any) => loc([o.city, o.country].filter(Boolean).join(", "), o.remote)).length, boardName: jobs[0]?.company_name };
  },
  async workable(s) {
    const d = await fetchJson<any>(`https://apply.workable.com/api/v1/widget/accounts/${s}`);
    const jobs = d?.jobs || [];
    return { total: jobs.length, india: jobs.filter((j: any) => loc([j.city, j.country].filter(Boolean).join(", "), j.telecommuting)).length, boardName: d?.name };
  },
  async workday(board) {
    const { tenant, site, base } = parseWorkdayBoard(board);
    const d = await fetchJson<any>(`${base}/wday/cxs/${tenant}/${site}/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: "India" }) });
    const posts = d?.jobPostings || [];
    return { total: d?.total ?? posts.length, india: posts.filter((p: any) => loc(p.locationsText || "") || /\d+ locations/i.test(p.locationsText || "")).length };
  },
  async oracle(board) {
    const { host, siteNumber } = parseOracleBoard(board);
    const d = await fetchJson<any>(`https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=${siteNumber},limit=25,keyword=India`);
    const list = d?.items?.[0]?.requisitionList || [];
    return { total: d?.items?.[0]?.TotalJobsCount ?? list.length, india: list.filter((r: any) => r.PrimaryLocationCountry === "IN").length };
  },
  async teamtailor(host) {
    const d = await fetchJson<any>(`https://${host}/jobs.json`);
    const items = d?.items || [];
    const where = (i: any) => {
      const p = i._jobposting || {};
      const addr = [].concat(p.jobLocation || []).map((l: any) => [l?.address?.addressLocality, l?.address?.addressCountry].filter(Boolean).join(", ")).join("; ");
      return loc(addr, p.jobLocationType === "TELECOMMUTE");
    };
    return { total: items.length, india: items.filter(where).length, boardName: d?.title?.replace(/\s*[-–|].*$/, "") };
  },
  async smartrecruiters(s) {
    const d = await fetchJson<any>(`https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100&country=in`);
    return { total: d?.totalFound ?? 0, india: (d?.content || []).length, boardName: d?.content?.[0]?.company?.name };
  },
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Guard against a guessed slug belonging to a different company (e.g. "apna" on some unrelated board). */
const sameCompany = (candidate: string, boardName?: string) => {
  if (!boardName) return true;
  const a = norm(candidate), b = norm(boardName);
  return a.includes(b) || b.includes(a) || a.slice(0, 5) === b.slice(0, 5);
};

async function mapLimit<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

type Task = { name: string; ats: CompanyAts; board: string; industry: string };
const tasks: Task[] = [];
const seedKeys = new Set(loadSeed().map((s) => `${s.ats}|${s.board.toLowerCase()}`));
// Keys ending in a digit ("Zoho2") are de-duplication placeholders in the candidate list, not real names.
for (const [rawName, industry] of Object.entries(GUESS)) {
  if (/\d$/.test(rawName) && rawName.replace(/\d+$/, "") in GUESS) continue;
  const name = rawName.replace(/_/g, " ");
  const slugs = [...new Set([norm(name), name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")])];
  for (const ats of ["greenhouse", "lever", "ashby", "recruitee", "workable", "smartrecruiters"] as const) for (const slug of slugs) tasks.push({ name, ats, board: slug, industry });
  tasks.push({ name, ats: "teamtailor", board: `${slugs[1] || slugs[0]}.teamtailor.com`, industry });
}
// Skip boards already in the registry so re-runs only spend requests on new candidates.
for (let i = tasks.length - 1; i >= 0; i--) if (seedKeys.has(`${tasks[i].ats}|${tasks[i].board.toLowerCase()}`)) tasks.splice(i, 1);
for (const e of EXACT) tasks.push({ name: e.name.replace(/ \(SR\)$/, ""), ats: e.ats, board: e.board, industry: e.industry });

console.log(`Probing ${tasks.length} candidate boards…`);
const found: Array<Task & Probe> = [];
let done = 0;
await mapLimit(tasks, 8, async (t) => {
  try {
    const p = await PROBES[t.ats]!(t.board);
    if (p.india > 0 && sameCompany(t.name, p.boardName)) found.push({ ...t, ...p });
  } catch {
    /* not a board */
  }
  if (++done % 200 === 0) console.log(`  ${done}/${tasks.length} checked, ${found.length} working`);
});

// One board per company per ATS; prefer the one with the most India jobs.
const best = new Map<string, Task & Probe>();
for (const f of found) {
  const k = `${norm(f.name)}|${f.ats}`;
  if (!best.has(k) || best.get(k)!.india < f.india) best.set(k, f);
}
const results = [...best.values()].sort((a, b) => b.india - a.india);
console.log(`\nWorking boards with India-relevant jobs: ${results.length}`);
for (const r of results) console.log(`  ${r.ats.padEnd(16)} ${r.name.padEnd(26)} board=${r.board.padEnd(40)} india=${r.india} total=${r.total}`);

if (process.argv.includes("--write")) {
  const seed = loadSeed();
  const key = (s: SeedCompany) => `${s.ats}|${s.board.toLowerCase()}`;
  const have = new Set(seed.map(key));
  let added = 0;
  for (const r of results) {
    const s: SeedCompany = { name: r.name, ats: r.ats, board: r.board, industries: [r.industry] };
    if (!have.has(key(s))) { seed.push(s); have.add(key(s)); added++; }
  }
  seed.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(new URL("../server/jobs/seed/companies.json", import.meta.url), JSON.stringify(seed, null, 1) + "\n");
  console.log(`\nSeed updated: ${added} added, ${seed.length} total.`);
}
