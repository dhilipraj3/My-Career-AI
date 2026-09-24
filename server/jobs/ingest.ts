import type { Job } from "../../shared/types.js";
import { getStore } from "../db/store.js";
import { jaccard, overlap, shingles } from "../nlp/text.js";
import { titleSimilarity } from "../nlp/skills.js";
import { syncJobs } from "../search/index.js";
import { assessQuality, computeFreshness, isRejected, normalizeRaw, sha, type RawJob } from "./normalize.js";

export interface IngestStats {
  received: number;
  inserted: number;
  merged: number; // duplicates folded into an existing canonical job
  rejected: number;
  rejectReasons: Record<string, number>;
  jobIds: string[]; // canonical ids touched (new or updated)
  newJobIds: string[];
}

/**
 * Decides whether two normalised jobs are the same opportunity (scope §19).
 *  - same source posting            -> same
 *  - same apply URL                 -> same
 *  - repeat requisition from the SAME source (different id): only if the text is (nearly) identical, otherwise
 *    they are distinct openings (e.g. different teams sharing a title)
 *  - cross-source                   -> similar title + (similar text, or same dedupe key with partial/snippet text)
 */
export function sameOpportunity(a: Job, b: Job): boolean {
  if (a.companyKey !== b.companyKey) return false;
  if (a.sources.some((s) => b.sources.some((t) => t.connector === s.connector && t.sourceJobId === s.sourceJobId))) return true;
  const urls = new Set(a.sources.map((s) => s.applyUrl).filter(Boolean));
  if (b.sources.some((s) => s.applyUrl && urls.has(s.applyUrl))) return true;

  const citiesOf = (j: Job) => new Set((j.cities?.length ? j.cities : [j.city]).filter(Boolean));
  const ca = citiesOf(a);
  const sameWhere = (a.workMode === "remote" && b.workMode === "remote") || [...citiesOf(b)].some((c) => ca.has(c)) || (Boolean(a.panIndia) && Boolean(b.panIndia));
  if (!sameWhere) return false;

  // Cheap title check first: text shingling is the expensive part, so only pay for it on plausible pairs.
  const titleSim = titleSimilarity(a.title, b.title);
  const incomingConnectors = new Set(b.sources.map((s) => s.connector));
  const repeatFromSameSource = a.sources.some((s) => incomingConnectors.has(s.connector));
  if (repeatFromSameSource) return titleSim >= 0.9 && jaccard(shinglesOf(a), shinglesOf(b)) >= 0.9;

  if (titleSim < 0.6) return false;
  const o = overlap(shinglesOf(a), shinglesOf(b)); // overlap coefficient tolerates a truncated aggregator snippet vs a full posting
  return o >= 0.6 || (a.dedupeKey === b.dedupeKey && o >= 0.3);
}

const shingleCache = new WeakMap<Job, Set<string>>();
function shinglesOf(j: Job): Set<string> {
  let s = shingleCache.get(j);
  if (!s) shingleCache.set(j, (s = shingles(j.description)));
  return s;
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export function mergeJobs(existing: Job, incoming: Job): Job {
  const sources = [...existing.sources];
  for (const s of incoming.sources) {
    const i = sources.findIndex((x) => x.connector === s.connector && x.sourceJobId === s.sourceJobId);
    if (i >= 0) sources[i] = { ...sources[i], ...s };
    else sources.push(s);
  }
  const merged: Job = {
    ...existing,
    // Older jobs were stored before title clean-up; take the cleaned title when the stored one still has raw codes.
    ...(existing.title.includes("_") && !incoming.title.includes("_") ? { title: incoming.title, normalizedTitle: incoming.normalizedTitle } : {}),
    sources,
    description: incoming.description.length > existing.description.length ? incoming.description : existing.description,
    postedAt: [existing.postedAt, incoming.postedAt].filter(Boolean).sort()[0],
    updatedAtSource: [existing.updatedAtSource, incoming.updatedAtSource].filter(Boolean).sort().pop(),
    lastVerifiedAt: incoming.lastVerifiedAt,
    deadline: incoming.deadline || existing.deadline,
    salaryMinLPA: existing.salaryMinLPA ?? incoming.salaryMinLPA,
    salaryMaxLPA: existing.salaryMaxLPA ?? incoming.salaryMaxLPA,
    salaryPeriod: existing.salaryMinLPA !== undefined ? existing.salaryPeriod : incoming.salaryPeriod,
    salaryDisplay: existing.salaryMinLPA !== undefined ? existing.salaryDisplay : incoming.salaryDisplay,
    cities: [...new Set([...(existing.cities || []), ...(incoming.cities || [])])].filter(Boolean),
    panIndia: existing.panIndia || incoming.panIndia,
    education: existing.education ?? incoming.education,
    freshersWelcome: existing.freshersWelcome || incoming.freshersWelcome,
    category: existing.category && existing.category !== "other" ? existing.category : incoming.category,
    experienceMin: existing.experienceMin ?? incoming.experienceMin,
    experienceMax: existing.experienceMax ?? incoming.experienceMax,
    skills: [...new Set([...existing.skills, ...incoming.skills])],
    companyUrl: existing.companyUrl || incoming.companyUrl,
    industry: existing.industry || incoming.industry,
  };
  // If the description materially changed, cached AI analysis may be stale.
  if (merged.description !== existing.description) delete merged.intelligence;
  merged.quality = assessQuality(merged);
  // Being seen again means the posting is live: a job closed earlier (e.g. briefly unlisted) reopens.
  merged.status = computeFreshness({ ...merged, status: existing.status === "closed" ? "active" : existing.status });
  return merged;
}

// Connectors run in parallel, but the read→dedupe→write step must not interleave or two sources
// reporting the same job would each insert and one would overwrite the other's source reference.
let ingestLock: Promise<unknown> = Promise.resolve();

export function ingestRawJobs(raws: RawJob[], opts: { ownerUid?: string } = {}): Promise<IngestStats> {
  const run = () => ingestRawJobsUnlocked(raws, opts);
  const p = ingestLock.then(run, run);
  ingestLock = p.catch(() => undefined);
  return p;
}

async function ingestRawJobsUnlocked(raws: RawJob[], opts: { ownerUid?: string }): Promise<IngestStats> {
  const store = await getStore();
  const stats: IngestStats = { received: raws.length, inserted: 0, merged: 0, rejected: 0, rejectReasons: {}, jobIds: [], newJobIds: [] };
  const touched = new Set<string>();
  const byCompany = new Map<string, Job[]>(); // per-call cache: one store query per company

  const candidates = async (companyKey: string) => {
    let list = byCompany.get(companyKey);
    if (!list) {
      list = (await store.query<Job>("jobs", { where: { companyKey } })).filter((j) => !j.ownerUid);
      byCompany.set(companyKey, list);
    }
    return list;
  };

  let processed = 0;
  for (const raw of raws) {
    // Ingest is CPU-bound; yield regularly so the API keeps serving requests while discovery runs.
    if (++processed % 15 === 0) await tick();
    const n = normalizeRaw(raw);
    if (isRejected(n)) {
      stats.rejected++;
      stats.rejectReasons[n.reason] = (stats.rejectReasons[n.reason] || 0) + 1;
      continue;
    }
    let incoming = n.job;
    let target: Job | null = null;

    if (opts.ownerUid) {
      // User-provided jobs are private: never merged with the shared pool.
      incoming = { ...incoming, id: `job_u_${sha(opts.ownerUid + incoming.dedupeKey, 16)}`, ownerUid: opts.ownerUid, userProvided: true };
      target = await store.get<Job>("jobs", incoming.id);
    } else {
      const pool = await candidates(incoming.companyKey);
      target = pool.find((c) => sameOpportunity(c, incoming)) || null;
    }

    if (target) {
      const merged = mergeJobs(target, incoming);
      await store.put("jobs", merged.id, merged);
      if (!opts.ownerUid) {
        const pool = await candidates(incoming.companyKey);
        pool[pool.findIndex((c) => c.id === merged.id)] = merged;
      }
      stats.merged++;
      if (!touched.has(merged.id)) { touched.add(merged.id); stats.jobIds.push(merged.id); }
    } else {
      incoming.status = computeFreshness(incoming);
      await store.put("jobs", incoming.id, incoming);
      if (!opts.ownerUid) (await candidates(incoming.companyKey)).push(incoming);
      stats.inserted++;
      touched.add(incoming.id);
      stats.jobIds.push(incoming.id);
      stats.newJobIds.push(incoming.id);
    }
  }
  await syncJobs(stats.jobIds).catch((e) => console.warn("[search] index sync failed", e));
  return stats;
}

/** Recompute freshness for every job; returns how many changed state. Run on a schedule. */
export async function refreshFreshness(): Promise<number> {
  const store = await getStore();
  const jobs = await store.query<Job>("jobs", { readOnly: true });
  const changed: string[] = [];
  for (const j of jobs) {
    const s = computeFreshness(j);
    if (s !== j.status) {
      await store.update<Job>("jobs", j.id, { status: s });
      changed.push(j.id);
    }
  }
  await syncJobs(changed).catch((e) => console.warn("[search] index sync failed", e));
  await pruneDeadJobs().catch((e) => console.warn("[jobs] prune failed", e));
  return changed.length;
}

/**
 * Forget closed/expired jobs no source has listed for 45 days, unless someone applied to or saved them (their history
 * must keep working). Keeps the job pool — and the server's memory — from growing forever.
 */
export async function pruneDeadJobs(olderThanDays = 45): Promise<number> {
  const store = await getStore();
  const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
  const keep = new Set<string>();
  for (const a of await store.query<{ jobId: string }>("applications", { readOnly: true })) keep.add(a.jobId);
  for (const m of await store.query<{ jobId: string; saved?: boolean }>("matches", { where: { saved: true }, readOnly: true })) keep.add(m.jobId);
  const dead = (await store.query<Job>("jobs", { readOnly: true }))
    .filter((j) => (j.status === "closed" || j.status === "expired") && !j.ownerUid && !keep.has(j.id) && (j.lastVerifiedAt || "") < cutoff)
    .map((j) => j.id);
  if (!dead.length) return 0;
  const gone = new Set(dead);
  for (const id of dead) await store.del("jobs", id);
  for (const m of await store.query<{ id: string; jobId: string }>("matches", { readOnly: true })) if (gone.has(m.jobId)) await store.del("matches", m.id);
  await syncJobs(dead);
  console.log(`[jobs] pruned ${dead.length} jobs not seen for ${olderThanDays}+ days`);
  return dead.length;
}
