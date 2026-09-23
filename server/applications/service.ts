import crypto from "node:crypto";
import { APPLICATION_TRANSITIONS, type ApplicationRecord, type ApplicationStatus, type Job, type JobMatch, type ResumeVersion } from "../../shared/types.js";
import { audit } from "../audit.js";
import { getStore } from "../db/store.js";
import { computeMatch } from "../matching/engine.js";
import { matchId } from "../matching/service.js";
import { getProfile } from "../profile/service.js";
import { generateCoverLetter, generateTailoredResume } from "../resume/tailor.js";

export class AppError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const newId = () => `app_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;

export async function getJobForUser(uid: string, jobId: string): Promise<Job> {
  const job = await (await getStore()).get<Job>("jobs", jobId);
  if (!job || (job.ownerUid && job.ownerUid !== uid)) throw new AppError(404, "Job not found");
  return job;
}

export async function listApplications(uid: string): Promise<ApplicationRecord[]> {
  const all = await (await getStore()).query<ApplicationRecord>("applications", { where: { uid } });
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getApplication(uid: string, id: string): Promise<ApplicationRecord> {
  const a = await (await getStore()).get<ApplicationRecord>("applications", id);
  if (!a || a.uid !== uid) throw new AppError(404, "Application not found");
  return a;
}

export const DATA_SHARED = ["Full name", "Email address", "Phone number", "Approved resume", "Cover letter (if you include it)"];

export interface ApplicationPackage {
  application: ApplicationRecord;
  job: Job;
  match: JobMatch | null;
  resume: ResumeVersion | null;
  coverLetter: string;
  coverLetterValidation: { ok: boolean; issues: unknown[] };
  willShare: string[];
  nextStep: string;
}

/** Mode B (assisted): prepare everything; the user reviews, approves the resume and submits on the employer's site. */
export async function prepareApplication(uid: string, jobId: string, opts: { regenerate?: boolean } = {}): Promise<ApplicationPackage> {
  const store = await getStore();
  const profile = await getProfile(uid);
  if (!profile || profile.status !== "ready") throw new AppError(409, "Complete your profile before preparing applications.");
  const job = await getJobForUser(uid, jobId);

  let match = await store.get<JobMatch>("matches", matchId(uid, jobId));
  if (!match) {
    const calc = computeMatch({ profile, job });
    const now = new Date().toISOString();
    match = { ...calc, id: matchId(uid, jobId), uid, hidden: false, saved: false, notified: true, createdAt: now, updatedAt: now };
    await store.put("matches", match.id, match);
  }

  const existing = (await listApplications(uid)).find((a) => a.jobId === jobId && !["withdrawn", "rejected", "expired"].includes(a.status));
  if (existing && existing.status !== "preparing" && !opts.regenerate) {
    throw new AppError(409, `You already have an application for this job (status: ${existing.status.replace("_", " ")}).`);
  }

  let resume: ResumeVersion | null = null;
  if (existing?.resumeVersionId && !opts.regenerate) resume = await store.get<ResumeVersion>("resumeVersions", existing.resumeVersionId);
  if (!resume) resume = await generateTailoredResume(uid, profile, job, match);

  const cover = await generateCoverLetter(uid, profile, job);
  const now = new Date().toISOString();
  const src = job.sources.find((s) => s.applyUrl) || job.sources[0];
  const app: ApplicationRecord = existing
    ? { ...existing, resumeVersionId: resume.id, coverLetter: cover.text, updatedAt: now }
    : {
        id: newId(), uid, jobId, company: job.company, role: job.title, source: src?.sourceName || "", applyUrl: src?.applyUrl || src?.sourceUrl || "",
        mode: "assisted", status: "preparing", resumeVersionId: resume.id, coverLetter: cover.text, notes: "", interviewDates: [],
        history: [{ at: now, status: "preparing", actor: "user", note: "Application prepared" }], createdAt: now, updatedAt: now,
      };
  await store.put("applications", app.id, app);
  await audit(uid, "application.prepared", { applicationId: app.id, jobId, resumeVersionId: resume.id });
  return {
    application: app, job, match, resume, coverLetter: cover.text, coverLetterValidation: cover.validation, willShare: DATA_SHARED,
    nextStep: resume.approved ? "Open the employer's page and submit, then confirm here that you applied." : "Review and approve the tailored resume before applying.",
  };
}

/** Mode A: direct apply — just track that the user opened the employer's page. No documents are generated or shared. */
export async function startDirectApply(uid: string, jobId: string): Promise<{ applyUrl: string; application: ApplicationRecord }> {
  const store = await getStore();
  const job = await getJobForUser(uid, jobId);
  const src = job.sources.find((s) => s.applyUrl) || job.sources[0];
  const url = src?.applyUrl || src?.sourceUrl;
  if (!url) throw new AppError(422, "This job has no application link. Use the original posting.");
  let app = (await listApplications(uid)).find((a) => a.jobId === jobId && !["withdrawn", "rejected", "expired"].includes(a.status));
  const now = new Date().toISOString();
  if (!app) {
    app = {
      id: newId(), uid, jobId, company: job.company, role: job.title, source: src.sourceName, applyUrl: url, mode: "direct", status: "preparing", notes: "", interviewDates: [],
      history: [{ at: now, status: "preparing", actor: "user", note: "Opened employer application page" }], createdAt: now, updatedAt: now,
    };
    await store.put("applications", app.id, app);
    await audit(uid, "application.direct_opened", { applicationId: app.id, jobId });
  }
  return { applyUrl: url, application: app };
}

export async function updateStatus(uid: string, id: string, status: ApplicationStatus, opts: { note?: string; actor?: "user" | "agent"; interviewDate?: string; followUpAt?: string } = {}): Promise<ApplicationRecord> {
  const store = await getStore();
  const a = await getApplication(uid, id);
  if (a.status !== status && !APPLICATION_TRANSITIONS[a.status].includes(status))
    throw new AppError(422, `Can't move an application from "${a.status.replace("_", " ")}" to "${status.replace("_", " ")}".`);
  if (status === "applied" && a.mode === "assisted" && a.resumeVersionId) {
    const rv = await store.get<ResumeVersion>("resumeVersions", a.resumeVersionId);
    if (!rv?.approved) throw new AppError(409, "Approve the tailored resume before marking this application as applied.");
  }
  const now = new Date().toISOString();
  const next: ApplicationRecord = {
    ...a, status, updatedAt: now,
    appliedAt: status === "applied" && !a.appliedAt ? now : a.appliedAt,
    interviewDates: opts.interviewDate ? [...a.interviewDates, opts.interviewDate] : a.interviewDates,
    followUpAt: opts.followUpAt ?? (status === "applied" ? new Date(Date.now() + 7 * 86400000).toISOString() : a.followUpAt),
    notes: opts.note && status === a.status ? `${a.notes}${a.notes ? "\n" : ""}${opts.note}` : a.notes,
    history: [...a.history, { at: now, status, note: opts.note, actor: opts.actor || "user" }],
  };
  await store.put("applications", id, next);
  await audit(uid, "application.status_changed", { applicationId: id, from: a.status, to: status }, opts.actor || "user");
  return next;
}

export async function addNote(uid: string, id: string, note: string): Promise<ApplicationRecord> {
  const a = await getApplication(uid, id);
  const next = { ...a, notes: `${a.notes}${a.notes ? "\n" : ""}${note.slice(0, 1000)}`, updatedAt: new Date().toISOString() };
  await (await getStore()).put("applications", id, next);
  return next;
}

export async function applicationSummary(uid: string, sinceDays = 7) {
  const apps = await listApplications(uid);
  const since = Date.now() - sinceDays * 86400000;
  const recent = apps.filter((a) => a.appliedAt && new Date(a.appliedAt).getTime() >= since);
  const byStatus: Record<string, number> = {};
  for (const a of apps) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
  return { total: apps.length, appliedInPeriod: recent.map((a) => ({ id: a.id, company: a.company, role: a.role, appliedAt: a.appliedAt, status: a.status })), byStatus, pending: apps.filter((a) => ["applied", "under_review", "shortlisted"].includes(a.status)).length };
}
