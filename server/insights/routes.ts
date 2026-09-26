// Routes for career insights (Phase 5.1). Mounted behind requireAuth.
import express, { type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { AppError, listApplications } from "../applications/service.js";
import { getProfile } from "../profile/service.js";
import { funnelStats } from "./funnel.js";
import { learningRoi } from "./learning.js";
import { marketPulse } from "./market.js";

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => { fn(req, res).catch(next); };

const cache = new Map<string, { at: number; value: unknown }>();
export const _resetInsightCaches = () => cache.clear();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function insightsRouter(): express.Router {
  const r = express.Router();
  const need = async (uid: string) => {
    const p = await getProfile(uid);
    if (!p || p.status !== "ready") throw new AppError(409, "Finish your profile to see insights.");
    return p;
  };

  r.get("/insights/learning", wrap(async (req, res) => {
    const p = await need(req.user!.uid);
    res.json(await cached(`learn:${p.uid}:${p.updatedAt}`, 10 * 60_000, () => learningRoi(p)));
  }));
  r.get("/insights/funnel", wrap(async (req, res) => res.json({ funnel: funnelStats(await listApplications(req.user!.uid)) })));
  r.get("/insights/market", wrap(async (req, res) => {
    const q = z.object({ role: z.string().trim().min(2).max(80).optional(), city: z.string().trim().max(60).optional() }).parse(req.query);
    const p = await need(req.user!.uid);
    res.json({ market: await cached(`market:${p.uid}:${q.role || ""}:${q.city || ""}:${p.updatedAt}`, 10 * 60_000, () => marketPulse(p, q)) });
  }));
  return r;
}
