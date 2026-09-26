// Routes for live voice with Asha. Mounted behind requireAuth.
import crypto from "node:crypto";
import express, { type Request, type RequestHandler, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { ChatMessage, Job } from "../../shared/types.js";
import { invoke, loadConversation, saveConversation } from "../agent/agent.js";
import { getUserKey } from "../ai/keys.js";
import { audit } from "../audit.js";
import { config } from "../config.js";
import { getStore } from "../db/store.js";
import { ASHA_VOICES, VOICE_TOOLS, createVoiceSession } from "./session.js";

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => { fn(req, res).catch(next); };
const perUser = (limit: number) => rateLimit({ windowMs: 60_000, limit, keyGenerator: (req) => req.user?.uid || req.ip || "anon", standardHeaders: true, legacyHeaders: false, message: { error: "Too many voice requests. Please wait a moment." } });

/** Tool results can be large (job descriptions); the model only needs the gist to speak about it. */
function forModel(data: unknown): unknown {
  const text = JSON.stringify(data ?? {});
  return text.length <= 6000 ? data : { summary: text.slice(0, 6000) };
}

export function voiceRouter(): express.Router {
  const r = express.Router();
  const voiceTools = new Set(VOICE_TOOLS.map((t) => t.name));
  // Per-session guard: how many changes the voice agent made, so a runaway conversation can't change everything.
  const modifies = new Map<string, { n: number; at: number }>();

  r.get("/voice/status", wrap(async (req, res) => {
    const k = await getUserKey(req.user!.uid);
    res.json({ available: Boolean(k && k.status !== "invalid"), keyStatus: k?.status || null, model: config.liveModel, voices: ASHA_VOICES });
  }));

  r.post("/voice/session", perUser(12), wrap(async (req, res) => {
    const body = z.object({ page: z.string().max(30).optional(), jobId: z.string().max(100).optional(), lang: z.enum(["en", "hi"]).optional(), voice: z.string().max(30).optional() }).parse(req.body || {});
    const job = body.jobId ? await (await getStore()).get<Job>("jobs", body.jobId) : null;
    const s = await createVoiceSession(req.user!.uid, { ...body, jobId: job && (!job.ownerUid || job.ownerUid === req.user!.uid) ? job.id : undefined, jobTitle: job?.title });
    const sessionId = `vs_${crypto.randomBytes(6).toString("hex")}`;
    modifies.set(sessionId, { n: 0, at: Date.now() });
    for (const [k, v] of modifies) if (Date.now() - v.at > 3_600_000) modifies.delete(k);
    await audit(req.user!.uid, "voice.session_started", { voice: s.voice });
    res.json({ sessionId, token: s.token, model: s.model, voice: s.voice, expiresAt: s.expiresAt });
  }));

  // A function call from the live model, run with the chat's permission rules.
  r.post("/voice/tool", perUser(60), wrap(async (req, res) => {
    const { name, args, sessionId } = z.object({ name: z.string().max(60), args: z.record(z.any()).default({}), sessionId: z.string().max(40) }).parse(req.body);
    if (!voiceTools.has(name)) return res.json({ response: { error: `Unknown tool "${name}".` } });
    const st = modifies.get(sessionId) || { n: 0, at: Date.now() };
    const state = { tainted: false, modifies: st.n };
    const out = await invoke({ uid: req.user!.uid }, name, args, state);
    modifies.set(sessionId, { n: state.modifies, at: Date.now() });
    const result = out.result;
    res.json({
      // What the model hears back:
      response: out.error ? { error: out.error } : out.pending ? { needsConfirmation: true, message: `The user must tap Confirm on screen: ${out.pending.summary}` } : { ok: true, data: forModel(result?.data) },
      // What the app shows or does:
      cards: result?.cards || [], navigate: result?.navigate, openUrl: result?.openUrl, change: result?.change, pending: out.pending,
    });
  }));

  // What was said, so the conversation also appears in the chat history.
  r.post("/voice/transcript", perUser(30), wrap(async (req, res) => {
    const { turns } = z.object({ turns: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(4000) })).min(1).max(60) }).parse(req.body);
    const uid = req.user!.uid;
    const now = Date.now();
    const added: ChatMessage[] = turns.map((t, i) => ({ id: `msg_${now}_${i}_v`, role: t.role, text: t.text, at: new Date(now + i).toISOString(), voice: true }));
    await saveConversation(uid, [...(await loadConversation(uid)), ...added]);
    await audit(uid, "voice.transcript_saved", { turns: turns.length });
    res.json({ saved: added.length });
  }));

  return r;
}
