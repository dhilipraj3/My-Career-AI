// Job search: an in-process Orama index over live jobs, kept in sync with the store.
// Behind a small interface so it can move to Typesense/Meilisearch when volume demands.
import { count, create, insertMultiple, remove, search, type AnyOrama } from "@orama/orama";
import type { EducationLevel, Job, JobMatch, JobQuery, JobSearchResult } from "../../shared/types.js";
import { getStore, type Store } from "../db/store.js";
import { educationRank } from "../jobs/classify.js";
import { RECOMMENDABLE, companyKey } from "../jobs/normalize.js";
import { expandQuery } from "./synonyms.js";

const SCHEMA = {
  id: "string",
  title: "string",
  company: "string",
  skills: "string",
  body: "string", // first part of the description; enough for relevance without bloating memory
  owner: "enum", // "public" or the uid of a user-provided job
  cities: "enum[]",
  anywhere: "boolean", // remote or Pan-India
  category: "enum",
  workMode: "enum",
  employmentType: "enum",
  companyKey: "enum",
  eduRank: "number", // -1 = not stated
  expMin: "number", // -1 = not stated
  salaryMax: "number", // -1 = not disclosed
  posted: "number", // epoch ms
  freshers: "boolean",
} as const;

type Doc = { [K in keyof typeof SCHEMA]: any };

// Titles, companies and skills are indexed in full; a short slice of the description is enough for relevance and
// keeps the index small (the full text made the index the largest thing in memory).
const BODY_CHARS = 500;

function toDoc(j: Job): Doc {
  return {
    id: j.id, title: j.title, company: j.company, skills: j.skills.join(" ").replace(/_/g, " "), body: j.description.slice(0, BODY_CHARS),
    owner: j.ownerUid || "public", cities: j.cities?.length ? j.cities : j.city ? [j.city] : [], anywhere: j.workMode === "remote" || Boolean(j.panIndia),
    category: j.category || "other", workMode: j.workMode, employmentType: j.employmentType, companyKey: j.companyKey,
    eduRank: educationRank(j.education), expMin: j.experienceMin ?? -1, salaryMax: j.salaryMaxLPA ?? -1,
    posted: new Date(j.postedAt || j.firstSeenAt).getTime() || 0, freshers: Boolean(j.freshersWelcome),
  };
}

const searchable = (j: Job | null): j is Job => Boolean(j && RECOMMENDABLE.includes(j.status) && !j.quality.suspicious);

interface Index {
  db: AnyOrama;
  ids: Set<string>;
}

// One index per store instance (tests swap stores).
const indexes = new WeakMap<Store, Promise<Index>>();

async function getIndex(): Promise<Index> {
  const store = await getStore();
  let p = indexes.get(store);
  if (!p) {
    p = (async () => {
      const db = create({ schema: SCHEMA, components: { tokenizer: { stemming: false } } });
      const jobs = (await store.query<Job>("jobs", { readOnly: true })).filter(searchable);
      await insertMultiple(db, jobs.map(toDoc), 500);
      return { db, ids: new Set(jobs.map((j) => j.id)) };
    })();
    indexes.set(store, p);
  }
  return p;
}

/** Re-read these jobs from the store and bring the index in line (insert, replace or drop). */
export async function syncJobs(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const store = await getStore();
  const idx = await getIndex();
  for (const id of new Set(ids)) {
    if (idx.ids.has(id)) {
      await remove(idx.db, id);
      idx.ids.delete(id);
    }
    const j = await store.get<Job>("jobs", id);
    if (searchable(j)) {
      await insertMultiple(idx.db, [toDoc(j)]);
      idx.ids.add(id);
    }
  }
}

/** Ids of every live, searchable job (a cheap stand-in for loading them all from the store). */
export async function liveJobIds(): Promise<Set<string>> {
  return new Set((await getIndex()).ids);
}

export async function indexSize(): Promise<number> {
  return count((await getIndex()).db);
}

const DAY = 86400000;
const EDU_ORDER: EducationLevel[] = ["none", "10th", "12th", "iti", "diploma", "graduate", "postgraduate"];

function whereFor(uid: string, q: JobQuery): Record<string, unknown> {
  const w: Record<string, unknown> = { owner: { in: ["public", uid] } };
  if (q.workModes?.length) w.workMode = { in: q.workModes };
  if (q.employmentTypes?.length) w.employmentType = { in: q.employmentTypes };
  if (q.categories?.length) w.category = { in: q.categories };
  if (q.companies?.length) w.companyKey = { in: q.companies.map(companyKey) };
  if (q.experienceYears !== undefined) w.expMin = { lte: q.experienceYears };
  if (q.minSalaryLPA) w.salaryMax = { gte: q.minSalaryLPA };
  if (q.maxEducation) w.eduRank = { lte: EDU_ORDER.indexOf(q.maxEducation) };
  if (q.freshersOnly) w.freshers = true;
  if (q.postedWithinDays) w.posted = { gte: Date.now() - q.postedWithinDays * DAY };
  return w;
}

const bump = (m: Record<string, number>, k: string) => { if (k) m[k] = (m[k] || 0) + 1; };
const wordsOf = (s: string) => s.toLowerCase().split(/[^a-z0-9+#]+/).filter(Boolean);

/**
 * Full job search for one user. Filters run in the index; the city filter and personal-match blending run here because
 * "Pune" should also include remote and Pan-India jobs, which a plain enum filter can't express.
 */
export async function searchJobs(uid: string, q: JobQuery): Promise<JobSearchResult> {
  const idx = await getIndex();
  const store = await getStore();
  const page = Math.max(1, q.page || 1);
  const pageSize = Math.min(50, Math.max(1, q.pageSize || 20));
  const original = (q.q || "").trim().toLowerCase().replace(/\s+/g, " ");
  const { expanded } = expandQuery(original);
  const where = whereFor(uid, q) as any;
  // Every candidate must be considered: personal filters (excellent, saved) run after retrieval, so a cap here
  // silently drops matches that happen to sit past it.
  const all = Math.max(1, idx.ids.size);

  // Relevance per document: the best of the user's phrase and each synonym phrase.
  const relevance = new Map<string, number>();
  let found: Array<{ document: unknown; score: number }>;
  if (!original) {
    found = (await search(idx.db, { term: "", where, limit: all })).hits;
  } else {
    found = [];
    for (const [i, phrase] of [original, ...expanded].entries()) {
      const words = wordsOf(phrase);
      const r = await search(idx.db, {
        term: phrase, properties: ["title", "company", "skills", "body"], boost: { title: 3, company: 2, skills: 2, body: 1 },
        // Typo tolerance only on the user's own words, and only when every word is long enough not to drift ("data" → "datadog").
        tolerance: i === 0 && words.every((w) => w.length >= 5) ? 1 : 0, threshold: 0, where, limit: all,
      } as any);
      const top = Math.max(1e-9, ...r.hits.map((h) => h.score));
      for (const h of r.hits) {
        const d = h.document as Doc;
        const titleWords = new Set(wordsOf(`${d.title} ${d.company}`));
        const inTitle = words.every((w) => titleWords.has(w));
        // A synonym only counts when it names the job itself; body mentions of "partner" or "executive" are noise.
        if (i > 0 && !inTitle) continue;
        const rel = ((h.score / top) * 0.5 + (inTitle ? 1 : 0)) * (i === 0 ? 1 : 0.85);
        if (rel > (relevance.get(d.id) ?? -1)) {
          if (!relevance.has(d.id)) found.push(h);
          relevance.set(d.id, rel);
        }
      }
    }
  }
  const term = original;

  const matches = new Map<string, JobMatch>();
  for (const m of await store.query<JobMatch>("matches", { where: { uid } })) matches.set(m.jobId, m);
  const applied = q.matchedOnly ? new Set((await store.query<{ jobId: string }>("applications", { where: { uid } })).map((a) => a.jobId)) : null;

  const wantCities = (q.cities || []).map((c) => c.toLowerCase());
  const hits = found.filter((h) => {
    const d = h.document as Doc;
    if (q.matchedOnly) {
      const m = matches.get(d.id);
      if (!m || m.hidden || m.hardFailures.length || applied!.has(d.id)) return false;
      if (q.savedOnly ? !m.saved : m.score < (q.minScore ?? 50) || m.score > (q.maxScore ?? 100)) return false;
    }
    if (!wantCities.length) return true;
    if (!q.strictCity && d.anywhere) return true;
    return (d.cities as string[]).some((c) => wantCities.includes(c.toLowerCase()));
  });

  const facets: JobSearchResult["facets"] = { category: {}, workMode: {}, employmentType: {}, education: {}, city: {} };
  for (const h of hits) {
    const d = h.document as Doc;
    bump(facets.category, d.category);
    bump(facets.workMode, d.workMode);
    bump(facets.employmentType, d.employmentType);
    if (d.eduRank >= 0) bump(facets.education, EDU_ORDER[d.eduRank]);
    for (const c of d.cities as string[]) bump(facets.city, c);
  }

  const sort =q.sort || (term ? "relevance" : "match");
  const maxRel = Math.max(1e-9, ...relevance.values());
  const keyed = hits.map((h) => {
    const d = h.document as Doc;
    const m = matches.get(d.id);
    const rel = term ? (relevance.get(d.id) ?? 0) / maxRel : 0;
    const personal = m && !m.hidden ? m.score / 100 : 0;
    const key = sort === "newest" ? d.posted
      : sort === "salary" ? d.salaryMax
      : sort === "match" ? (term ? rel * 0.4 + personal * 0.6 : personal * 1e6 + d.posted / 1e13)
      : rel;
    return { id: d.id, key, m };
  });
  keyed.sort((a, b) => b.key - a.key);
  const total = keyed.length;
  const slice = keyed.slice((page - 1) * pageSize, page * pageSize);

  const out: JobSearchResult["hits"] = [];
  for (const k of slice) {
    const job = await store.get<Job>("jobs", k.id);
    if (!job) continue;
    out.push({
      job: { ...job, description: job.description.slice(0, 600) },
      matchScore: k.m?.score, matchConfidence: k.m?.confidence, reason: k.m?.reasons[0], gap: k.m?.gaps[0], saved: k.m?.saved, matchedAt: k.m?.createdAt,
    });
  }
  return { hits: out, total, page, pageSize, facets, expandedTerms: expanded, indexSize: idx.ids.size };
}

/** Title/company suggestions for the search box. */
export async function suggest(uid: string, prefix: string, limit = 8): Promise<string[]> {
  if (prefix.trim().length < 2) return [];
  const idx = await getIndex();
  const res = await search(idx.db, { term: prefix, properties: ["title", "company"], tolerance: 1, where: { owner: { in: ["public", uid] } } as any, limit: 60 });
  const seen = new Map<string, number>();
  for (const h of res.hits) {
    const d = h.document as Doc;
    for (const s of [d.title as string, d.company as string]) {
      if (s.toLowerCase().includes(prefix.trim().toLowerCase())) seen.set(s, (seen.get(s) || 0) + 1);
    }
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([s]) => s);
}
