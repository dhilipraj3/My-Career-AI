// Employers can post jobs for free. Trust comes from three layers: (1) the sign-in email must be on the company's own
// domain for instant trust, otherwise an admin reviews; (2) every posting goes through the same scam checks as any
// other source; (3) candidates can report, and enough reports take a job down for review.
import crypto from "node:crypto";
import { z } from "zod";
import type { CandidateProfile, Job } from "../../shared/types.js";
import { EMPLOYER_LIMITS, REPORT_REASONS, type DirectApplication, type DirectApplicationStatus, type Employer, type EmployerJob, type JobReport, type ReportReason, type SharedProfile } from "../../shared/employer.js";
import { generateJSON } from "../ai/gateway.js";
import { AppError } from "../applications/service.js";
import { audit } from "../audit.js";
import type { AuthedUser } from "../auth.js";
import { config } from "../config.js";
import { getStore } from "../db/store.js";
import { ingestRawJobs } from "../jobs/ingest.js";
import { isRejected, normalizeRaw, type RawJob } from "../jobs/normalize.js";
import { computeMatch } from "../matching/engine.js";
import { notify } from "../notifications.js";
import { displayName } from "../nlp/skills.js";
import { UNTRUSTED_NOTICE, fenceUntrusted } from "../nlp/text.js";
import { getProfile } from "../profile/service.js";
import { syncJobs } from "../search/index.js";

const FREE_MAIL = /^(gmail|yahoo|ymail|hotmail|outlook|live|rediffmail|icloud|proton|protonmail|aol|msn)\./i;
const id = (p: string) => `${p}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
const now = () => new Date().toISOString();
export const DIRECT = "employer";

// ---------------- employers ----------------

/** "https://www.acme.co.in/careers" → "acme.co.in" */
export function domainOf(url: string): string {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

/** Company-domain sign-in email = verified. Free-mail addresses can never verify a company on their own. */
export function emailMatchesDomain(email: string, website: string): boolean {
  const host = domainOf(website), mail = email.split("@")[1]?.toLowerCase() || "";
  if (!host || !mail || FREE_MAIL.test(mail)) return false;
  return mail === host || mail.endsWith(`.${host}`) || host.endsWith(`.${mail}`);
}

export const RegisterBody = z.object({ company: z.string().trim().min(2).max(100), website: z.string().trim().min(4).max(200), contactName: z.string().trim().min(2).max(80) });

export const getEmployer = async (uid: string) => (await getStore()).get<Employer>("employers", uid);

export async function registerEmployer(user: AuthedUser, input: z.infer<typeof RegisterBody>): Promise<Employer> {
  const store = await getStore();
  const existing = await getEmployer(user.uid);
  if (existing?.status === "blocked") throw new AppError(403, "This employer account has been blocked.");
  if (!domainOf(input.website)) throw new AppError(422, "Enter your company website, like www.yourcompany.com.");
  const domainVerified = emailMatchesDomain(user.email || "", input.website);
  const employer: Employer = {
    uid: user.uid, company: input.company, website: input.website, contactName: input.contactName, contactEmail: user.email || "", domainVerified,
    status: existing?.status === "verified" ? "verified" : domainVerified ? "verified" : "pending", createdAt: existing?.createdAt || now(),
  };
  await store.put("employers", user.uid, employer);
  await audit(user.uid, "employer.registered", { domainVerified });
  return employer;
}

async function requireEmployer(uid: string): Promise<Employer> {
  const e = await getEmployer(uid);
  if (!e) throw new AppError(403, "Set up your employer account first.");
  if (e.status === "blocked") throw new AppError(403, "This employer account has been blocked.");
  return e;
}

// ---------------- drafting (rough text → structured posting) ----------------

const Draft = z.object({ title: z.string().catch(""), location: z.string().catch(""), description: z.string().catch(""), salaryText: z.string().catch(""), employmentType: z.enum(["full_time", "part_time", "contract", "internship"]).catch("full_time") });
export type PostingDraft = z.infer<typeof Draft>;

/** Rules first (always works): first short line is the title, a "Location:" or known city is the place. */
export function roughDraft(text: string): PostingDraft {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const title = (lines.find((l) => l.length <= 80 && !/^(location|salary|pay|ctc)/i.test(l)) || "").replace(/^(hiring|urgent(ly)?( hiring)?|required|wanted|vacancy for)[:\s-]*/i, "").trim();
  const loc = /(?:location|place|city)\s*[:\-]\s*([^\n]+)/i.exec(text)?.[1]?.trim() || "";
  const sal = /(?:salary|pay|ctc|package)\s*[:\-]?\s*([^\n]{3,60})/i.exec(text)?.[1]?.trim() || /(₹|rs\.?)\s?[\d,]+(?:\s*[-–to]+\s*[\d,]+)?(?:\s*(?:per month|\/month|lpa|pm|per day|\/day))?/i.exec(text)?.[0] || "";
  const et = /intern/i.test(text) ? "internship" : /part[- ]?time/i.test(text) ? "part_time" : /contract/i.test(text) ? "contract" : "full_time";
  return { title, location: loc, description: text.trim(), salaryText: sal, employmentType: et };
}

/** "Post a job in 60 seconds": AI turns a rough message (even a WhatsApp forward) into a clear posting; rules otherwise. */
export async function draftPosting(uid: string, rough: string): Promise<{ draft: PostingDraft; by: "ai" | "rules" }> {
  try {
    const d = await generateJSON({
      task: "job_analyze", uid, schema: Draft, cache: false, maxTokens: 1800,
      system: `You turn a rough job message into a clear job posting. Use only what the message says; never invent pay, benefits or requirements. ${UNTRUSTED_NOTICE}`,
      prompt: `Return {"title","location","description","salaryText","employmentType"}. "description" should be a clear multi-line posting (about the role, responsibilities, requirements, how to apply in the app). Use "" for anything not stated.\n${fenceUntrusted("rough_message", rough, 4000)}`,
    });
    if (d.title && d.description.length >= 60) return { draft: d, by: "ai" };
  } catch { /* fall back to rules */ }
  return { draft: roughDraft(rough), by: "rules" };
}

// ---------------- posting & moderation ----------------

export const PostBody = z.object({
  title: z.string().trim().min(3).max(120), description: z.string().trim().min(60).max(8000), location: z.string().trim().min(2).max(100),
  salaryText: z.string().trim().max(80).optional(), employmentType: z.enum(["full_time", "part_time", "contract", "internship"]).default("full_time"), remote: z.boolean().optional(),
});

function rawFor(ej: EmployerJob): RawJob {
  const link = `${config.siteUrl}/go/${ej.id}`;
  return {
    connector: DIRECT, sourceName: "Posted directly by employer", sourceJobId: ej.id, title: ej.title, company: ej.company, location: ej.location, remote: ej.remote,
    employmentType: ej.employmentType, description: ej.description, url: link, applyUrl: link, salaryText: ej.salaryText, postedAt: ej.createdAt, deadline: ej.expiresAt,
  };
}

/** Same scam checks as any other source. Returns the reasons a human should look, if any. */
export function moderationReasons(ej: EmployerJob, employer: Employer): string[] {
  const reasons: string[] = [];
  if (employer.status !== "verified") reasons.push("The company hasn't been verified yet.");
  const n = normalizeRaw(rawFor(ej));
  if (isRejected(n)) reasons.push(`The posting is incomplete (${n.reason.replace(/_/g, " ")}).`);
  else {
    const f = n.job.quality.flags;
    if (n.job.quality.suspicious) reasons.push("It looks like a scam or misleading posting.");
    if (f.includes("spam_language")) reasons.push("It asks for payment or uses spam-like wording.");
    if (f.includes("unrealistic_salary")) reasons.push("The pay looks unrealistic for this kind of job.");
    if (f.includes("personal_email_contact")) reasons.push("It asks candidates to write to a personal email address.");
  }
  return [...new Set(reasons)];
}

async function goLive(ej: EmployerJob): Promise<EmployerJob> {
  const stats = await ingestRawJobs([rawFor(ej)]);
  const jobId = stats.jobIds[0];
  if (!jobId) return { ...ej, status: "rejected", reasons: ["The posting could not be published."], updatedAt: now() };
  return { ...ej, status: "live", reasons: [], jobId, updatedAt: now() };
}

export async function postJob(uid: string, input: z.infer<typeof PostBody>): Promise<EmployerJob> {
  const employer = await requireEmployer(uid);
  const store = await getStore();
  const dayAgo = Date.now() - 86_400_000;
  const recent = (await store.query<EmployerJob>("employerJobs", { where: { employerUid: uid } })).filter((j) => new Date(j.createdAt).getTime() > dayAgo).length;
  const cap = employer.status === "verified" ? EMPLOYER_LIMITS.postsPerDayVerified : EMPLOYER_LIMITS.postsPerDayPending;
  if (recent >= cap) throw new AppError(429, `You can post ${cap} jobs a day${employer.status === "verified" ? "" : " until your company is verified"}. Try again tomorrow.`);
  let ej: EmployerJob = {
    id: id("ej"), employerUid: uid, title: input.title, company: employer.company, location: input.location, description: input.description, salaryText: input.salaryText,
    employmentType: input.employmentType, remote: input.remote ?? /remote|work from home|wfh/i.test(input.location), status: "pending_review", reasons: [],
    expiresAt: new Date(Date.now() + EMPLOYER_LIMITS.liveDays * 86_400_000).toISOString(), createdAt: now(), updatedAt: now(),
  };
  ej.reasons = moderationReasons(ej, employer);
  if (!ej.reasons.length) ej = await goLive(ej);
  await store.put("employerJobs", ej.id, ej);
  if (ej.jobId) await syncJobs([ej.jobId]).catch(() => undefined);
  await audit(uid, "employer.job_posted", { employerJobId: ej.id, status: ej.status });
  return ej;
}

export async function listEmployerJobs(uid: string): Promise<Array<EmployerJob & { applicants: number; newApplicants: number }>> {
  const store = await getStore();
  const jobs = (await store.query<EmployerJob>("employerJobs", { where: { employerUid: uid } })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const apps = await store.query<DirectApplication>("directApplications", { where: { employerUid: uid } });
  return jobs.map((j) => ({ ...j, applicants: apps.filter((a) => a.employerJobId === j.id).length, newApplicants: apps.filter((a) => a.employerJobId === j.id && a.status === "new").length }));
}

async function ownedJob(uid: string, jobId: string): Promise<EmployerJob> {
  const ej = await (await getStore()).get<EmployerJob>("employerJobs", jobId);
  if (!ej || ej.employerUid !== uid) throw new AppError(404, "Job not found");
  return ej;
}

async function takeDown(ej: EmployerJob, status: EmployerJob["status"], reasons: string[]): Promise<EmployerJob> {
  const store = await getStore();
  const next = { ...ej, status, reasons, updatedAt: now() };
  await store.put("employerJobs", ej.id, next);
  if (ej.jobId) {
    await store.update<Job>("jobs", ej.jobId, { status: "closed" }).catch(() => undefined);
    await syncJobs([ej.jobId]).catch(() => undefined);
  }
  return next;
}

export async function closeJob(uid: string, employerJobId: string): Promise<EmployerJob> {
  const ej = await ownedJob(uid, employerJobId);
  const next = await takeDown(ej, "closed", []);
  await audit(uid, "employer.job_closed", { employerJobId });
  return next;
}

// ---------------- candidates apply, employers review ----------------

/** What the candidate agrees to share. Shown to them before they confirm. */
export const SHARED_FIELDS = ["Full name", "Email address", "Phone number", "City", "Current role and experience", "Verified skills", "Education", "Your profile summary", "Your optional message"];

export function sharedProfile(p: CandidateProfile, message?: string): SharedProfile {
  return {
    name: p.fullName, email: p.email, phone: p.phone, city: p.city, currentRole: p.currentRole, experienceYears: p.totalExperienceYears,
    skills: p.skills.filter((s) => s.source !== "ai_derived").slice(0, 25).map((s) => displayName(s.key, s.name)),
    summary: p.summary.slice(0, 600), education: p.education.map((e) => [e.degree, e.institution, e.gradYear].filter(Boolean).join(", ")).slice(0, 4), message: message?.slice(0, 500),
  };
}

export async function applyDirect(uid: string, jobId: string, message?: string): Promise<DirectApplication> {
  const store = await getStore();
  const profile = await getProfile(uid);
  if (!profile || profile.status !== "ready") throw new AppError(409, "Finish your profile before applying.");
  const job = await store.get<Job>("jobs", jobId);
  const src = job?.sources.find((s) => s.connector === DIRECT);
  if (!job || !src) throw new AppError(404, "This job doesn't accept applications here.");
  const ej = await store.get<EmployerJob>("employerJobs", src.sourceJobId);
  if (!ej || ej.status !== "live") throw new AppError(410, "This job is no longer open.");
  if (ej.employerUid === uid) throw new AppError(400, "You can't apply to your own job.");
  const dup = (await store.query<DirectApplication>("directApplications", { where: { candidateUid: uid } })).find((a) => a.employerJobId === ej.id);
  if (dup) throw new AppError(409, "You've already applied to this job.");
  const m = computeMatch({ profile, job });
  const app: DirectApplication = {
    id: id("da"), employerJobId: ej.id, jobId, candidateUid: uid, employerUid: ej.employerUid, shared: sharedProfile(profile, message),
    matchScore: m.score, reasons: m.reasons.slice(0, 4), gaps: m.gaps.slice(0, 3), status: "new", createdAt: now(), updatedAt: now(),
  };
  await store.put("directApplications", app.id, app);
  // Track it on the candidate's own board too.
  const at = now();
  const appId = id("app");
  await store.put("applications", appId, {
    id: appId, uid, jobId, company: job.company, role: job.title, source: "Posted directly by employer", applyUrl: "", mode: "direct", status: "applied", notes: "", interviewDates: [], appliedAt: at,
    followUpAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), history: [{ at, status: "applied", actor: "user", note: "Applied in MyCareer.AI" }], createdAt: at, updatedAt: at,
  });
  await notify(ej.employerUid, { kind: "application", title: `New applicant for ${ej.title}`, body: `${profile.fullName || "A candidate"} · ${m.score}% match`, jobId });
  await audit(uid, "application.direct_shared", { employerJobId: ej.id });
  return app;
}

export async function candidatesFor(uid: string, employerJobId: string): Promise<DirectApplication[]> {
  await ownedJob(uid, employerJobId);
  const apps = await (await getStore()).query<DirectApplication>("directApplications", { where: { employerJobId } });
  return apps.sort((a, b) => b.matchScore - a.matchScore || b.createdAt.localeCompare(a.createdAt));
}

const STATUS_WORDS: Record<DirectApplicationStatus, string> = { new: "received", shortlisted: "shortlisted you", rejected: "decided not to move forward", hired: "selected you" };

export async function setApplicantStatus(uid: string, applicationId: string, status: DirectApplicationStatus, note?: string): Promise<DirectApplication> {
  const store = await getStore();
  const a = await store.get<DirectApplication>("directApplications", applicationId);
  if (!a || a.employerUid !== uid) throw new AppError(404, "Applicant not found");
  const next = { ...a, status, employerNote: note?.slice(0, 500) ?? a.employerNote, updatedAt: now() };
  await store.put("directApplications", a.id, next);
  const job = await store.get<Job>("jobs", a.jobId);
  if (status !== "new") {
    await notify(a.candidateUid, { kind: "application", title: `${job?.company || "The employer"} ${STATUS_WORDS[status]}`, body: `${job?.title || "Your application"}${note ? ` — “${note.slice(0, 120)}”` : ""}`, jobId: a.jobId });
    // Mirror it on the candidate's board so their pipeline stays true.
    const theirs = (await store.query<{ id: string; uid: string; jobId: string; status: string; history: any[] }>("applications", { where: { uid: a.candidateUid } })).find((x) => x.jobId === a.jobId);
    const map: Partial<Record<DirectApplicationStatus, string>> = { shortlisted: "shortlisted", rejected: "rejected", hired: "offer" };
    if (theirs && map[status] && theirs.status !== map[status]) {
      await store.update("applications", theirs.id, { status: map[status], updatedAt: now(), history: [...theirs.history, { at: now(), status: map[status], actor: "system", note: "Update from the employer" }] } as never);
    }
  }
  return next;
}

// ---------------- reports & moderation queue ----------------

export async function reportJob(uid: string, jobId: string, reason: ReportReason, note?: string): Promise<{ reports: number; hidden: boolean }> {
  if (!REPORT_REASONS.includes(reason)) throw new AppError(400, "Unknown reason.");
  const store = await getStore();
  const job = await store.get<Job>("jobs", jobId);
  if (!job || (job.ownerUid && job.ownerUid !== uid)) throw new AppError(404, "Job not found");
  const all = await store.query<JobReport>("reports", { where: { jobId } });
  if (!all.some((r) => r.reporterUid === uid)) {
    const rep: JobReport = { id: id("rep"), jobId, reporterUid: uid, reason, note: note?.slice(0, 500), at: now(), handled: false };
    await store.put("reports", rep.id, rep);
    all.push(rep);
  }
  const distinct = new Set(all.filter((r) => !r.handled).map((r) => r.reporterUid)).size;
  let hidden = false;
  const src = job.sources.find((s) => s.connector === DIRECT);
  if (src && distinct >= EMPLOYER_LIMITS.reportsToHide) {
    const ej = await store.get<EmployerJob>("employerJobs", src.sourceJobId);
    if (ej?.status === "live") { await takeDown(ej, "pending_review", ["Several candidates reported this job. An admin is checking it."]); hidden = true; }
  }
  await audit(uid, "job.reported", { jobId, reason });
  return { reports: distinct, hidden };
}

export async function moderationQueue() {
  const store = await getStore();
  const jobs = (await store.query<EmployerJob>("employerJobs", { where: { status: "pending_review" } })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const employers = await store.query<Employer>("employers");
  const reports = (await store.query<JobReport>("reports", { where: { handled: false } })).sort((a, b) => a.at.localeCompare(b.at));
  return {
    jobs: jobs.map((j) => ({ ...j, employer: employers.find((e) => e.uid === j.employerUid) || null })),
    employers: employers.filter((e) => e.status === "pending"),
    reports,
  };
}

export async function decideJob(adminUid: string, employerJobId: string, decision: "approve" | "reject", reason?: string): Promise<EmployerJob> {
  const store = await getStore();
  const ej = await store.get<EmployerJob>("employerJobs", employerJobId);
  if (!ej) throw new AppError(404, "Job not found");
  let next: EmployerJob;
  if (decision === "approve") {
    next = await goLive({ ...ej, reasons: [] });
    await store.put("employerJobs", ej.id, next);
    if (next.jobId) {
      await store.update<Job>("jobs", next.jobId, { status: "new" }).catch(() => undefined);
      await syncJobs([next.jobId]).catch(() => undefined);
    }
    for (const r of await store.query<JobReport>("reports", { where: { jobId: next.jobId || "" } })) await store.update<JobReport>("reports", r.id, { handled: true });
    await notify(ej.employerUid, { kind: "system", title: "Your job is live", body: `${ej.title} was approved and is now visible to candidates.` });
  } else {
    next = await takeDown(ej, "rejected", [reason?.trim() || "It didn't meet our posting guidelines."]);
    if (next.jobId) for (const r of await store.query<JobReport>("reports", { where: { jobId: next.jobId } })) await store.update<JobReport>("reports", r.id, { handled: true });
    await notify(ej.employerUid, { kind: "system", title: "Your job wasn't approved", body: `${ej.title}: ${next.reasons[0]}` });
  }
  await audit(adminUid, "admin.job_decided", { employerJobId, decision }, "user");
  return next;
}

export async function decideEmployer(adminUid: string, uid: string, status: "verified" | "blocked"): Promise<Employer> {
  const store = await getStore();
  const e = await getEmployer(uid);
  if (!e) throw new AppError(404, "Employer not found");
  const next = { ...e, status };
  await store.put("employers", uid, next);
  if (status === "blocked") for (const j of await store.query<EmployerJob>("employerJobs", { where: { employerUid: uid } })) if (j.status === "live" || j.status === "pending_review") await takeDown(j, "rejected", ["This employer account was blocked."]);
  await audit(adminUid, "admin.employer_decided", { uid, status }, "user");
  return next;
}
