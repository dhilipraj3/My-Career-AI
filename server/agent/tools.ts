import crypto from "node:crypto";
import { z } from "zod";
import type { ApplicationStatus, Job, JobMatch, MatchFeedbackReason } from "../../shared/types.js";
import { APPLICATION_TRANSITIONS } from "../../shared/types.js";
import { AppError, applicationSummary, listApplications, prepareApplication, startDirectApply, updateStatus, getJobForUser } from "../applications/service.js";
import { getStore } from "../db/store.js";
import { runDiscovery } from "../jobs/discovery.js";
import { explainMatch, getFeed, matchCandidate, profileKeywords, setFeedback, setSaved } from "../matching/service.js";
import { getProfile, editProfile, updatePreferences } from "../profile/service.js";
import { PreferencePatch } from "../profile/preferences.js";
import { generateCoverLetter, generateTailoredResume } from "../resume/tailor.js";
import { notify } from "../notifications.js";
import { audit } from "../audit.js";
import { fenceUntrusted } from "../nlp/text.js";
import { matchId } from "../matching/service.js";
import { computeMatch } from "../matching/engine.js";
import { findIndianCities } from "../nlp/location.js";
import { feedSummary } from "../matching/feed.js";

export type Permission = "read" | "modify" | "sensitive";

export interface ToolContext {
  uid: string;
  /** True only when the human confirmed this exact pending action through the UI. */
  confirmed: boolean;
}

export interface ToolResult {
  /** Data returned to the model. */
  data: unknown;
  /** Contains third-party text (job descriptions) — taints the rest of the turn. */
  untrusted?: boolean;
  cards?: Array<{ type: "job"; jobId: string; title: string; company: string; location: string; score?: number }>;
  /** Client-side effect, e.g. open an employer page. */
  openUrl?: string;
  /** Client-side effect: move the user to a page of the app. */
  navigate?: AppPage;
  /** A change the user can undo from the chat. */
  change?: { id: string; summary: string };
}

const UNDO_TTL_MS = 24 * 3600 * 1000;
const WORK_MODE: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };
const EMPLOYMENT: Record<string, string> = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship" };

/** "Job type → Full-time · Cities → Pune, Chennai": what an assistant change did, in plain words. */
export function describePreferenceChange(a: Record<string, any>): string {
  const list = (v: string[], map?: Record<string, string>) => (v.length ? v.map((x) => map?.[x] || x).join(", ") : "none");
  const parts: string[] = [];
  if (a.targetRoles) parts.push(`Roles → ${list(a.targetRoles)}`);
  if (a.locations) parts.push(`Cities → ${list(a.locations)}`);
  if (a.workModes) parts.push(`Work mode → ${list(a.workModes, WORK_MODE)}`);
  if (a.employmentTypes) parts.push(`Job type → ${list(a.employmentTypes, EMPLOYMENT)}`);
  if (a.minSalaryLPA !== undefined) parts.push(`Minimum salary → ₹${a.minSalaryLPA} LPA`);
  if (a.noticePeriodDays !== undefined) parts.push(`Notice period → ${a.noticePeriodDays} days`);
  if (a.willingToRelocate !== undefined) parts.push(`Open to relocating → ${a.willingToRelocate ? "yes" : "no"}`);
  if (a.industries) parts.push(`Industries → ${list(a.industries)}`);
  if (a.excludedCompanies) parts.push(`Hidden companies → ${list(a.excludedCompanies)}`);
  if (a.excludedKeywords) parts.push(`Hidden keywords → ${list(a.excludedKeywords)}`);
  return parts.join(" · ") || "Preferences updated";
}

export interface Tool {
  name: string;
  description: string;
  args: string; // human/model-readable arg shape
  permission: Permission;
  /** Downgraded to a confirmation when the turn already handled untrusted content (prompt-injection guard). */
  taintSensitive?: boolean;
  schema: z.ZodType<any>;
  summarize(args: any): string;
  run(ctx: ToolContext, args: any): Promise<ToolResult>;
}

const jobBrief = (j: Job, m?: JobMatch) => ({
  jobId: j.id, title: j.title, company: j.company, location: j.location || (j.workMode === "remote" ? "Remote" : ""), workMode: j.workMode,
  salary: j.salaryMinLPA || j.salaryMaxLPA ? `${j.salaryMinLPA ?? "?"}-${j.salaryMaxLPA ?? "?"} LPA` : "not disclosed",
  posted: j.postedAt?.slice(0, 10), freshness: j.status, ...(m ? { matchScore: m.score, confidence: m.confidence } : {}),
});
const card = (j: Job, m?: JobMatch) => ({ type: "job" as const, jobId: j.id, title: j.title, company: j.company, location: j.location || (j.workMode === "remote" ? "Remote" : ""), score: m?.score });

const searchThrottle = new Map<string, number>();
export const SEARCH_COOLDOWN_MS = 5 * 60 * 1000;

/** Fire-and-forget discovery + matching for one user. Returns immediately; results arrive as a notification. */
export function startBackgroundSearch(uid: string): { started: boolean; retryInSeconds?: number } {
  const last = searchThrottle.get(uid) || 0;
  const wait = SEARCH_COOLDOWN_MS - (Date.now() - last);
  if (wait > 0) return { started: false, retryInSeconds: Math.ceil(wait / 1000) };
  searchThrottle.set(uid, Date.now());
  void (async () => {
    try {
      const p = await getProfile(uid);
      if (!p) return;
      await runDiscovery({ keywords: profileKeywords([p]), trigger: "user" });
      const r = await matchCandidate(uid, { notifyNew: false });
      const feed = await getFeed(uid, { minScore: 60, limit: 5 });
      await notify(uid, { kind: "new_jobs", title: "Job search finished", body: `${feed.length} strong opportunit${feed.length === 1 ? "y" : "ies"} ready to review (${r.scored} jobs analysed).`, jobId: feed[0]?.job.id });
    } catch (err) {
      console.warn("[search] background search failed", err);
    }
  })();
  return { started: true };
}

export function _resetSearchThrottle() {
  searchThrottle.clear();
}

const Id = z.string().min(3).max(80);

export const APP_PAGES = ["home", "matches", "search", "applications", "resume", "profile", "settings"] as const;
export type AppPage = (typeof APP_PAGES)[number];

export const TOOLS: Tool[] = [
  {
    name: "open_page", description: "Take the user to a page of the app: home (dashboard), matches (jobs matched to them, incl. saved), search (all jobs), applications, resume, profile (preferences, skills), settings (AI key, pause search, account).",
    args: '{"page":"home"|"matches"|"search"|"applications"|"resume"|"profile"|"settings"}', permission: "read", schema: z.object({ page: z.enum(APP_PAGES) }).strict(),
    summarize: (a) => `Open ${a.page}`,
    async run(_ctx, args) {
      return { data: { opened: args.page }, navigate: args.page };
    },
  },
  {
    name: "get_candidate_profile", description: "Read the user's profile summary, preferences and what information is still missing.", args: "{}", permission: "read", schema: z.object({}).strict(),
    summarize: () => "Read profile",
    async run({ uid }) {
      const p = await getProfile(uid);
      if (!p) return { data: { error: "No profile yet. Ask the user to upload a resume." } };
      return { data: { name: p.fullName, currentRole: p.currentRole, yearsExperience: p.totalExperienceYears, city: p.city, skills: p.skills.filter((s) => s.source !== "ai_derived").map((s) => s.name).slice(0, 25), preferences: p.preferences, status: p.status, completeness: p.completeness.score, missing: p.completeness.missing.map((m) => m.question), discoveryPaused: p.discoveryPaused } };
    },
  },
  {
    name: "update_preferences", description: "Change the user's job preferences (roles, locations, work modes, minimum salary in LPA, notice period, exclusions). Only use values the user stated.",
    args: '{"targetRoles"?:string[],"industries"?:string[],"workModes"?:("remote"|"hybrid"|"onsite")[],"locations"?:string[],"minSalaryLPA"?:number,"employmentTypes"?:("full_time"|"part_time"|"contract"|"internship")[],"noticePeriodDays"?:number,"willingToRelocate"?:boolean,"excludedCompanies"?:string[],"excludedKeywords"?:string[]}',
    permission: "modify", taintSensitive: true, schema: PreferencePatch,
    summarize: (a) => `Update preferences: ${Object.keys(a).join(", ")}`,
    async run({ uid }, args) {
      const before = await getProfile(uid);
      const p = await updatePreferences(uid, args, "user", "agent");
      await matchCandidate(uid).catch(() => undefined); // rescore with new preferences
      // Keep what was there so the user can undo from the chat.
      const keys = Object.keys(args);
      const previous = Object.fromEntries(keys.map((k) => [k, (before?.preferences as any)?.[k]]));
      const change = { id: `undo_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`, summary: describePreferenceChange(args) };
      await (await getStore()).put("agentUndo", change.id, { id: change.id, uid, keys, previous, summary: change.summary, expiresAt: new Date(Date.now() + UNDO_TTL_MS).toISOString() });
      return { data: { updated: keys, changed: change.summary, status: p.status, stillMissing: p.completeness.missing.filter((m) => m.essential).map((m) => m.question) }, change };
    },
  },
  {
    name: "get_profile_advice",
    description: "Data-backed ways to get more strong matches: skills that keep showing up as gaps in the user's good/fair matches (with job counts), cities that hold good-fit jobs, related roles with live job counts, and missing profile info. ALWAYS use this when the user asks how to improve their profile, get better/more matches, or why matches are weak.",
    args: "{}", permission: "read", schema: z.object({}).strict(),
    summarize: () => "Analyse how to improve matches",
    async run({ uid }) {
      const p = await getProfile(uid);
      if (!p) return { data: { error: "No profile yet. Ask the user to upload a resume." } };
      const summary = await feedSummary(uid);
      const feed = await getFeed(uid, { minScore: 50, limit: 500 });
      const gaps = new Map<string, number>();
      for (const { match } of feed) if (match.score < 80) for (const sk of match.missingSkills) gaps.set(sk, (gaps.get(sk) || 0) + 1);
      const skillGaps = [...gaps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([skill, jobs]) => ({ skill, missingInJobs: jobs }));
      return {
        data: {
          matches: { ...summary.bands, total: summary.total },
          skillGaps,
          skillNote: "Only suggest adding a skill if the user actually has it; otherwise suggest learning it.",
          diagnosis: summary.diagnosis.map((d) => ({ kind: d.kind, title: d.title, detail: d.detail })),
          relatedRoles: summary.roleSuggestions.slice(0, 4),
          preferences: { roles: p.preferences.targetRoles, cities: p.preferences.locations, workModes: p.preferences.workModes, minSalaryLPA: p.preferences.minSalaryLPA, relocate: p.preferences.willingToRelocate },
          stillMissing: p.completeness.missing.map((m) => m.question).slice(0, 3),
        },
      };
    },
  },
  {
    name: "search_jobs", description: "Search the user's matched job feed. Filters are optional. Returns scored jobs, best first.",
    args: '{"query"?:string,"location"?:string,"workMode"?:"remote"|"hybrid"|"onsite","minScore"?:number,"minSalaryLPA"?:number,"savedOnly"?:boolean,"limit"?:number}',
    permission: "read", schema: z.object({ query: z.string().max(100).optional(), location: z.string().max(60).optional(), workMode: z.enum(["remote", "hybrid", "onsite"]).optional(), minScore: z.number().min(0).max(100).optional(), minSalaryLPA: z.number().min(0).optional(), savedOnly: z.boolean().optional(), limit: z.number().int().min(1).max(15).optional() }).strict(),
    summarize: (a) => `Search jobs${a.query ? ` for "${a.query}"` : ""}`,
    async run({ uid }, a) {
      let feed = await getFeed(uid, { minScore: a.minScore ?? 40, limit: 200, savedOnly: a.savedOnly });
      if (!feed.length) {
        await matchCandidate(uid);
        feed = await getFeed(uid, { minScore: a.minScore ?? 40, limit: 200, savedOnly: a.savedOnly });
      }
      const q: string[] = String(a.query || "").toLowerCase().split(/\s+/).filter((w: string) => w.length > 1 && !["jobs", "job", "roles", "role", "in", "for", "the", "me", "find", "show"].includes(w));
      const locCities = a.location ? findIndianCities(a.location).map((c) => c.toLowerCase()) : [];
      const out = feed.filter(({ job }) => {
        const hay = `${job.title} ${job.company} ${job.skills.join(" ")}`.toLowerCase();
        if (q.length && !q.every((w) => hay.includes(w))) return false;
        if (a.location && /remote/i.test(a.location) && job.workMode !== "remote") return false;
        if (a.location && !/remote/i.test(a.location) && job.workMode !== "remote") {
          const c = job.city.toLowerCase();
          if (!(locCities.includes(c) || c.includes(a.location.toLowerCase()))) return false;
        }
        if (a.workMode && job.workMode !== a.workMode) return false;
        if (a.minSalaryLPA && !(job.salaryMaxLPA && job.salaryMaxLPA >= a.minSalaryLPA)) return false;
        return true;
      }).slice(0, a.limit ?? 6);
      return { data: { count: out.length, jobs: out.map(({ job, match }) => jobBrief(job, match)), note: out.length ? undefined : "No matching jobs in the feed yet. Suggest run_job_search to fetch fresh listings." }, cards: out.map(({ job, match }) => card(job, match)) };
    },
  },
  {
    name: "get_job_details", description: "Get details of one job (description text is external content).", args: '{"jobId":string}', permission: "read", schema: z.object({ jobId: Id }).strict(),
    summarize: () => "Read job details",
    async run({ uid }, { jobId }) {
      const job = await getJobForUser(uid, jobId);
      return { untrusted: true, data: { ...jobBrief(job), skills: job.skills, experience: job.experienceMin !== undefined ? `${job.experienceMin}${job.experienceMax ? `-${job.experienceMax}` : "+"} yrs` : "not stated", description: fenceUntrusted("job_posting", job.description, 3500), applyUrl: job.sources[0]?.applyUrl }, cards: [card(job)] };
    },
  },
  {
    name: "analyze_job_match", description: "Explain how well the user matches one job: score, matching skills, gaps, and confidence.", args: '{"jobId":string}', permission: "read", schema: z.object({ jobId: Id }).strict(),
    summarize: () => "Analyse job match",
    async run({ uid }, { jobId }) {
      const job = await getJobForUser(uid, jobId);
      let m = await explainMatch(uid, jobId);
      if (!m) {
        const p = await getProfile(uid);
        if (!p) throw new AppError(409, "Upload a resume first.");
        const store = await getStore();
        const now = new Date().toISOString();
        const calc = computeMatch({ profile: p, job });
        m = { ...calc, id: matchId(uid, jobId), uid, hidden: false, saved: false, notified: true, createdAt: now, updatedAt: now };
        await store.put("matches", m.id, m);
      }
      return { data: { job: jobBrief(job, m), score: m.score, confidence: m.confidence, breakdown: m.breakdown, matchedSkills: m.matchedSkills, missingSkills: m.missingSkills, why: m.reasons, gaps: m.gaps, assumptions: m.assumptions, summary: m.aiSummary }, cards: [card(job, m)] };
    },
  },
  {
    name: "save_job", description: "Save or unsave a job for later.", args: '{"jobId":string,"saved"?:boolean}', permission: "modify", schema: z.object({ jobId: Id, saved: z.boolean().optional() }).strict(),
    summarize: (a) => `${a.saved === false ? "Unsave" : "Save"} a job`,
    async run({ uid }, a) {
      const m = await setSaved(uid, a.jobId, a.saved ?? true);
      return { data: m ? { saved: m.saved } : { error: "Job isn't in your feed" } };
    },
  },
  {
    name: "hide_job", description: "Hide a job from the feed with a reason (not_relevant, not_interested, wrong_location, salary_too_low, wrong_role, skill_mismatch, company_not_preferred, already_applied).",
    args: '{"jobId":string,"reason":string}', permission: "modify",
    schema: z.object({ jobId: Id, reason: z.enum(["not_relevant", "already_applied", "not_interested", "wrong_location", "salary_too_low", "wrong_role", "skill_mismatch", "company_not_preferred"]) }).strict(),
    summarize: () => "Hide a job",
    async run({ uid }, a) {
      const m = await setFeedback(uid, a.jobId, a.reason as MatchFeedbackReason);
      return { data: m ? { hidden: true, reason: a.reason } : { error: "Job isn't in your feed" } };
    },
  },
  {
    name: "generate_tailored_resume", description: "Create a job-specific resume from the user's verified profile. It still needs the user's approval before use.", args: '{"jobId":string}', permission: "modify", schema: z.object({ jobId: Id }).strict(),
    summarize: () => "Generate tailored resume",
    async run({ uid }, { jobId }) {
      const p = await getProfile(uid);
      if (!p || p.status !== "ready") throw new AppError(409, "Complete your profile first.");
      const job = await getJobForUser(uid, jobId);
      const match = await (await getStore()).get<JobMatch>("matches", matchId(uid, jobId));
      const v = await generateTailoredResume(uid, p, job, match);
      return { data: { resumeVersionId: v.id, valid: v.validation.ok, generatedBy: v.generatedBy, warnings: v.validation.issues.map((i) => i.message).slice(0, 4), approved: v.approved, next: "Ask the user to review and approve it in the Resume screen." }, cards: [card(job)] };
    },
  },
  {
    name: "generate_cover_letter", description: "Write a cover letter for a job, grounded in the user's verified profile.", args: '{"jobId":string}', permission: "modify", schema: z.object({ jobId: Id }).strict(),
    summarize: () => "Generate cover letter",
    async run({ uid }, { jobId }) {
      const p = await getProfile(uid);
      if (!p) throw new AppError(409, "Upload a resume first.");
      const job = await getJobForUser(uid, jobId);
      const r = await generateCoverLetter(uid, p, job);
      return { data: { coverLetter: r.text, generatedBy: r.generatedBy } };
    },
  },
  {
    name: "prepare_application", description: "Prepare an application package (tailored resume + cover letter) for the user to review. Does NOT submit anything.", args: '{"jobId":string}', permission: "modify", schema: z.object({ jobId: Id }).strict(),
    summarize: () => "Prepare application",
    async run({ uid }, { jobId }) {
      const pkg = await prepareApplication(uid, jobId);
      return { data: { applicationId: pkg.application.id, resumeApproved: pkg.resume?.approved, resumeValid: pkg.resume?.validation.ok, willShare: pkg.willShare, nextStep: pkg.nextStep }, cards: [card(pkg.job, pkg.match || undefined)] };
    },
  },
  {
    name: "start_application", description: "Open the employer's application page so the user can apply. Requires the user's explicit confirmation.", args: '{"jobId":string}', permission: "sensitive", schema: z.object({ jobId: Id }).strict(),
    summarize: (a) => `Open the employer application page for job ${a.jobId} (shares nothing until you submit there)`,
    async run({ uid, confirmed }, { jobId }) {
      if (!confirmed) throw new AppError(403, "This action needs your confirmation.");
      const r = await startDirectApply(uid, jobId);
      return { data: { applicationId: r.application.id, applyUrl: r.applyUrl, note: "Opened the employer's page. Tell the user to come back and mark it as applied once they submit." }, openUrl: r.applyUrl };
    },
  },
  {
    name: "get_applications", description: "List the user's applications (optionally filter by status).", args: '{"status"?:string}', permission: "read", schema: z.object({ status: z.string().max(20).optional() }).strict(),
    summarize: () => "List applications",
    async run({ uid }, a) {
      const apps = (await listApplications(uid)).filter((x) => !a.status || x.status === a.status);
      return { data: { count: apps.length, applications: apps.slice(0, 15).map((x) => ({ id: x.id, company: x.company, role: x.role, status: x.status, appliedAt: x.appliedAt?.slice(0, 10), followUp: x.followUpAt?.slice(0, 10), interviews: x.interviewDates })) } };
    },
  },
  {
    name: "get_application_summary", description: "Summary of applications: totals, by status, and what was applied in the last N days.", args: '{"days"?:number}', permission: "read", schema: z.object({ days: z.number().int().min(1).max(365).optional() }).strict(),
    summarize: () => "Summarise applications",
    async run({ uid }, a) {
      return { data: await applicationSummary(uid, a.days ?? 7) };
    },
  },
  {
    name: "update_application_status", description: "Record an application status change the user told you about.", args: '{"applicationId":string,"status":string,"note"?:string,"interviewDate"?:string}', permission: "modify", taintSensitive: true,
    schema: z.object({ applicationId: Id, status: z.enum(Object.keys(APPLICATION_TRANSITIONS) as [ApplicationStatus, ...ApplicationStatus[]]), note: z.string().max(500).optional(), interviewDate: z.string().max(40).optional() }).strict(),
    summarize: (a) => `Set application status to ${a.status}`,
    async run({ uid }, a) {
      const r = await updateStatus(uid, a.applicationId, a.status, { note: a.note, interviewDate: a.interviewDate, actor: "agent" });
      return { data: { applicationId: r.id, status: r.status } };
    },
  },
  {
    name: "set_discovery_paused", description: "Pause or resume automatic job discovery and notifications.", args: '{"paused":boolean}', permission: "modify", taintSensitive: true, schema: z.object({ paused: z.boolean() }).strict(),
    summarize: (a) => (a.paused ? "Pause job discovery" : "Resume job discovery"),
    async run({ uid }, a) {
      await editProfile(uid, { discoveryPaused: a.paused });
      return { data: { discoveryPaused: a.paused } };
    },
  },
  {
    name: "run_job_search", description: "Fetch fresh jobs from all sources now and re-score them. Runs in the background (about a minute).", args: "{}", permission: "modify", schema: z.object({}).strict(),
    summarize: () => "Run a fresh job search",
    async run({ uid }) {
      const r = startBackgroundSearch(uid);
      await audit(uid, "search.manual", { started: r.started }, "agent");
      return { data: r.started ? { started: true, note: "Search started. The user will get a notification when it finishes." } : { started: false, retryInSeconds: r.retryInSeconds } };
    },
  },
  {
    name: "get_todays_summary", description: "Today's job-hunting summary: newly found jobs, strongest matches.", args: "{}", permission: "read", schema: z.object({}).strict(),
    summarize: () => "Today's summary",
    async run({ uid }) {
      const feed = await getFeed(uid, { minScore: 50, limit: 100 });
      const dayAgo = Date.now() - 86400000;
      const fresh = feed.filter((f) => new Date(f.match.createdAt).getTime() >= dayAgo);
      const top = feed.slice(0, 5);
      return { data: { newInLast24h: fresh.length, strong: feed.filter((f) => f.match.score >= 80).length, potential: feed.filter((f) => f.match.score >= 60 && f.match.score < 80).length, top: top.map(({ job, match }) => jobBrief(job, match)) }, cards: top.map(({ job, match }) => card(job, match)) };
    },
  },
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

export function toolCatalog(): string {
  return TOOLS.map((t) => `- ${t.name}(${t.args}) [${t.permission}] — ${t.description}`).join("\n");
}

export function isToolError(e: unknown): e is AppError | z.ZodError {
  return e instanceof AppError || e instanceof z.ZodError;
}
