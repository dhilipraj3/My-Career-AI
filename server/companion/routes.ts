// Routes for the placement companion (Phase 2). Mounted behind requireAuth.
import express, { type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { activityFor, journeyFor, markPlaced, tickGoal, undoPlaced, weeklyPlan } from "./service.js";

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => { fn(req, res).catch(next); };

export function companionRouter(): express.Router {
  const r = express.Router();

  r.get("/companion/journey", wrap(async (req, res) => {
    const journey = await journeyFor(req.user!.uid);
    res.json({ journey, plan: await weeklyPlan(req.user!.uid), activity: await activityFor(req.user!.uid) });
  }));

  r.post("/companion/plan/tick", wrap(async (req, res) => {
    const { goal, done } = z.object({ goal: z.enum(["apply", "practise", "learn", "profile"]), done: z.number().int().min(0).max(99) }).parse(req.body);
    res.json({ plan: await tickGoal(req.user!.uid, goal, done) });
  }));

  r.post("/companion/placed", wrap(async (req, res) => {
    const body = z.object({
      company: z.string().trim().min(1).max(120), role: z.string().trim().min(1).max(120),
      joiningDate: z.string().max(20).optional(), salaryLPA: z.number().min(0).max(1000).optional(), applicationId: z.string().max(80).optional(),
    }).parse(req.body);
    res.json({ placement: await markPlaced(req.user!.uid, body) });
  }));

  r.delete("/companion/placed", wrap(async (req, res) => { await undoPlaced(req.user!.uid); res.json({ ok: true }); }));

  return r;
}
