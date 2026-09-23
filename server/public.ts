// Public, signed-out endpoints for the landing page: live stats and a small "try it" search.
// They expose only what any job board shows publicly — never descriptions, match data or anything about users.
import type { ConnectorHealth, Job, JobSearchHit } from "../shared/types.js";
import { getStore } from "./db/store.js";
import { listCompanies } from "./jobs/registry.js";
import { RECOMMENDABLE } from "./jobs/normalize.js";
import { searchJobs } from "./search/index.js";

export interface PublicStats {
  liveJobs: number;
  companies: number;
  cities: number;
  sources: number;
  freshersJobs: number;
  remoteJobs: number;
  updatedAt?: string;
  topCities: Array<{ city: string; jobs: number }>;
}

let cache: { at: number; stats: PublicStats } | null = null;

/** Cached for five minutes: the landing page is the most visited page and these numbers change slowly. */
export async function publicStats(): Promise<PublicStats> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.stats;
  const store = await getStore();
  const jobs = (await store.query<Job>("jobs")).filter((j) => !j.ownerUid && RECOMMENDABLE.includes(j.status) && !j.quality.suspicious);
  const cityCount = new Map<string, number>();
  for (const j of jobs) for (const c of j.cities?.length ? j.cities : j.city ? [j.city] : []) cityCount.set(c, (cityCount.get(c) || 0) + 1);
  const health = await store.query<ConnectorHealth>("connectors");
  const stats: PublicStats = {
    liveJobs: jobs.length,
    companies: new Set(jobs.map((j) => j.companyKey)).size,
    cities: [...cityCount.keys()].filter((c) => (cityCount.get(c) || 0) > 0).length,
    sources: health.filter((h) => h.lastSuccessAt).length,
    freshersJobs: jobs.filter((j) => j.freshersWelcome).length,
    remoteJobs: jobs.filter((j) => j.workMode === "remote").length,
    updatedAt: health.map((h) => h.lastSuccessAt).filter(Boolean).sort().pop(),
    topCities: [...cityCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([city, n]) => ({ city, jobs: n })),
  };
  if (!stats.companies) stats.companies = (await listCompanies()).length;
  cache = { at: Date.now(), stats };
  return stats;
}

export function _resetPublicCache() {
  cache = null;
}

export interface PublicJob {
  title: string;
  company: string;
  location: string;
  pay?: string;
  postedAt?: string;
  freshersWelcome?: boolean;
  workMode: Job["workMode"];
}

const PUBLIC_UID = "__public__";

/** A taste of the real index for visitors: top results, safe fields only. */
export async function publicSearch(q: string, city?: string): Promise<{ total: number; jobs: PublicJob[] }> {
  const r = await searchJobs(PUBLIC_UID, { q, cities: city ? [city] : undefined, sort: "relevance", pageSize: 6 });
  return {
    total: r.total,
    jobs: r.hits.map(({ job }: JobSearchHit) => ({
      title: job.title, company: job.company,
      location: job.workMode === "remote" ? "Remote" : job.panIndia ? "Pan India" : job.cities?.length ? job.cities.slice(0, 2).join(", ") : job.city || job.location,
      pay: job.salaryDisplay, postedAt: job.postedAt || job.firstSeenAt, freshersWelcome: job.freshersWelcome, workMode: job.workMode,
    })),
  };
}
