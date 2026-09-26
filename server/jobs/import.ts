// Bringing a job the user found elsewhere into their private feed: by link, by pasted description, in bulk, or from a
// forwarded alert email. One place so every path scores, analyses and tracks the job the same way.
import { z } from "zod";
import type { Job, JobMatch } from "../../shared/types.js";
import { AiQuotaError, AiUnavailableError, generateJSON } from "../ai/gateway.js";
import { AppError, getJobForUser } from "../applications/service.js";
import { audit } from "../audit.js";
import { getStore } from "../db/store.js";
import { analyzeJob, matchCandidate, matchId } from "../matching/service.js";
import { UNTRUSTED_NOTICE, fenceUntrusted } from "../nlp/text.js";
import { getProfile } from "../profile/service.js";
import { rawJobFromDescription, rawJobFromUrl } from "./connectors.js";
import { UnsafeUrlError } from "./http.js";
import { ingestRawJobs } from "./ingest.js";
import type { RawJob } from "./normalize.js";
import { autoDiscoverBoards } from "./registry.js";

export const ImportBody = z.object({
  url: z.string().url().max(600).optional(), description: z.string().min(80).max(30000).optional(),
  title: z.string().max(160).optional(), company: z.string().max(120).optional(), location: z.string().max(120).optional(),
}).refine((b) => b.url || b.description, "Provide a job URL or paste the job description.");
export type ImportInput = z.infer<typeof ImportBody>;

/** Turn a link into a raw job: structured data first, then the AI extractor, else ask the user to paste it. */
async function rawFromInput(uid: string, body: ImportInput): Promise<RawJob | null> {
  if (body.description) return rawJobFromDescription({ ...body, description: body.description });
  if (!body.url) return null;
  let fetched;
  try { fetched = await rawJobFromUrl(body.url); } catch (e: any) {
    if (e instanceof UnsafeUrlError) throw new AppError(400, e.message);
    throw new AppError(422, `I couldn't open that link (${String(e.message).slice(0, 100)}). Paste the job description instead.`);
  }
  if (fetched.raw) return fetched.raw;
  if (!fetched.needsAi) return null;
  const Extract = z.object({ title: z.string().catch(""), company: z.string().catch(""), location: z.string().catch(""), description: z.string().catch("") });
  try {
    const x = await generateJSON({
      task: "job_analyze", uid, schema: Extract, maxTokens: 2500,
      system: `You extract a single job posting from web page text. ${UNTRUSTED_NOTICE}`,
      prompt: `Return {"title","company","location","description"} for the job on this page. Use "" if not present; never invent.\n${fenceUntrusted("web_page", fetched.needsAi.text, 9000)}`,
    });
    const raw = rawJobFromDescription({ title: x.title || body.title || fetched.needsAi.title, company: x.company || body.company, location: x.location || body.location, description: x.description, url: fetched.needsAi.url });
    raw.connector = "user_url";
    raw.sourceName = new URL(fetched.needsAi.url).hostname;
    return raw;
  } catch (e) {
    if (e instanceof AiQuotaError || e instanceof AiUnavailableError) throw new AppError(503, "I couldn't read that page automatically. Please paste the job description instead.");
    throw new AppError(422, "I couldn't find a job posting on that page. Please paste the description instead.");
  }
}

/** Save an already-parsed job as the user's private job, then score it. */
export async function addRawJobForUser(uid: string, raw: RawJob, via: string): Promise<{ job: Job; match: JobMatch | null }> {
  const stats = await ingestRawJobs([raw], { ownerUid: uid });
  void autoDiscoverBoards(stats.jobIds).catch(() => undefined); // a pasted link may reveal a company board we don't read yet
  if (!stats.jobIds.length) throw new AppError(422, `That job couldn't be added (${Object.keys(stats.rejectReasons)[0]?.replace(/_/g, " ") || "invalid"}).`);
  await matchCandidate(uid, { jobIds: stats.jobIds });
  const job = await getJobForUser(uid, stats.jobIds[0]);
  await analyzeJob(job);
  await matchCandidate(uid, { jobIds: stats.jobIds });
  const match = await (await getStore()).get<JobMatch>("matches", matchId(uid, job.id));
  await audit(uid, "job.imported", { jobId: job.id, via });
  return { job, match };
}

export async function importJobForUser(uid: string, body: ImportInput, via = "manual"): Promise<{ job: Job; match: JobMatch | null }> {
  const profile = await getProfile(uid);
  if (!profile || profile.status !== "ready") throw new AppError(409, "Finish your profile first so I can score this job for you.");
  const raw = await rawFromInput(uid, body);
  if (!raw) throw new AppError(422, "Couldn't read that job.");
  raw.title ||= body.title || "";
  raw.company ||= body.company || "";
  if (!raw.company) throw new AppError(422, "I couldn't work out the company. Add it and try again.");
  return addRawJobForUser(uid, raw, via);
}

export interface BulkResult { url: string; ok: boolean; jobId?: string; title?: string; company?: string; score?: number; error?: string }

/** Several links at once, one after another (so we stay polite to the sites). Failures never stop the rest. */
export async function importLinks(uid: string, urls: string[], via = "bulk"): Promise<BulkResult[]> {
  const out: BulkResult[] = [];
  for (const url of [...new Set(urls)].slice(0, 8)) {
    try {
      const { job, match } = await importJobForUser(uid, { url }, via);
      out.push({ url, ok: true, jobId: job.id, title: job.title, company: job.company, score: match?.score });
    } catch (e: any) {
      out.push({ url, ok: false, error: e instanceof AppError ? e.message : "Couldn't add this one." });
    }
  }
  return out;
}

/** Pull every distinct http(s) link out of pasted text (WhatsApp forwards, notes, email bodies). */
export function extractLinks(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  return [...new Set(found.map((u) => u.replace(/[.,;:!?]+$/, "")))];
}
