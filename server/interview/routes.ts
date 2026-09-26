// Routes for applying and interviewing (Phase 3). Mounted behind requireAuth.
import express, { type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { CandidateProfile, ResumeVersion } from "../../shared/types.js";
import { AppError, getApplication } from "../applications/service.js";
import { config } from "../config.js";
import { getStore } from "../db/store.js";
import { salaryBenchmark } from "../insights/salary.js";
import { diffTailored } from "../resume/tailor.js";
import { interviewCalendar } from "./ics.js";
import { draftMessage } from "./messages.js";
import { answerMock, getMock, listMocks, startMock } from "./mock.js";
import { compareOffers } from "./offers.js";
import { getPrep } from "./prep.js";

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => { fn(req, res).catch(next); };

export function interviewRouter(): express.Router {
  const r = express.Router();

  // ---- prep per job ----
  r.get("/interview/prep/:jobId", wrap(async (req, res) => res.json({ prep: await getPrep(req.user!.uid, req.params.jobId) })));
  r.post("/interview/prep/:jobId/regenerate", wrap(async (req, res) => res.json({ prep: await getPrep(req.user!.uid, req.params.jobId, { regenerate: true }) })));

  // ---- mock interviews ----
  r.get("/interview/mocks", wrap(async (req, res) => res.json({ sessions: await listMocks(req.user!.uid) })));
  r.post("/interview/mock", wrap(async (req, res) => {
    const { jobId } = z.object({ jobId: z.string().max(100).optional() }).parse(req.body || {});
    const session = await startMock(req.user!.uid, jobId);
    res.status(201).json({ session, next: session.questions[0] });
  }));
  r.get("/interview/mock/:id", wrap(async (req, res) => {
    const session = await getMock(req.user!.uid, req.params.id);
    res.json({ session, next: session.status === "active" ? session.questions[session.answers.length] : null });
  }));
  r.post("/interview/mock/:id/answer", wrap(async (req, res) => {
    const { text } = z.object({ text: z.string().trim().min(1).max(4000) }).parse(req.body);
    res.json(await answerMock(req.user!.uid, req.params.id, text));
  }));

  // ---- messages, calendar, offers, benchmarks ----
  r.post("/applications/:id/draft", wrap(async (req, res) => {
    const body = z.object({ kind: z.enum(["follow_up", "thank_you", "withdraw", "accept", "decline", "negotiate"]), offerLPA: z.number().min(0).max(1000).optional(), interviewer: z.string().max(80).optional() }).parse(req.body);
    res.json({ draft: await draftMessage(req.user!.uid, req.params.id, body.kind, body) });
  }));

  r.get("/applications/:id/calendar.ics", wrap(async (req, res) => {
    const a = await getApplication(req.user!.uid, req.params.id);
    if (!a.interviewDates.length) throw new AppError(404, "No interview dates on this application yet.");
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="interview-${a.company.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics"`);
    res.send(interviewCalendar(a, config.siteUrl));
  }));

  const Offer = z.object({
    company: z.string().trim().min(1).max(100), role: z.string().trim().max(100).default(""), fixedLPA: z.number().min(0.1).max(1000),
    variableLPA: z.number().min(0).max(1000).optional(), joiningBonusLakh: z.number().min(0).max(1000).optional(),
    commuteMinutes: z.number().int().min(0).max(300).optional(), wfhDaysPerWeek: z.number().int().min(0).max(5).optional(),
    growth: z.number().int().min(1).max(5).optional(), benefits: z.array(z.string().max(60)).max(10).optional(),
  });
  r.post("/offers/compare", wrap(async (req, res) => {
    const { offers } = z.object({ offers: z.array(Offer).min(1).max(4) }).parse(req.body);
    res.json(compareOffers(offers));
  }));

  r.get("/insights/salary", wrap(async (req, res) => {
    const { role, city } = z.object({ role: z.string().trim().min(2).max(80), city: z.string().trim().max(60).optional() }).parse(req.query);
    res.json({ benchmark: await salaryBenchmark(role, city) });
  }));

  // ---- what did tailoring change? ----
  r.get("/resume-versions/:id/changes", wrap(async (req, res) => {
    const store = await getStore();
    const v = await store.get<ResumeVersion>("resumeVersions", req.params.id);
    if (!v || v.uid !== req.user!.uid || !v.content) throw new AppError(404, "Resume not found");
    const profile = await store.get<CandidateProfile>("profiles", req.user!.uid);
    res.json({ changes: diffTailored(profile!, v.content) });
  }));

  return r;
}
