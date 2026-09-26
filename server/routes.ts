import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { APPLICATION_TRANSITIONS, type AiUsageRecord, type ChatMessage, type CompanyAts, type JobQuery, type Job, type JobMatch, type ResumeRecord, type ResumeVersion, type TailoredResumeContent } from "../shared/types.js";
import { clearConversation, confirmPending, contextSuggestions, loadConversation, runAgent, saveConversation, saveFeedback, undoChange, type AgentEvent } from "./agent/agent.js";
import { startBackgroundSearch } from "./agent/tools.js";
import { aiAvailable, aiStatus, getUsage, generateJSON, AiQuotaError, AiUnavailableError } from "./ai/gateway.js";
import { KeyTestError, addPoolKey, countUserKeys, deleteUserKey, getUserKey, listPool, removePoolKey, retestPoolKey, saveUserKey, updatePoolKey } from "./ai/keys.js";
import { COMPAT_PRESETS } from "./ai/providers.js";
import { ConfigError } from "./ai/secrets.js";
import { configWarnings } from "./configCheck.js";
import { AppError, addNote, getApplication, getJobForUser, listApplications, prepareApplication, startDirectApply, updateStatus } from "./applications/service.js";
import { audit } from "./audit.js";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { getStore } from "./db/store.js";
import { discoveryHistory, isDiscoveryRunning, listConnectorHealth, regionOk, runDiscovery, setConnectorEnabled } from "./jobs/discovery.js";
import { DiscoverySettingsSchema, SOURCE_SETUP, discoverySettings, removeSourceKey, saveDiscoverySettings, saveSourceKey, type KeyedSource } from "./jobs/settings.js";
import { runCycle, schedulerState } from "./scheduler.js";
import { buildConnectors } from "./jobs/connectors.js";
import { detectAts } from "./jobs/detect.js";
import { REGISTRY_ATS, addCompany, autoDiscoverBoards, boardProblem, fetcherFor, listCompanies, removeCompany, updateCompany } from "./jobs/registry.js";
import { ingestRawJobs } from "./jobs/ingest.js";
import { rawJobFromDescription, rawJobFromUrl } from "./jobs/connectors.js";
import { UnsafeUrlError } from "./jobs/http.js";
import { analyzeJob, ensureMatch, explainMatch, getFeed, matchCandidate, matchId, setFeedback, setHidden, setSaved } from "./matching/service.js";
import { computeMatch } from "./matching/engine.js";
import { listNotifications, markRead } from "./notifications.js";
import { PreferencePatch } from "./profile/preferences.js";
import { answerProfileQuestion, editProfile, getOrCreateProfile, getProfile, updatePreferences, EDITABLE_SCALARS } from "./profile/service.js";
import { ResumeError } from "./resume/extract.js";
import { kickOffMatching, processResume, storeResume } from "./resume/process.js";
import { approveResumeVersion, generateCoverLetter, generateTailoredResume } from "./resume/tailor.js";
import { fenceUntrusted, UNTRUSTED_NOTICE } from "./nlp/text.js";
import { applicationSummary } from "./applications/service.js";
import { indexSize, searchJobs, suggest, syncJobs } from "./search/index.js";
import { RECOMMENDABLE } from "./jobs/normalize.js";
import { portalLinks } from "./search/portals.js";
import { feedSummary, markFeedSeen } from "./matching/feed.js";
import { publicSearch, publicStats } from "./public.js";
import { careerRouter } from "./career/routes.js";
import { companionRouter } from "./companion/routes.js";
import { interviewRouter } from "./interview/routes.js";

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => {
  fn(req, res).catch(next);
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

const byUser = rateLimit({ windowMs: 60_000, limit: config.userRateLimitPerMin, keyGenerator: (req) => req.user?.uid || req.ip || "anon", standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests. Please slow down." } });

const isAdmin = (req: Request) => Boolean(req.user?.email && config.adminEmails.includes(req.user.email.toLowerCase()));
const requireAdmin: RequestHandler = (req, res, next) => (isAdmin(req) ? next() : res.status(403).json({ error: "Admin only" }));

const mask = (p: any) => p; // profile is only ever returned to its owner

/** What the app can do with AI for this user, and how (their own key vs the shared pool). Never includes a key. */
async function aiSummary(uid: string) {
  const [own, pool] = await Promise.all([getUserKey(uid), aiStatus()]);
  return {
    available: await aiAvailable(uid),
    poolConfigured: pool.some((p) => p.configured),
    ownKey: own ? { last4: own.last4, status: own.status, lastError: own.lastError, addedAt: own.addedAt } : null,
  };
}

export function buildRouter(): express.Router {
  const r = express.Router();

  r.get("/health", wrap(async (_req, res) => {
    res.json({ status: "ok", time: new Date().toISOString(), ai: { configured: (await aiStatus()).some((p) => p.configured) }, warnings: configWarnings(), memoryMB: { rss: Math.round(process.memoryUsage().rss / 1048576), heap: Math.round(process.memoryUsage().heapUsed / 1048576) } });
  }));

  // ---- public (signed-out) endpoints for the landing page ----
  const publicLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many searches. Please wait a minute." } });
  r.get("/public/stats", wrap(async (_req, res) => res.json({ ...(await publicStats()), nextCheckAt: schedulerState().nextRunAt })));
  r.get("/public/search", publicLimit, wrap(async (req, res) => {
    const { q, city } = z.object({ q: z.string().trim().min(2).max(60), city: z.string().trim().max(40).optional() }).parse(req.query);
    res.json(await publicSearch(q, city || undefined));
  }));

  r.use(requireAuth);
  r.use(careerRouter());
  r.use(companionRouter());
  r.use(interviewRouter());

  // ---------------- account / profile ----------------
  r.get("/me", wrap(async (req, res) => {
    const user = req.user!;
    const profile = await getOrCreateProfile(user);
    const notifications = await listNotifications(user.uid, 50);
    res.json({
      user: { uid: user.uid, email: user.email, name: user.name, isAdmin: isAdmin(req) },
      profile: mask(profile), usage: await getUsage(user.uid), ai: await aiSummary(user.uid),
      unreadNotifications: notifications.filter((n) => !n.read).length,
    });
  }));

  r.get("/profile", wrap(async (req, res) => res.json({ profile: await getOrCreateProfile(req.user!) })));

  /** "Jobs updated 12 min ago · next check in 48 min" — so users know the data is fresh. */
  r.get("/sync-status", wrap(async (_req, res) => {
    const health = await (await getStore()).query<{ lastSuccessAt?: string }>("connectors");
    const s = schedulerState();
    res.json({ lastSyncAt: health.map((h) => h.lastSuccessAt).filter(Boolean).sort().pop() || null, nextRunAt: s.nextRunAt, paused: s.paused, running: s.running, liveJobs: await indexSize() });
  }));

  // ---- the user's own free Google AI Studio key ----
  r.get("/me/ai", wrap(async (req, res) => res.json({ ai: await aiSummary(req.user!.uid), usage: await getUsage(req.user!.uid) })));

  r.put("/me/ai-key", byUser, wrap(async (req, res) => {
    const { key } = z.object({ key: z.string().min(10).max(300) }).parse(req.body);
    try {
      await saveUserKey(req.user!.uid, key);
    } catch (e) {
      if (e instanceof KeyTestError) throw new AppError(422, e.message);
      throw e;
    }
    await audit(req.user!.uid, "ai.own_key_added", {});
    res.json({ ai: await aiSummary(req.user!.uid) });
  }));

  r.delete("/me/ai-key", wrap(async (req, res) => {
    await deleteUserKey(req.user!.uid);
    await audit(req.user!.uid, "ai.own_key_removed", {});
    res.json({ ai: await aiSummary(req.user!.uid) });
  }));

  r.patch("/profile", wrap(async (req, res) => {
    const body = z.object({
      scalars: z.record(z.enum(EDITABLE_SCALARS), z.string().max(1500)).optional(),
      addSkills: z.array(z.string().min(1).max(60)).max(30).optional(), removeSkills: z.array(z.string().min(1).max(60)).max(30).optional(),
      discoveryPaused: z.boolean().optional(), automationLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
      language: z.enum(["en", "hi"]).optional(), emailDigest: z.enum(["off", "daily", "weekly"]).optional(),
    }).strict().parse(req.body);
    await getOrCreateProfile(req.user!);
    const profile = await editProfile(req.user!.uid, body as any);
    if (body.addSkills || body.removeSkills) void matchCandidate(req.user!.uid).catch(() => undefined);
    res.json({ profile });
  }));

  r.put("/profile/preferences", wrap(async (req, res) => {
    await getOrCreateProfile(req.user!);
    const profile = await updatePreferences(req.user!.uid, PreferencePatch.parse(req.body), "user");
    if (profile.status === "ready") void kickOffMatching(req.user!.uid);
    res.json({ profile });
  }));

  r.post("/profile/answer", wrap(async (req, res) => {
    const { text } = z.object({ text: z.string().min(1).max(500) }).parse(req.body);
    await getOrCreateProfile(req.user!);
    const { profile, understood } = await answerProfileQuestion(req.user!.uid, text);
    if (profile.status === "ready" && Object.keys(understood).length) void kickOffMatching(req.user!.uid);
    res.json({ profile, understood, understoodAnything: Object.keys(understood).length > 0 });
  }));

  r.delete("/account", wrap(async (req, res) => {
    const uid = req.user!.uid;
    const store = await getStore();
    await deleteUserKey(uid);
    for (const col of ["resumes", "resumeVersions", "matches", "applications", "notifications", "aiUsage", "conversations", "pendingActions"] as const) {
      const rows = await store.query<{ id?: string; uid?: string }>(col, { where: { uid } });
      for (const row of rows) if (row.id) await store.del(col, row.id);
    }
    const ownedJobs = await store.query<Job>("jobs", { where: { ownerUid: uid } });
    for (const j of ownedJobs) await store.del("jobs", j.id);
    await syncJobs(ownedJobs.map((j) => j.id));
    await store.del("conversations", uid);
    await store.del("profiles", uid);
    await audit(uid, "account.deleted", {});
    res.json({ deleted: true });
  }));

  // ---------------- resumes ----------------
  r.post("/resume", byUser, upload.single("resume"), wrap(async (req, res) => {
    if (!req.file) throw new AppError(400, "Attach your resume in the 'resume' field.");
    await getOrCreateProfile(req.user!);
    const { resume, duplicate } = await storeResume(req.user!, req.file);
    const profile = await getProfile(req.user!.uid);
    if (duplicate && profile?.resumeId === resume.id && profile.status !== "parsing")
      return res.json({ duplicate: true, resumeId: resume.id, profile, message: "You've already uploaded this resume." });
    void processResume(req.user!, resume).catch(() => undefined);
    res.status(202).json({ resumeId: resume.id, status: "parsing", message: "Analyzing your resume…" });
  }));

  r.post("/resume/text", byUser, wrap(async (req, res) => {
    const { text } = z.object({ text: z.string().min(150).max(60000) }).parse(req.body);
    const buf = Buffer.from(text, "utf8");
    await getOrCreateProfile(req.user!);
    const { resume } = await storeResume(req.user!, { buffer: buf, originalname: "pasted-resume.txt", mimetype: "text/plain" });
    void processResume(req.user!, resume).catch(() => undefined);
    res.status(202).json({ resumeId: resume.id, status: "parsing" });
  }));

  r.get("/resumes", wrap(async (req, res) => {
    const store = await getStore();
    const originals = (await store.query<ResumeRecord>("resumes", { where: { uid: req.user!.uid } })).map(({ text: _t, ...rest }) => rest);
    const versions = (await store.query<ResumeVersion>("resumeVersions", { where: { uid: req.user!.uid } })).map(({ text: _t, ...rest }) => rest);
    res.json({ originals: originals.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), versions: versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  }));

  r.delete("/resumes/:id", wrap(async (req, res) => {
    const store = await getStore();
    const rec = await store.get<ResumeRecord>("resumes", req.params.id);
    if (!rec || rec.uid !== req.user!.uid) throw new AppError(404, "Resume not found");
    await store.del("resumes", rec.id);
    await audit(req.user!.uid, "resume.deleted", { resumeId: rec.id });
    res.json({ deleted: true });
  }));

  r.get("/resume-versions/:id", wrap(async (req, res) => {
    const v = await (await getStore()).get<ResumeVersion>("resumeVersions", req.params.id);
    if (!v || v.uid !== req.user!.uid) throw new AppError(404, "Resume not found");
    res.json({ version: v });
  }));

  const TailoredSchema: z.ZodType<TailoredResumeContent> = z.object({
    headline: z.string().max(160), summary: z.string().max(1500),
    experience: z.array(z.object({ experienceId: z.string(), company: z.string(), designation: z.string(), period: z.string(), bullets: z.array(z.string().max(500)).max(10) })).max(15),
    skills: z.array(z.string().max(60)).max(40),
    education: z.array(z.object({ degree: z.string(), institution: z.string(), gradYear: z.string().optional() })).max(10),
    fit: z.array(z.string().max(300)).max(6).optional(),
    certifications: z.array(z.string()).max(20), projects: z.array(z.object({ title: z.string(), description: z.string().max(800) })).max(6),
  });

  r.post("/resume-versions/:id/approve", wrap(async (req, res) => {
    const { content } = z.object({ content: TailoredSchema.optional() }).parse(req.body || {});
    const v = await approveResumeVersion(req.user!.uid, req.params.id, content);
    if (!v) throw new AppError(404, "Resume not found");
    res.status(v.approved ? 200 : 422).json({ version: v, approved: v.approved });
  }));

  r.delete("/resume-versions/:id", wrap(async (req, res) => {
    const store = await getStore();
    const v = await store.get<ResumeVersion>("resumeVersions", req.params.id);
    if (!v || v.uid !== req.user!.uid) throw new AppError(404, "Resume not found");
    await store.del("resumeVersions", v.id);
    res.json({ deleted: true });
  }));

  // ---------------- feed & jobs ----------------
  r.get("/feed", wrap(async (req, res) => {
    const minScore = req.query.minScore !== undefined ? Number(req.query.minScore) : 50;
    const savedOnly = req.query.saved === "true";
    const items = await getFeed(req.user!.uid, { minScore: Number.isFinite(minScore) ? minScore : 50, limit: 60, savedOnly });
    const profile = await getProfile(req.user!.uid);
    res.json({
      items: items.map(({ match, job }) => ({ match, job: { ...job, description: job.description.slice(0, 500) } })),
      profileStatus: profile?.status || "empty", discoveryPaused: profile?.discoveryPaused || false,
    });
  }));

  // ---- job search (must come before /jobs/:id) ----
  const csv = <T extends string>(schema: z.ZodType<T>) => z.string().max(400).transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)).pipe(z.array(schema).max(20));
  const SearchQuery = z.object({
    q: z.string().max(120).optional(),
    cities: csv(z.string().max(60)).optional(), strictCity: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    workModes: csv(z.enum(["remote", "hybrid", "onsite", "unknown"])).optional(),
    employmentTypes: csv(z.enum(["full_time", "part_time", "contract", "internship", "unknown"])).optional(),
    categories: csv(z.string().max(40)).optional(), companies: csv(z.string().max(120)).optional(),
    experienceYears: z.coerce.number().min(0).max(50).optional(), minSalaryLPA: z.coerce.number().min(0).max(1000).optional(),
    maxEducation: z.enum(["none", "10th", "12th", "iti", "diploma", "graduate", "postgraduate"]).optional(),
    freshersOnly: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    postedWithinDays: z.coerce.number().int().min(1).max(365).optional(),
    sort: z.enum(["match", "relevance", "newest", "salary"]).optional(),
    matchedOnly: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    savedOnly: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    minScore: z.coerce.number().min(0).max(100).optional(), maxScore: z.coerce.number().min(0).max(100).optional(),
    page: z.coerce.number().int().min(1).max(100).optional(), pageSize: z.coerce.number().int().min(1).max(50).optional(),
  });

  /** Honest totals per score band, what's new, and why there are few strong matches (with fixes). */
  r.get("/feed/summary", wrap(async (req, res) => res.json(await feedSummary(req.user!.uid))));
  r.post("/feed/seen", wrap(async (req, res) => { await markFeedSeen(req.user!.uid); res.json({ ok: true }); }));

  r.get("/jobs/search", wrap(async (req, res) => {
    const q = SearchQuery.parse(req.query) as JobQuery;
    res.json(await searchJobs(req.user!.uid, q));
  }));

  r.get("/jobs/suggest", wrap(async (req, res) => {
    const { q } = z.object({ q: z.string().max(80).default("") }).parse(req.query);
    res.json({ suggestions: await suggest(req.user!.uid, q) });
  }));

  /** Pre-filled searches on the big portals, from the query or the user's profile. */
  r.get("/portal-links", wrap(async (req, res) => {
    const { role, city } = z.object({ role: z.string().max(80).optional(), city: z.string().max(60).optional() }).parse(req.query);
    const p = await getProfile(req.user!.uid);
    res.json({
      links: portalLinks({
        role: role || p?.preferences.targetRoles[0] || p?.currentRole || "jobs",
        city: city ?? p?.preferences.locations[0] ?? p?.city, experienceYears: p?.totalExperienceYears,
      }),
    });
  }));

  r.get("/jobs/:id", wrap(async (req, res) => {
    const uid = req.user!.uid;
    const job = await getJobForUser(uid, req.params.id);
    const match = await ensureMatch(uid, job);
    const application = (await listApplications(uid)).find((a) => a.jobId === job.id) || null;
    res.json({ job, match, application });
  }));

  /** Other open roles at the same company, and similar roles elsewhere. */
  r.get("/jobs/:id/related", wrap(async (req, res) => {
    const uid = req.user!.uid;
    const job = await getJobForUser(uid, req.params.id);
    const [company, similar] = await Promise.all([
      searchJobs(uid, { companies: [job.company], sort: "match", pageSize: 7 }),
      searchJobs(uid, { q: job.title, categories: job.category ? [job.category] : undefined, sort: "match", pageSize: 12 }),
    ]);
    res.json({
      sameCompany: company.hits.filter((h) => h.job.id !== job.id).slice(0, 6),
      similar: similar.hits.filter((h) => h.job.id !== job.id && h.job.companyKey !== job.companyKey).slice(0, 6),
    });
  }));

  r.post("/jobs/:id/explain", byUser, wrap(async (req, res) => {
    const uid = req.user!.uid;
    await getJobForUser(uid, req.params.id);
    const job = await getJobForUser(uid, req.params.id);
    if (!job.intelligence || job.intelligence.analyzedBy !== "ai") {
      await analyzeJob(job);
      await matchCandidate(uid, { jobIds: [job.id] });
    }
    const match = await explainMatch(uid, req.params.id);
    if (!match) throw new AppError(404, "No match found for this job");
    res.json({ match });
  }));

  r.post("/jobs/:id/save", wrap(async (req, res) => {
    const { saved } = z.object({ saved: z.boolean().default(true) }).parse(req.body || {});
    if (!(await ensureMatch(req.user!.uid, await getJobForUser(req.user!.uid, req.params.id)))) throw new AppError(409, "Finish your profile first so I can score this job for you.");
    const m = await setSaved(req.user!.uid, req.params.id, saved);
    if (!m) throw new AppError(404, "Job not found");
    res.json({ match: m });
  }));

  r.post("/jobs/:id/hide", wrap(async (req, res) => {
    const { reason } = z.object({ reason: z.enum(["not_relevant", "already_applied", "not_interested", "wrong_location", "salary_too_low", "wrong_role", "skill_mismatch", "company_not_preferred"]).optional() }).parse(req.body || {});
    const m = reason ? await setFeedback(req.user!.uid, req.params.id, reason) : await setHidden(req.user!.uid, req.params.id, true);
    if (!m) throw new AppError(404, "Job not in your feed");
    res.json({ match: m });
  }));

  r.post("/jobs/import", byUser, wrap(async (req, res) => {
    const uid = req.user!.uid;
    const body = z.object({
      url: z.string().url().max(600).optional(), description: z.string().min(80).max(30000).optional(),
      title: z.string().max(160).optional(), company: z.string().max(120).optional(), location: z.string().max(120).optional(),
    }).refine((b) => b.url || b.description, "Provide a job URL or paste the job description.").parse(req.body);
    const profile = await getProfile(uid);
    if (!profile || profile.status !== "ready") throw new AppError(409, "Finish your profile first so I can score this job for you.");

    let raw = body.description ? rawJobFromDescription({ ...body, description: body.description }) : null;
    if (!raw && body.url) {
      let fetched;
      try { fetched = await rawJobFromUrl(body.url); } catch (e: any) {
        if (e instanceof UnsafeUrlError) throw new AppError(400, e.message);
        throw new AppError(422, `I couldn't open that link (${String(e.message).slice(0, 100)}). Paste the job description instead.`);
      }
      if (fetched.raw) raw = fetched.raw;
      else if (fetched.needsAi) {
        const Extract = z.object({ title: z.string().catch(""), company: z.string().catch(""), location: z.string().catch(""), description: z.string().catch("") });
        try {
          const x = await generateJSON({
            task: "job_analyze", uid, schema: Extract, maxTokens: 2500,
            system: `You extract a single job posting from web page text. ${UNTRUSTED_NOTICE}`,
            prompt: `Return {"title","company","location","description"} for the job on this page. Use "" if not present; never invent.\n${fenceUntrusted("web_page", fetched.needsAi.text, 9000)}`,
          });
          raw = rawJobFromDescription({ title: x.title || body.title || fetched.needsAi.title, company: x.company || body.company, location: x.location || body.location, description: x.description, url: fetched.needsAi.url });
          raw.connector = "user_url";
          raw.sourceName = new URL(fetched.needsAi.url).hostname;
        } catch (e) {
          if (e instanceof AiQuotaError || e instanceof AiUnavailableError) throw new AppError(503, "I couldn't read that page automatically. Please paste the job description instead.");
          throw new AppError(422, "I couldn't find a job posting on that page. Please paste the description instead.");
        }
      }
    }
    if (!raw) throw new AppError(422, "Couldn't read that job.");
    raw.title ||= body.title || "";
    raw.company ||= body.company || "";
    if (!raw.company) throw new AppError(422, "I couldn't work out the company. Add it and try again.");
    const stats = await ingestRawJobs([raw], { ownerUid: uid });
    void autoDiscoverBoards(stats.jobIds).catch(() => undefined); // a pasted link may reveal a company board we don't read yet
    if (!stats.jobIds.length) throw new AppError(422, `That job couldn't be added (${Object.keys(stats.rejectReasons)[0]?.replace(/_/g, " ") || "invalid"}).`);
    await matchCandidate(uid, { jobIds: stats.jobIds });
    const job = await getJobForUser(uid, stats.jobIds[0]);
    await analyzeJob(job);
    await matchCandidate(uid, { jobIds: stats.jobIds });
    const match = await (await getStore()).get<JobMatch>("matches", matchId(uid, job.id));
    await audit(uid, "job.imported", { jobId: job.id });
    res.status(201).json({ job, match });
  }));

  // ---------------- tailored resume + application ----------------
  r.post("/jobs/:id/tailor", byUser, wrap(async (req, res) => {
    const uid = req.user!.uid;
    const profile = await getProfile(uid);
    if (!profile || profile.status !== "ready") throw new AppError(409, "Complete your profile first.");
    const job = await getJobForUser(uid, req.params.id);
    const match = await (await getStore()).get<JobMatch>("matches", matchId(uid, job.id));
    res.status(201).json({ version: await generateTailoredResume(uid, profile, job, match) });
  }));

  r.post("/jobs/:id/cover-letter", byUser, wrap(async (req, res) => {
    const uid = req.user!.uid;
    const profile = await getProfile(uid);
    if (!profile) throw new AppError(409, "Upload a resume first.");
    const job = await getJobForUser(uid, req.params.id);
    res.json(await generateCoverLetter(uid, profile, job));
  }));

  r.post("/jobs/:id/prepare", byUser, wrap(async (req, res) => {
    const { regenerate } = z.object({ regenerate: z.boolean().optional() }).parse(req.body || {});
    res.status(201).json(await prepareApplication(req.user!.uid, req.params.id, { regenerate }));
  }));

  r.post("/jobs/:id/direct-apply", wrap(async (req, res) => {
    const { confirm } = z.object({ confirm: z.literal(true) }).parse(req.body || {});
    void confirm;
    res.json(await startDirectApply(req.user!.uid, req.params.id));
  }));

  r.get("/applications", wrap(async (req, res) => res.json({ applications: await listApplications(req.user!.uid), summary: await applicationSummary(req.user!.uid, 7) })));
  r.get("/applications/:id", wrap(async (req, res) => {
    const application = await getApplication(req.user!.uid, req.params.id);
    const store = await getStore();
    res.json({ application, job: await store.get<Job>("jobs", application.jobId), resume: application.resumeVersionId ? await store.get<ResumeVersion>("resumeVersions", application.resumeVersionId) : null });
  }));
  r.post("/applications/:id/status", wrap(async (req, res) => {
    const body = z.object({ status: z.enum(Object.keys(APPLICATION_TRANSITIONS) as [keyof typeof APPLICATION_TRANSITIONS, ...(keyof typeof APPLICATION_TRANSITIONS)[]]), note: z.string().max(500).optional(), interviewDate: z.string().max(40).optional(), followUpAt: z.string().max(40).optional() }).parse(req.body);
    res.json({ application: await updateStatus(req.user!.uid, req.params.id, body.status, { note: body.note, interviewDate: body.interviewDate, followUpAt: body.followUpAt }) });
  }));
  r.post("/applications/:id/note", wrap(async (req, res) => {
    const { note } = z.object({ note: z.string().min(1).max(1000) }).parse(req.body);
    res.json({ application: await addNote(req.user!.uid, req.params.id, note) });
  }));

  // ---------------- notifications & search ----------------
  r.get("/notifications", wrap(async (req, res) => res.json({ notifications: await listNotifications(req.user!.uid) })));
  r.post("/notifications/read", wrap(async (req, res) => {
    const { id } = z.object({ id: z.string().optional() }).parse(req.body || {});
    res.json({ marked: await markRead(req.user!.uid, id) });
  }));
  r.post("/search", byUser, wrap(async (req, res) => {
    const profile = await getProfile(req.user!.uid);
    if (!profile || profile.status !== "ready") throw new AppError(409, "Finish your profile before searching.");
    res.json(startBackgroundSearch(req.user!.uid));
  }));

  // ---------------- AI agent ----------------
  const ChatBody = z.object({
    message: z.string().trim().min(1).max(1500),
    context: z.object({ page: z.string().max(30).optional(), jobId: z.string().max(80).optional() }).strict().optional(),
    /** Answer the last question again, replacing the previous answer. */
    regenerate: z.boolean().optional(),
  });
  /** Run one assistant turn and store both sides of it. */
  const chatTurn = async (req: Request, opts: { onEvent?: (e: AgentEvent) => void; signal?: AbortSignal } = {}) => {
    const uid = req.user!.uid;
    const { message, context, regenerate } = ChatBody.parse(req.body);
    await getOrCreateProfile(req.user!);
    let history = await loadConversation(uid);
    const [q, a] = history.slice(-2);
    if (regenerate && q?.role === "user" && a?.role === "assistant" && q.text === message) history = history.slice(0, -2);
    const out = await runAgent(uid, message, history, { context, ...opts });
    const now = new Date().toISOString();
    const assistant: ChatMessage = {
      id: out.id, role: "assistant", text: out.reply, at: now, cards: out.cards.length ? out.cards : undefined, pendingAction: out.pendingAction,
      steps: out.steps.length ? out.steps : undefined, changes: out.changes.length ? out.changes : undefined, suggestions: out.suggestions.length ? out.suggestions : undefined,
    };
    await saveConversation(uid, [...history, { id: `${out.id}_q`, role: "user", text: message, at: now }, assistant]);
    return out;
  };

  r.post("/agent/chat", byUser, wrap(async (req, res) => res.json(await chatTurn(req))));

  /** Same turn as /agent/chat, streamed as server-sent events: step → delta… → done (or error). */
  r.post("/agent/chat/stream", byUser, wrap(async (req, res) => {
    ChatBody.parse(req.body); // fail fast with a normal 400 before switching to a stream
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const send = (event: string, data: unknown) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    try {
      const out = await chatTurn(req, { onEvent: (e) => send(e.type, e), signal: abort.signal });
      send("done", out);
    } catch (err: any) {
      send("error", { error: err instanceof AppError || err instanceof z.ZodError ? String(err.message).slice(0, 200) : "Something went wrong. Please try again." });
      if (!(err instanceof AppError)) console.warn("[agent] stream failed", err);
    }
    res.end();
  }));

  r.get("/agent/history", wrap(async (req, res) => res.json({ messages: await loadConversation(req.user!.uid) })));
  r.delete("/agent/history", wrap(async (req, res) => { await clearConversation(req.user!.uid); res.json({ ok: true }); }));

  r.get("/agent/starters", wrap(async (req, res) => {
    const { page, jobId } = z.object({ page: z.string().max(30).optional(), jobId: z.string().max(80).optional() }).parse(req.query);
    res.json({ suggestions: contextSuggestions({ page, jobId }) });
  }));

  r.post("/agent/undo", wrap(async (req, res) => {
    const { changeId } = z.object({ changeId: z.string().min(3).max(80) }).parse(req.body);
    res.json(await undoChange(req.user!.uid, changeId));
  }));

  r.post("/agent/feedback", wrap(async (req, res) => {
    const { messageId, rating, reason } = z.object({ messageId: z.string().min(3).max(80), rating: z.enum(["up", "down"]), reason: z.string().max(200).optional() }).parse(req.body);
    await saveFeedback(req.user!.uid, messageId, rating, reason);
    res.json({ ok: true });
  }));

  r.post("/agent/confirm", wrap(async (req, res) => {
    const { actionId, approve } = z.object({ actionId: z.string().min(3).max(80), approve: z.boolean() }).parse(req.body);
    res.json(await confirmPending(req.user!.uid, actionId, approve));
  }));

  // ---------------- admin ----------------
  r.get("/admin/connectors", requireAdmin, wrap(async (_req, res) => res.json({ connectors: await listConnectorHealth() })));
  r.post("/admin/connectors/:id/toggle", requireAdmin, wrap(async (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const h = await setConnectorEnabled(req.params.id, enabled);
    if (!h) throw new AppError(404, "Unknown connector");
    res.json({ connector: h });
  }));
  // ---- discovery control (schedule, pace, per-source keys, history) ----
  r.get("/admin/discovery", requireAdmin, wrap(async (_req, res) => {
    const companies = await listCompanies();
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    res.json({
      settings: discoverySettings(), state: schedulerState(), history: await discoveryHistory(), connectors: await listConnectorHealth(),
      registry: {
        total: companies.length, byOrigin: companies.reduce<Record<string, number>>((m, c) => ({ ...m, [c.origin]: (m[c.origin] || 0) + 1 }), {}),
        autoAddedThisWeek: companies.filter((c) => c.origin === "auto" && c.createdAt >= weekAgo).length,
        failing: companies.filter((c) => c.lastError).length,
      },
    });
  }));

  r.put("/admin/discovery/settings", requireAdmin, wrap(async (req, res) => {
    const patch = DiscoverySettingsSchema.partial().strict().parse(req.body);
    const settings = await saveDiscoverySettings(patch);
    await audit(req.user!.uid, "admin.discovery_settings", { keys: Object.keys(patch) });
    res.json({ settings, state: schedulerState() });
  }));

  /** Runs in the background (a full run takes minutes); poll GET /admin/discovery for progress. */
  r.post("/admin/discovery/run", requireAdmin, wrap(async (req, res) => {
    const { connectorIds } = z.object({ connectorIds: z.array(z.string().max(40)).max(30).optional() }).parse(req.body || {});
    if (isDiscoveryRunning()) return res.status(202).json({ started: false, running: true, message: "A run is already in progress." });
    void (connectorIds?.length ? runDiscovery({ connectorIds, trigger: "admin" }) : runCycle("admin")).catch((e) => console.error("[admin] run failed", e));
    res.status(202).json({ started: true, running: true });
  }));

  r.put("/admin/sources/:id/key", requireAdmin, wrap(async (req, res) => {
    const id = z.enum(["adzuna", "careerjet", "jooble"]).parse(req.params.id) as KeyedSource;
    const values = z.record(z.string().max(40), z.string().trim().min(1).max(400)).parse(req.body);
    const missing = SOURCE_SETUP[id].fields.filter((f) => !values[f.id]).map((f) => f.label);
    if (missing.length) throw new AppError(400, `Please fill in: ${missing.join(", ")}`);
    await saveSourceKey(id, values);
    // Prove the key works with one small real search before keeping it.
    const connector = buildConnectors().find((c) => c.id === id);
    try {
      const jobs = await Promise.race([connector!.fetch({ keywords: ["project manager"] }), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timed out")), 45_000))]);
      await audit(req.user!.uid, "admin.source_key_added", { source: id });
      res.json({ ok: true, sample: jobs.length, connectors: await listConnectorHealth() });
    } catch (e: any) {
      await removeSourceKey(id);
      throw new AppError(422, `That key didn't work: ${String(e?.message || e).slice(0, 160)}`);
    }
  }));

  r.delete("/admin/sources/:id/key", requireAdmin, wrap(async (req, res) => {
    const id = z.enum(["adzuna", "careerjet", "jooble"]).parse(req.params.id) as KeyedSource;
    await removeSourceKey(id);
    res.json({ connectors: await listConnectorHealth() });
  }));

  // ---- AI setup (owner's shared pool) ----
  r.get("/admin/ai", requireAdmin, wrap(async (_req, res) => {
    const store = await getStore();
    const today = new Date().toISOString().slice(0, 10);
    const usage = (await store.query<AiUsageRecord>("aiUsage")).filter((u) => u.date === today);
    res.json({
      keys: await listPool(), status: await aiStatus(), presets: COMPAT_PRESETS, usersWithOwnKey: await countUserKeys(),
      today: {
        activeUsers: usage.filter((u) => u.uid !== "system").length, poolCredits: usage.reduce((s, u) => s + u.creditsUsed, 0),
        poolRequests: usage.reduce((s, u) => s + u.requests, 0), ownKeyRequests: usage.reduce((s, u) => s + (u.ownKeyRequests || 0), 0),
      },
      dailyCreditsPerUser: config.dailyAiCredits,
    });
  }));

  r.post("/admin/ai/keys", requireAdmin, wrap(async (req, res) => {
    const body = z.object({
      kind: z.enum(["gemini", "compat"]), key: z.string().min(10).max(300), label: z.string().max(60).optional(),
      preset: z.enum(Object.keys(COMPAT_PRESETS) as [string, ...string[]]).optional(), baseUrl: z.string().url().max(200).optional(), model: z.string().max(120).optional(),
    }).parse(req.body);
    try {
      const key = await addPoolKey(body);
      await audit(req.user!.uid, "admin.ai_key_added", { kind: body.kind, id: key.id });
      res.status(201).json({ key });
    } catch (e) {
      if (e instanceof KeyTestError) throw new AppError(422, e.message);
      throw e;
    }
  }));

  r.post("/admin/ai/keys/:id/test", requireAdmin, wrap(async (req, res) => {
    try { res.json({ key: await retestPoolKey(req.params.id) }); } catch (e) {
      if (e instanceof KeyTestError) throw new AppError(404, e.message);
      throw e;
    }
  }));

  r.patch("/admin/ai/keys/:id", requireAdmin, wrap(async (req, res) => {
    const patch = z.object({ enabled: z.boolean().optional(), label: z.string().max(60).optional() }).strict().parse(req.body);
    if (!(await updatePoolKey(req.params.id, patch))) throw new AppError(404, "Key not found");
    res.json({ keys: await listPool() });
  }));

  r.delete("/admin/ai/keys/:id", requireAdmin, wrap(async (req, res) => {
    if (!(await removePoolKey(req.params.id))) throw new AppError(404, "Key not found");
    await audit(req.user!.uid, "admin.ai_key_removed", { id: req.params.id });
    res.json({ keys: await listPool() });
  }));

  // ---- company registry ----
  const AtsEnum = z.enum(REGISTRY_ATS as [CompanyAts, ...CompanyAts[]]);
  r.get("/admin/companies", requireAdmin, wrap(async (_req, res) => res.json({ companies: await listCompanies() })));

  /** Detect the careers system behind a URL and preview a few of its jobs, without saving anything. */
  r.post("/admin/companies/detect", requireAdmin, wrap(async (req, res) => {
    const { url } = z.object({ url: z.string().url().max(600) }).parse(req.body);
    let detection;
    try { detection = await detectAts(url); } catch (e: any) {
      if (e instanceof UnsafeUrlError) throw new AppError(400, e.message);
      throw new AppError(422, `Couldn't open that page (${String(e.message).slice(0, 100)}).`);
    }
    if (!detection.ats) return res.json({ detection, preview: null });
    const preview = await fetcherFor(detection.ats)(detection.board).then(
      (jobs) => ({ total: jobs.length, india: jobs.filter(regionOk).length, sample: jobs.filter(regionOk).slice(0, 5).map((j) => ({ title: j.title, location: j.location })) }),
      (e) => ({ total: 0, india: 0, sample: [], error: String(e?.message || e).slice(0, 160) }),
    );
    res.json({ detection, preview });
  }));

  r.post("/admin/companies", requireAdmin, wrap(async (req, res) => {
    const body = z.object({
      name: z.string().min(1).max(120), ats: AtsEnum, board: z.string().min(1).max(300),
      careersUrl: z.string().url().max(600).optional(), industries: z.array(z.string().max(40)).max(5).optional(),
    }).parse(req.body);
    const problem = boardProblem(body.ats, body.board);
    if (problem) throw new AppError(400, problem);
    const { company, created } = await addCompany(body);
    await audit(req.user!.uid, "admin.company_added", { companyId: company.id, ats: company.ats });
    res.status(created ? 201 : 200).json({ company, created });
  }));

  r.patch("/admin/companies/:id", requireAdmin, wrap(async (req, res) => {
    const patch = z.object({ enabled: z.boolean().optional(), name: z.string().min(1).max(120).optional(), industries: z.array(z.string().max(40)).max(5).optional() }).strict().parse(req.body);
    const company = await updateCompany(req.params.id, patch);
    if (!company) throw new AppError(404, "Company not found");
    res.json({ company });
  }));

  r.delete("/admin/companies/:id", requireAdmin, wrap(async (req, res) => {
    await removeCompany(req.params.id);
    await audit(req.user!.uid, "admin.company_removed", { companyId: req.params.id });
    res.json({ deleted: true });
  }));
  r.get("/admin/stats", requireAdmin, wrap(async (_req, res) => {
    const store = await getStore();
    const jobs = await store.query<Job>("jobs", { readOnly: true });
    const byStatus: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const byCity: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const add = (m: Record<string, number>, k: string) => { m[k] = (m[k] || 0) + 1; };
    for (const j of jobs) {
      add(byStatus, j.status);
      if (j.ownerUid || !RECOMMENDABLE.includes(j.status)) continue;
      for (const s of new Set(j.sources.map((x) => x.connector))) add(bySource, s);
      for (const c of j.cities?.length ? j.cities : [j.panIndia ? "Pan India" : j.workMode === "remote" ? "Remote" : j.city || "Unknown"]) add(byCity, c);
      add(byCategory, j.category || "other");
    }
    const top = (m: Record<string, number>, n = 15) => Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n));
    res.json({
      liveJobs: jobs.filter((j) => !j.ownerUid && RECOMMENDABLE.includes(j.status)).length, searchIndex: await indexSize(),
      jobsBySource: top(bySource, 30), jobsByCity: top(byCity), jobsByCategory: top(byCategory, 30), companies: (await listCompanies()).length,
      users: (await store.query("profiles")).length, jobs: jobs.length, jobsByStatus: byStatus, suspicious: jobs.filter((j) => j.quality.suspicious).length,
      applications: (await store.query("applications")).length, ai: await aiStatus(), store: store.kind,
    });
  }));

  return r;
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
  if (err instanceof ResumeError) return res.status(err.code === "too_large" ? 413 : 422).json({ error: err.message, code: err.code });
  if (err instanceof z.ZodError) return res.status(400).json({ error: "Invalid request", details: err.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) });
  if (err instanceof multer.MulterError) return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "File is too large (max 8 MB)." : "Upload failed." });
  if (err instanceof AiQuotaError) return res.status(429).json({ error: "You've used today's AI credits. Non-AI features still work; credits reset tomorrow.", code: "ai_quota" });
  if (err instanceof AiUnavailableError) return res.status(503).json({ error: "AI is temporarily unavailable. Please try again shortly.", code: "ai_unavailable" });
  if (err instanceof ConfigError) { console.error("[config]", err.message); return res.status(503).json({ error: err.message, code: "server_config" }); }
  // body-parser and friends signal client mistakes (bad JSON, payload too large) with a 4xx status.
  if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 500)
    return res.status(err.status).json({ error: err.type === "entity.too.large" ? "Request is too large." : err.type === "entity.parse.failed" ? "Invalid JSON in request body." : "Bad request." });
  console.error("[error]", err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
}
