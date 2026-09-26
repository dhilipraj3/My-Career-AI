import { z } from "zod";
import type { CandidateProfile, Job, JobIntelligence, JobMatch, MatchFeedbackReason } from "../../shared/types.js";
import { generateJSON, aiAvailable, AiQuotaError, SYSTEM_UID } from "../ai/gateway.js";
import { getStore } from "../db/store.js";
import { normalizeSkillKey } from "../nlp/skills.js";
import { UNTRUSTED_NOTICE, fenceUntrusted } from "../nlp/text.js";
import { audit } from "../audit.js";
import { parseExperienceRange } from "../jobs/normalize.js";
import { computeMatch, isCandidateJob } from "./engine.js";
import { getProfile } from "../profile/service.js";
import { notify } from "../notifications.js";

export const MIN_NOTIFY_SCORE = 70;

const Intel = z.object({
  requiredSkills: z.array(z.string()).catch([]),
  preferredSkills: z.array(z.string()).catch([]),
  responsibilities: z.array(z.string()).catch([]),
  qualifications: z.array(z.string()).catch([]),
  minExperience: z.number().nullable().catch(null),
  maxExperience: z.number().nullable().catch(null),
  seniority: z.string().catch(""),
  redFlags: z.array(z.string()).catch([]),
  ambiguities: z.array(z.string()).catch([]),
});

export function deterministicIntelligence(j: Job): JobIntelligence {
  const exp = parseExperienceRange(`${j.title} ${j.description}`);
  const lines = j.description.split(/\n|•|·|- /).map((l) => l.trim()).filter((l) => l.length > 25 && l.length < 220);
  return {
    requiredSkills: j.skills, preferredSkills: [], responsibilities: lines.slice(0, 8), qualifications: lines.filter((l) => /degree|bachelor|master|b\.?tech|mba|certif/i.test(l)).slice(0, 4),
    minExperience: exp.min, maxExperience: exp.max, seniority: j.seniority, redFlags: [...j.quality.flags], ambiguities: [], analyzedBy: "deterministic",
  };
}

/** AI job analysis, cached globally and shared by all candidates (scope §40). Falls back to deterministic extraction. */
export async function analyzeJob(job: Job): Promise<Job> {
  if (job.intelligence?.analyzedBy === "ai") return job;
  let intel: JobIntelligence;
  try {
    const prompt = `Analyse this job posting. Return JSON: {"requiredSkills":[],"preferredSkills":[],"responsibilities":[],"qualifications":[],"minExperience":number|null,"maxExperience":number|null,"seniority":"","redFlags":[],"ambiguities":[]}.
Only include skills/requirements the posting explicitly states. Keep each list item short.
${fenceUntrusted("job_posting", `${job.title} at ${job.company}\n${job.description}`, 7000)}`;
    const r = await generateJSON({ task: "job_analyze", uid: SYSTEM_UID, system: `You extract structured data from job postings. ${UNTRUSTED_NOTICE}`, prompt, schema: Intel, maxTokens: 1500 });
    const required = [...new Set([...r.requiredSkills.map(normalizeSkillKey), ...job.skills])];
    intel = {
      requiredSkills: required, preferredSkills: r.preferredSkills.map(normalizeSkillKey).filter((k) => !required.includes(k)),
      responsibilities: r.responsibilities.slice(0, 10), qualifications: r.qualifications.slice(0, 6),
      minExperience: r.minExperience ?? job.experienceMin, maxExperience: r.maxExperience ?? job.experienceMax,
      seniority: r.seniority || job.seniority, redFlags: [...new Set([...job.quality.flags, ...r.redFlags])].slice(0, 8), ambiguities: r.ambiguities.slice(0, 5), analyzedBy: "ai",
    };
  } catch (err) {
    if (!(err instanceof AiQuotaError)) console.warn("[analyze] AI unavailable, using deterministic analysis");
    intel = job.intelligence || deterministicIntelligence(job);
  }
  const next = { ...job, intelligence: intel };
  await (await getStore()).put("jobs", job.id, next);
  return next;
}

export async function candidateJobs(uid: string): Promise<Job[]> {
  const jobs = await (await getStore()).query<Job>("jobs", { readOnly: true });
  return jobs.filter((j) => isCandidateJob(j, uid) && !j.quality.flags.includes("missing_company"));
}

export const matchId = (uid: string, jobId: string) => `${uid}_${jobId}`;

/** (Re)score jobs for one candidate. Deterministic; AI is only used to enrich explanations for the top results. */
export async function matchCandidate(uid: string, opts: { jobIds?: string[]; notifyNew?: boolean } = {}): Promise<{ scored: number; newStrong: JobMatch[] }> {
  const store = await getStore();
  const profile = await getProfile(uid);
  if (!profile || profile.status !== "ready") return { scored: 0, newStrong: [] };
  let jobs = await candidateJobs(uid);
  if (opts.jobIds) {
    const want = new Set(opts.jobIds);
    jobs = jobs.filter((j) => want.has(j.id));
  }
  const now = new Date().toISOString();
  const newStrong: JobMatch[] = [];
  for (const job of jobs) {
    const existing = await store.get<JobMatch>("matches", matchId(uid, job.id));
    const calc = computeMatch({ profile, job });
    // Persist only relevant results; keep the collection small and the feed meaningful.
    if (calc.score < 35 && !existing) continue;
    const match: JobMatch = {
      ...calc, id: matchId(uid, job.id), uid, aiSummary: existing?.aiSummary, feedback: existing?.feedback,
      hidden: existing?.hidden ?? false, saved: existing?.saved ?? false, notified: existing?.notified ?? false,
      createdAt: existing?.createdAt || now, updatedAt: now,
    };
    await store.put("matches", match.id, match);
    if (!existing && !match.notified && match.score >= MIN_NOTIFY_SCORE && match.hardFailures.length === 0) newStrong.push(match);
  }
  if (opts.notifyNew && newStrong.length && !profile.discoveryPaused) {
    const top = [...newStrong].sort((a, b) => b.rankScore - a.rankScore);
    for (const m of top) await store.update<JobMatch>("matches", m.id, { notified: true });
    const best = top[0];
    const bestJob = await store.get<Job>("jobs", best.jobId);
    await notify(uid, {
      kind: "new_jobs", title: `${top.length} new opportunit${top.length === 1 ? "y" : "ies"} for you`,
      body: bestJob ? `Top match: ${best.score}% — ${bestJob.title} at ${bestJob.company}` : `${top.length} strong matches found.`, jobId: best.jobId,
    });
  }
  await audit(uid, "matching.run", { scored: jobs.length, newStrong: newStrong.length }, "system");
  return { scored: jobs.length, newStrong };
}

export interface FeedItem {
  match: JobMatch;
  job: Job;
}

export async function getFeed(uid: string, opts: { minScore?: number; limit?: number; includeHidden?: boolean; savedOnly?: boolean } = {}): Promise<FeedItem[]> {
  const store = await getStore();
  const matches = await store.query<JobMatch>("matches", { where: { uid } });
  const applications = await store.query<{ jobId: string }>("applications", { where: { uid } });
  const applied = new Set(applications.map((a) => a.jobId));
  const items: FeedItem[] = [];
  for (const m of matches) {
    if (m.hidden && !opts.includeHidden) continue;
    if (opts.savedOnly && !m.saved) continue;
    if (m.score < (opts.minScore ?? 50) && !m.saved) continue;
    if (m.hardFailures.length && !m.saved) continue;
    if (applied.has(m.jobId)) continue;
    const job = await store.get<Job>("jobs", m.jobId);
    if (!job || !isCandidateJob(job, uid)) continue;
    items.push({ match: m, job });
  }
  items.sort((a, b) => b.match.rankScore - a.match.rankScore);
  return items.slice(0, opts.limit ?? 50);
}

const Explain = z.object({ summary: z.string().min(10).max(700) });

/** Plain-language explanation for one match. AI when available (grounded in computed facts), deterministic otherwise. */
export async function explainMatch(uid: string, jobId: string): Promise<JobMatch | null> {
  const store = await getStore();
  const m = await store.get<JobMatch>("matches", matchId(uid, jobId));
  if (!m) return null;
  if (m.aiSummary) return m;
  const job = await store.get<Job>("jobs", jobId);
  const profile = await getProfile(uid);
  if (!job || !profile) return m;
  let summary = `${m.score}% match (${m.confidence} confidence). ${m.reasons.slice(0, 2).join(". ")}${m.gaps.length ? `. Watch out: ${m.gaps[0]}` : ""}.`;
  if (await aiAvailable(uid)) {
    try {
      const facts = JSON.stringify({ score: m.score, confidence: m.confidence, breakdown: m.breakdown, matched: m.matchedSkills, missing: m.missingSkills, reasons: m.reasons, gaps: m.gaps, assumptions: m.assumptions });
      const r = await generateJSON({
        task: "match_explain", uid, cache: false,
        system: `You explain job-match results to a job seeker in 2-3 friendly sentences. Use ONLY the facts provided. Do not invent skills, employers or numbers. ${UNTRUSTED_NOTICE}`,
        prompt: `Role: ${job.title} at ${job.company}\nCandidate: ${profile.currentRole || "n/a"}, ${profile.totalExperienceYears} yrs\nComputed facts: ${facts}\nReturn {"summary": "..."}`,
        schema: Explain, maxTokens: 300,
      });
      summary = r.summary;
    } catch {
      /* keep deterministic summary */
    }
  }
  const next = await store.update<JobMatch>("matches", m.id, { aiSummary: summary });
  return next;
}

export async function setFeedback(uid: string, jobId: string, reason: MatchFeedbackReason): Promise<JobMatch | null> {
  const store = await getStore();
  const m = await store.get<JobMatch>("matches", matchId(uid, jobId));
  if (!m) return null;
  await audit(uid, "match.feedback", { jobId, reason });
  return store.update<JobMatch>("matches", m.id, { feedback: reason, hidden: true });
}

export async function setSaved(uid: string, jobId: string, saved: boolean): Promise<JobMatch | null> {
  const store = await getStore();
  const m = await store.get<JobMatch>("matches", matchId(uid, jobId));
  if (!m) return null;
  return store.update<JobMatch>("matches", m.id, { saved });
}

export async function setHidden(uid: string, jobId: string, hidden: boolean): Promise<JobMatch | null> {
  const store = await getStore();
  const m = await store.get<JobMatch>("matches", matchId(uid, jobId));
  if (!m) return null;
  return store.update<JobMatch>("matches", m.id, { hidden });
}

/** Spend AI credits only where they matter: analyse the top-ranked jobs, then re-score them with richer requirements. */
export async function enrichTop(uid: string, n = 8): Promise<number> {
  const top = await getFeed(uid, { minScore: 55, limit: n });
  const ids: string[] = [];
  for (const { job } of top) {
    if (job.intelligence?.analyzedBy === "ai") continue;
    await analyzeJob(job);
    ids.push(job.id);
  }
  if (ids.length) await matchCandidate(uid, { jobIds: ids });
  return ids.length;
}

export function profileKeywords(profiles: CandidateProfile[]): string[] {
  const set = new Set<string>();
  for (const p of profiles) for (const r of p.preferences.targetRoles) set.add(r);
  return [...set].slice(0, 8);
}

/** The user's match for a job, computing and storing it on first view (e.g. a job reached through search). */
export async function ensureMatch(uid: string, job: Job): Promise<JobMatch | null> {
  const store = await getStore();
  const existing = await store.get<JobMatch>("matches", matchId(uid, job.id));
  if (existing) return existing;
  const profile = await getProfile(uid);
  if (profile?.status !== "ready") return null;
  const now = new Date().toISOString();
  const match: JobMatch = { ...computeMatch({ profile, job }), id: matchId(uid, job.id), uid, hidden: false, saved: false, notified: true, createdAt: now, updatedAt: now };
  await store.put("matches", match.id, match);
  return match;
}
