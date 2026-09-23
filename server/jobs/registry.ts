// Company registry: which employers we read jobs from, via which careers system, and how each board is doing.
// Connectors rotate through it (least-recently-fetched first) so a large registry is covered over several cycles.
import fs from "node:fs";
import type { CompanyAts, CompanyRecord, Job } from "../../shared/types.js";
import { config } from "../config.js";
import { getStore, type Store } from "../db/store.js";
import { fetchCareersPage, fetchOracle, fetchRecruitee, fetchTeamtailor, fetchWorkable, fetchWorkday, parseOracleBoard, parseWorkdayBoard } from "./ats.js";
import { fetchAshbyBoard, fetchGreenhouseBoard, fetchLeverSite, fetchSmartRecruiters, type JobConnector } from "./connectors.js";
import { syncJobs } from "../search/index.js";
import { detectFromText } from "./detect.js";
import { companyKey, sha, type RawJob } from "./normalize.js";

export interface SeedCompany {
  name: string;
  ats: CompanyAts;
  board: string;
  careersUrl?: string;
  industries?: string[];
}

export const companyId = (ats: CompanyAts, board: string) => `co_${sha(`${ats}|${board.toLowerCase()}`, 16)}`;

const SEED_FILE = new URL("./seed/companies.json", import.meta.url);

export function loadSeed(): SeedCompany[] {
  try {
    return JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  } catch {
    return [];
  }
}

export function fetcherFor(ats: CompanyAts): (board: string, name?: string) => Promise<RawJob[]> {
  switch (ats) {
    case "greenhouse": return (b) => fetchGreenhouseBoard(b);
    case "lever": return (b) => fetchLeverSite(b);
    case "ashby": return (b) => fetchAshbyBoard(b);
    case "smartrecruiters": return (b) => fetchSmartRecruiters(b);
    case "workday": return fetchWorkday;
    case "oracle": return fetchOracle;
    case "recruitee": return fetchRecruitee;
    case "workable": return fetchWorkable;
    case "teamtailor": return fetchTeamtailor;
    case "careers_page": return fetchCareersPage;
  }
}

// Seed once per store instance (tests swap stores).
const seeded = new WeakMap<Store, Promise<void>>();

export function ensureSeeded(seed: SeedCompany[] = loadSeed()): Promise<void> {
  return getStore().then((store) => {
    let p = seeded.get(store);
    if (!p) {
      p = (async () => {
        for (const s of seed) {
          const id = companyId(s.ats, s.board);
          if (!(await store.get("companies", id))) await store.put("companies", id, newCompany(s, "seed"));
        }
      })();
      seeded.set(store, p);
    }
    return p;
  });
}

function newCompany(s: SeedCompany, origin: CompanyRecord["origin"]): CompanyRecord {
  const now = new Date().toISOString();
  return {
    id: companyId(s.ats, s.board), name: s.name.trim(), ats: s.ats, board: s.board.trim(), careersUrl: s.careersUrl, industries: s.industries || [],
    enabled: true, status: "unverified", origin, lastJobCount: 0, errorCount: 0, createdAt: now, updatedAt: now,
  };
}

export async function listCompanies(): Promise<CompanyRecord[]> {
  await ensureSeeded();
  const all = await (await getStore()).query<CompanyRecord>("companies");
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Self-growing coverage: look at the links of jobs we just ingested (aggregator listings, careers pages, jobs users
 * pasted) and register any company careers board we recognise but don't have yet. Returns how many were added.
 */
export async function autoDiscoverBoards(jobIds: string[], limit = 50): Promise<number> {
  if (!jobIds.length) return 0;
  await ensureSeeded();
  const store = await getStore();
  const seen = new Set<string>();
  let added = 0;
  for (const id of jobIds) {
    const job = await store.get<Job>("jobs", id);
    if (!job) continue;
    for (const s of job.sources) {
      for (const url of [s.applyUrl, s.sourceUrl]) {
        const d = url ? detectFromText(url) : null;
        if (!d?.ats || boardProblem(d.ats, d.board)) continue;
        const cid = companyId(d.ats, d.board);
        if (seen.has(cid)) continue;
        seen.add(cid);
        if (await store.get("companies", cid)) continue;
        await store.put("companies", cid, newCompany({ name: job.company, ats: d.ats, board: d.board }, "auto"));
        added++;
        if (added >= limit) return added;
      }
    }
  }
  if (added) console.log(`[registry] discovered ${added} new company board(s) from job links`);
  return added;
}

/** Returns a human-readable problem with a board id, or null if it's well-formed for its ATS. */
export function boardProblem(ats: CompanyAts, board: string): string | null {
  try {
    if (ats === "workday") parseWorkdayBoard(board);
    else if (ats === "oracle") parseOracleBoard(board);
    else if (ats === "careers_page") {
      if (!/^https?:$/.test(new URL(board).protocol)) return "Careers page must be an http(s) URL";
    } else if (!/^[\w.-]{1,100}$/.test(board)) return `Invalid ${ats} board id`;
    return null;
  } catch (e: any) {
    return String(e?.message || "Invalid board");
  }
}

export async function addCompany(s: SeedCompany): Promise<{ company: CompanyRecord; created: boolean }> {
  await ensureSeeded();
  const store = await getStore();
  const id = companyId(s.ats, s.board);
  const existing = await store.get<CompanyRecord>("companies", id);
  if (existing) return { company: existing, created: false };
  const company = newCompany(s, "admin");
  await store.put("companies", id, company);
  return { company, created: true };
}

export async function updateCompany(id: string, patch: Partial<Pick<CompanyRecord, "enabled" | "name" | "industries">>): Promise<CompanyRecord | null> {
  return (await getStore()).update<CompanyRecord>("companies", id, { ...patch, updatedAt: new Date().toISOString() });
}

export async function removeCompany(id: string): Promise<void> {
  await (await getStore()).del("companies", id);
}

// Workday and Oracle need one request per job for details, so they rotate through fewer boards per cycle.
const HEAVY: CompanyAts[] = ["workday", "oracle", "careers_page"];

/** Next boards to fetch for one ATS: enabled, not dead, never-fetched first, then least recently fetched. */
export async function pickBoards(ats: CompanyAts, n = HEAVY.includes(ats) ? Math.max(1, Math.round(config.sources.boardsPerRun / 4)) : config.sources.boardsPerRun): Promise<CompanyRecord[]> {
  await ensureSeeded();
  const all = await (await getStore()).query<CompanyRecord>("companies", { where: { ats } });
  return all
    .filter((c) => c.enabled && c.status !== "dead")
    // Boards that failed last time go first (a network blip shouldn't cost them a whole rotation), then never-fetched, then oldest.
    .sort((a, b) => Number(Boolean(b.lastError)) - Number(Boolean(a.lastError)) || (a.lastFetchedAt || "").localeCompare(b.lastFetchedAt || ""))
    .slice(0, n);
}

/** Systems whose fetch returns the company's COMPLETE board, so a missing posting really has closed. */
const COMPLETE_BOARDS: CompanyAts[] = ["greenhouse", "lever", "ashby", "recruitee", "workable", "teamtailor"];

/**
 * After a successful full-board fetch: any job we hold from this board that the board no longer lists has closed.
 * Drops that source; a job with no sources left is marked closed (kept for users' application history).
 */
export async function closeMissing(c: CompanyRecord, fetched: RawJob[]): Promise<number> {
  if (!COMPLETE_BOARDS.includes(c.ats)) return 0;
  const store = await getStore();
  const live = new Set(fetched.map((j) => String(j.sourceJobId)));
  const jobs = (await store.query<Job>("jobs", { where: { companyKey: companyKey(c.name) } })).filter((j) => !j.ownerUid && j.status !== "closed");
  // An empty answer from a board that had several live jobs is more likely an API glitch than a mass closure.
  if (!fetched.length && jobs.filter((j) => j.sources.some((s) => s.connector === c.ats)).length > 3) return 0;
  let closed = 0;
  const touched: string[] = [];
  for (const j of jobs) {
    if (j.ownerUid) continue;
    const mine = j.sources.filter((s) => s.connector === c.ats);
    const gone = mine.filter((s) => !live.has(s.sourceJobId));
    if (!gone.length) continue;
    const sources = j.sources.filter((s) => !gone.includes(s));
    touched.push(j.id);
    if (sources.length) await store.update<Job>("jobs", j.id, { sources });
    else {
      await store.update<Job>("jobs", j.id, { status: "closed" });
      closed++;
    }
  }
  await syncJobs(touched);
  return closed;
}

/** Fetch one company's jobs and record how the board did. Never throws. */
export async function fetchCompany(c: CompanyRecord, fetcher = fetcherFor(c.ats)): Promise<{ jobs: RawJob[]; error?: string }> {
  const store = await getStore();
  const now = new Date().toISOString();
  try {
    const jobs = (await fetcher(c.board, c.name)).map((j) =>
      // The registry name is curated; ATS slugs ("mindtickle") are not. Careers pages keep their own hiringOrganization.
      c.ats === "careers_page" && j.company ? j : { ...j, company: c.name, sourceName: j.sourceName.replace(/·.*$/, `· ${c.name}`) },
    );
    await store.update<CompanyRecord>("companies", c.id, { lastFetchedAt: now, lastJobCount: jobs.length, lastError: undefined, errorCount: 0, status: jobs.length ? "active" : "empty", updatedAt: now });
    await closeMissing(c, jobs).catch((e) => console.warn(`[registry] close check failed for ${c.name}`, e));
    return { jobs };
  } catch (err: any) {
    const error = String(err?.message || err).slice(0, 200);
    const errorCount = c.errorCount + 1;
    // A board that 404s three cycles running has moved or closed; stop spending requests on it.
    const dead = errorCount >= 3 && /HTTP 404|HTTP 410|Invalid .* board|robots\.txt/i.test(error);
    await store.update<CompanyRecord>("companies", c.id, { lastFetchedAt: now, lastError: error, errorCount, status: dead ? "dead" : c.status, updatedAt: now });
    return { jobs: [], error };
  }
}

const LABELS: Record<CompanyAts, { name: string; access: string; terms: string }> = {
  greenhouse: { name: "Greenhouse company boards", access: "Public Job Board API", terms: "Documented public API for published jobs" },
  lever: { name: "Lever company boards", access: "Public Postings API", terms: "Documented public API for published jobs" },
  ashby: { name: "Ashby company boards", access: "Public Job Posting API", terms: "Documented public API for published jobs" },
  smartrecruiters: { name: "SmartRecruiters boards", access: "Public Posting API", terms: "Documented public API for published jobs" },
  workday: { name: "Workday careers sites", access: "Public careers-site JSON used by the employer's own job search", terms: "Published jobs on the employer's public careers site" },
  oracle: { name: "Oracle Recruiting careers sites", access: "Public Candidate Experience REST API", terms: "Published jobs on the employer's public careers site" },
  recruitee: { name: "Recruitee company boards", access: "Public Offers API", terms: "Documented public API for published jobs" },
  workable: { name: "Workable company boards", access: "Public widget API", terms: "Documented public API for published jobs" },
  teamtailor: { name: "Teamtailor company boards", access: "Public jobs feed", terms: "Public feed of published jobs" },
  careers_page: { name: "Company careers pages", access: "schema.org JobPosting data on public pages (robots.txt respected)", terms: "Structured data employers publish for search engines" },
};

/** One connector per ATS, backed by the registry. Fails only if every board it tried failed. */
export function registryConnector(ats: CompanyAts): JobConnector {
  const l = LABELS[ats];
  return {
    id: ats, name: l.name, kind: ats === "careers_page" ? "company_pages" : "ats", access: l.access, terms: l.terms,
    timeoutMs: config.sources.registryTimeoutMs,
    isConfigured: () => true,
    async fetch() {
      const boards = await pickBoards(ats);
      const results = await Promise.all(boards.map((b) => fetchCompany(b)));
      if (boards.length && results.every((r) => r.error)) throw new Error(`All ${boards.length} boards failed; first: ${results[0].error}`);
      return results.flatMap((r) => r.jobs);
    },
  };
}

export const REGISTRY_ATS: CompanyAts[] = ["greenhouse", "lever", "ashby", "smartrecruiters", "workday", "oracle", "recruitee", "workable", "teamtailor", "careers_page"];
