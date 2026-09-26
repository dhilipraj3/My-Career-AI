// Routes for the employer side (Phase 4.3), the candidate's direct-apply and reporting, and the admin moderation queue.
import express, { type Request, type RequestHandler, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { REPORT_REASONS } from "../../shared/employer.js";
import { config } from "../config.js";
import { getStore } from "../db/store.js";
import type { Job } from "../../shared/types.js";
import {
  PostBody, RegisterBody, SHARED_FIELDS, applyDirect, candidatesFor, closeJob, decideEmployer, decideJob, draftPosting, getEmployer, listEmployerJobs, moderationQueue,
  postJob, registerEmployer, reportJob, setApplicantStatus,
} from "./service.js";

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => { fn(req, res).catch(next); };
const limit = rateLimit({ windowMs: 60_000, limit: 20, keyGenerator: (req) => req.user?.uid || req.ip || "anon", standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests. Please slow down." } });
const isAdmin = (req: Request) => Boolean(req.user?.email && config.adminEmails.includes(req.user.email.toLowerCase()));
const requireAdmin: RequestHandler = (req, res, next) => (isAdmin(req) ? next() : res.status(403).json({ error: "Admin only" }));

export function employerRouter(): express.Router {
  const r = express.Router();

  // ---- employer account & postings ----
  r.get("/employer/me", wrap(async (req, res) => {
    const employer = await getEmployer(req.user!.uid);
    res.json({ employer, jobs: employer ? await listEmployerJobs(req.user!.uid) : [] });
  }));
  r.post("/employer/register", limit, wrap(async (req, res) => res.status(201).json({ employer: await registerEmployer(req.user!, RegisterBody.parse(req.body)) })));
  r.post("/employer/draft", limit, wrap(async (req, res) => {
    const { text } = z.object({ text: z.string().trim().min(20).max(6000) }).parse(req.body);
    res.json(await draftPosting(req.user!.uid, text));
  }));
  r.post("/employer/jobs", limit, wrap(async (req, res) => res.status(201).json({ job: await postJob(req.user!.uid, PostBody.parse(req.body)) })));
  r.post("/employer/jobs/:id/close", wrap(async (req, res) => res.json({ job: await closeJob(req.user!.uid, req.params.id) })));
  r.get("/employer/jobs/:id/candidates", wrap(async (req, res) => res.json({ candidates: await candidatesFor(req.user!.uid, req.params.id) })));
  r.post("/employer/applicants/:id/status", wrap(async (req, res) => {
    const { status, note } = z.object({ status: z.enum(["new", "shortlisted", "rejected", "hired"]), note: z.string().max(500).optional() }).parse(req.body);
    res.json({ candidate: await setApplicantStatus(req.user!.uid, req.params.id, status, note) });
  }));

  // ---- candidate side ----
  r.get("/jobs/:id/direct", wrap(async (req, res) => {
    const job = await (await getStore()).get<Job>("jobs", req.params.id);
    const direct = Boolean(job?.sources.some((s) => s.connector === "employer"));
    res.json({ direct, willShare: direct ? SHARED_FIELDS : [] });
  }));
  r.post("/jobs/:id/apply-direct-share", limit, wrap(async (req, res) => {
    const { confirm, message } = z.object({ confirm: z.literal(true), message: z.string().max(500).optional() }).parse(req.body);
    void confirm; // the candidate must explicitly agree to share
    const a = await applyDirect(req.user!.uid, req.params.id, message);
    res.status(201).json({ applied: true, applicationId: a.id, matchScore: a.matchScore });
  }));
  r.post("/jobs/:id/report", limit, wrap(async (req, res) => {
    const { reason, note } = z.object({ reason: z.enum(REPORT_REASONS as [string, ...string[]]), note: z.string().max(500).optional() }).parse(req.body);
    res.json(await reportJob(req.user!.uid, req.params.id, reason as (typeof REPORT_REASONS)[number], note));
  }));

  // ---- admin moderation ----
  r.get("/admin/moderation", requireAdmin, wrap(async (_req, res) => res.json(await moderationQueue())));
  r.post("/admin/employer-jobs/:id", requireAdmin, wrap(async (req, res) => {
    const { decision, reason } = z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().max(300).optional() }).parse(req.body);
    res.json({ job: await decideJob(req.user!.uid, req.params.id, decision, reason) });
  }));
  r.post("/admin/employers/:uid", requireAdmin, wrap(async (req, res) => {
    const { status } = z.object({ status: z.enum(["verified", "blocked"]) }).parse(req.body);
    res.json({ employer: await decideEmployer(req.user!.uid, req.params.uid, status) });
  }));

  return r;
}

/** Public: `/go/<employerJobId>` (the "apply" link of employer jobs) opens the job inside the app. */
export function employerRedirect(): express.Router {
  const r = express.Router();
  r.get("/go/:id", (req, res, next) => {
    (async () => {
      const ej = await (await getStore()).get<{ jobId?: string; status: string }>("employerJobs", req.params.id);
      res.set("X-Robots-Tag", "noindex");
      res.redirect(302, ej?.jobId && ej.status === "live" ? `/#job/${encodeURIComponent(ej.jobId)}` : "/");
    })().catch(next);
  });
  return r;
}
