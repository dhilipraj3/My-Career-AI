// Routes for understanding the user (Phase 1) and the placement companion (Phase 2). Mounted behind requireAuth.
import express, { type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { getOrCreateProfile, getProfile, updatePreferences } from "../profile/service.js";
import { kickOffMatching } from "../resume/process.js";
import { applyAnswer, resolveGuess } from "./answers.js";
import { answerInterview, nextStep, promptFor, type InterviewStep } from "./interview.js";
import { buildResume, resumeHealth } from "./resume.js";
import { rolePaths } from "./rolePaths.js";
import { understand, type Lang } from "./understanding.js";

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => { fn(req, res).catch(next); };

const langOf = (req: Request, stored?: string): Lang => {
  const q = String(req.query.lang || (req.body as any)?.lang || stored || "en");
  return q === "hi" ? "hi" : "en";
};

// Role paths are a handful of searches; cache per user for a few minutes.
const pathCache = new Map<string, { at: number; value: unknown }>();
export const _resetCareerCaches = () => pathCache.clear();

export function careerRouter(): express.Router {
  const r = express.Router();

  const afterChange = async (uid: string, rematch: boolean) => {
    pathCache.delete(uid);
    const p = await getProfile(uid);
    if (rematch && p?.status === "ready") void kickOffMatching(uid);
  };

  // ---------------- understanding ----------------
  r.get("/career/understanding", wrap(async (req, res) => {
    const p = await getOrCreateProfile(req.user!);
    res.json(await understand(p, langOf(req, p.language)));
  }));

  r.post("/career/understanding/answer", wrap(async (req, res) => {
    const body = z.object({ questionId: z.string().min(2).max(40), choices: z.array(z.string().max(80)).max(20).optional(), text: z.string().max(500).optional(), lang: z.enum(["en", "hi"]).optional() }).parse(req.body);
    await getOrCreateProfile(req.user!);
    const { profile, changed } = await applyAnswer(req.user!.uid, body.questionId, body.choices, body.text);
    await afterChange(req.user!.uid, true);
    res.json({ changed, profile, understanding: await understand(profile, langOf(req, profile.language)) });
  }));

  r.post("/career/guess", wrap(async (req, res) => {
    const { kind, key, confirm } = z.object({ kind: z.enum(["skill", "role"]), key: z.string().min(1).max(80), confirm: z.boolean() }).parse(req.body);
    await getOrCreateProfile(req.user!);
    const profile = await resolveGuess(req.user!.uid, kind, key, confirm);
    await afterChange(req.user!.uid, true);
    res.json({ profile, understanding: await understand(profile, langOf(req, profile.language)) });
  }));

  // ---------------- no-resume conversation ----------------
  const Steps = z.enum(["about", "skills", "education", "work"]);
  r.get("/career/interview", wrap(async (req, res) => {
    const p = await getOrCreateProfile(req.user!);
    const asked = String(req.query.asked || "").split(",").filter((s): s is InterviewStep => Steps.safeParse(s).success);
    const step = nextStep(p, asked);
    res.json({ next: step ? promptFor(step, langOf(req, p.language)) : null, profile: p });
  }));

  r.post("/career/interview", wrap(async (req, res) => {
    const body = z.object({ step: Steps, text: z.string().max(2000).optional(), choices: z.array(z.string().max(60)).max(10).optional(), lang: z.enum(["en", "hi"]).optional(), asked: z.array(Steps).max(4).optional() }).parse(req.body);
    await getOrCreateProfile(req.user!);
    const out = await answerInterview(req.user!.uid, body.step, body.text || "", body.choices, langOf(req));
    const asked = [...new Set([...(body.asked || []), body.step])];
    const step = nextStep(out.profile, asked);
    await afterChange(req.user!.uid, false);
    res.json({ changed: out.changed, by: out.by, profile: out.profile, next: step ? promptFor(step, langOf(req)) : null });
  }));

  // ---------------- role discovery ----------------
  r.get("/career/role-paths", wrap(async (req, res) => {
    const p = await getOrCreateProfile(req.user!);
    const hit = pathCache.get(p.uid);
    if (hit && Date.now() - hit.at < 10 * 60_000) return res.json(hit.value);
    const value = await rolePaths(p);
    pathCache.set(p.uid, { at: Date.now(), value });
    res.json(value);
  }));

  r.post("/career/role-paths/target", wrap(async (req, res) => {
    const { role, target } = z.object({ role: z.string().trim().min(2).max(80), target: z.boolean() }).parse(req.body);
    const p = await getOrCreateProfile(req.user!);
    const roles = target
      ? [...new Set([...p.preferences.targetRoles, role])].slice(0, 8)
      : p.preferences.targetRoles.filter((x) => x.toLowerCase() !== role.toLowerCase());
    const profile = await updatePreferences(p.uid, { targetRoles: roles }, "user");
    await afterChange(p.uid, true);
    res.json({ profile });
  }));

  // ---------------- resume builder & health ----------------
  r.get("/career/resume", wrap(async (req, res) => {
    const p = await getOrCreateProfile(req.user!);
    res.json({ resume: buildResume(p), health: await resumeHealth(p) });
  }));

  return r;
}
