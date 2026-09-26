import crypto from "node:crypto";
import type { ZodType } from "zod";
import { config } from "../config.js";
import { getStore } from "../db/store.js";
import type { AiUsageRecord } from "../../shared/types.js";
import { noteUserKeyResult, poolProviders, userProvider } from "./keys.js";
import type { AiProvider, GenerateResponse } from "./providers.js";

export type AiTask =
  | "classify"
  | "chat"
  | "resume_extract"
  | "resume_ocr"
  | "interview_prep"
  | "mock_feedback"
  | "job_analyze"
  | "match_explain"
  | "resume_tailor"
  | "cover_letter";

/** Internal credits (scope §38.2). Model choice can change without changing what users see. */
export const TASK_CREDITS: Record<AiTask, number> = {
  classify: 1,
  chat: 1,
  match_explain: 2,
  job_analyze: 3,
  cover_letter: 4,
  resume_extract: 5,
  resume_ocr: 6,
  interview_prep: 4,
  mock_feedback: 2,
  resume_tailor: 8,
};

/** Provider-kind preference per task (scope §39): Gemini for heavy reasoning, fast compat models for small jobs. */
const ROUTES: Record<AiTask, Array<"gemini" | "compat">> = {
  classify: ["compat", "gemini"],
  chat: ["gemini", "compat"],
  resume_extract: ["gemini", "compat"],
  resume_ocr: ["gemini", "compat"],
  interview_prep: ["gemini", "compat"],
  mock_feedback: ["compat", "gemini"],
  job_analyze: ["compat", "gemini"],
  match_explain: ["compat", "gemini"],
  resume_tailor: ["gemini", "compat"],
  cover_letter: ["gemini", "compat"],
};
const kindOf = (p: AiProvider) => p.kind ?? (p.id === "gemini" ? "gemini" : "compat");

const CACHEABLE: AiTask[] = ["job_analyze", "resume_extract", "match_explain"];
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
export const SYSTEM_UID = "system";

export class AiUnavailableError extends Error {
  constructor(message = "AI is temporarily unavailable") {
    super(message);
    this.name = "AiUnavailableError";
  }
}
export class AiQuotaError extends Error {
  constructor(public remaining: number) {
    super("Daily AI credit limit reached");
    this.name = "AiQuotaError";
  }
}

// Tests replace the pool (and optionally users' keys) with fakes.
let poolOverride: AiProvider[] | null = null;
let userOverride: ((uid: string) => Promise<AiProvider | null>) | null = null;
const cooldownUntil = new Map<string, number>();

export function setProviders(p: AiProvider[] | null, userKeys?: (uid: string) => Promise<AiProvider | null>) {
  poolOverride = p;
  userOverride = userKeys || null;
  cooldownUntil.clear();
}

const getPool = async (): Promise<AiProvider[]> => poolOverride || (await poolProviders());
const getOwn = async (uid: string): Promise<AiProvider | null> => (uid === SYSTEM_UID ? null : userOverride ? userOverride(uid) : poolOverride ? null : userProvider(uid));
const cool = (p: AiProvider) => (cooldownUntil.get(p.id) || 0) <= Date.now();

/** The owner's shared pool: which keys exist and which are cooling down after errors. */
export async function aiStatus() {
  return (await getPool()).map((p) => ({ id: p.id, kind: kindOf(p), configured: p.available(), coolingDownMs: Math.max(0, (cooldownUntil.get(p.id) || 0) - Date.now()) }));
}

/** Is any AI usable for this user right now (their own key, or the shared pool)? */
export async function aiAvailable(uid = SYSTEM_UID): Promise<boolean> {
  const own = await getOwn(uid);
  if (own?.available() && cool(own)) return true;
  return (await getPool()).some((p) => p.available() && cool(p));
}

const today = () => new Date().toISOString().slice(0, 10);
const limitFor = (uid: string) => (uid === SYSTEM_UID ? config.dailyAiCredits * 10 : config.dailyAiCredits);

export async function getUsage(uid: string): Promise<{ used: number; limit: number; remaining: number; requests: number }> {
  const store = await getStore();
  const rec = await store.get<AiUsageRecord>("aiUsage", `${uid}_${today()}`);
  const used = rec?.creditsUsed || 0;
  const limit = limitFor(uid);
  return { used, limit, remaining: Math.max(0, limit - used), requests: rec?.requests || 0 };
}

async function reserve(uid: string, credits: number): Promise<void> {
  const store = await getStore();
  const id = `${uid}_${today()}`;
  const limit = limitFor(uid);
  let granted = true;
  let remaining = 0;
  await store.mutate<AiUsageRecord>("aiUsage", id, (cur) => {
    const rec = cur || { id, uid, date: today(), creditsUsed: 0, requests: 0, tokensIn: 0, tokensOut: 0 };
    granted = rec.creditsUsed + credits <= limit; // reset each run: transactions may retry
    remaining = Math.max(0, limit - rec.creditsUsed);
    return granted ? { ...rec, creditsUsed: rec.creditsUsed + credits, requests: rec.requests + 1 } : rec;
  });
  if (!granted) throw new AiQuotaError(remaining);
}

async function refund(uid: string, credits: number) {
  const store = await getStore();
  await store.mutate<AiUsageRecord>("aiUsage", `${uid}_${today()}`, (cur) => {
    const rec = cur || { id: `${uid}_${today()}`, uid, date: today(), creditsUsed: 0, requests: 0, tokensIn: 0, tokensOut: 0 };
    return { ...rec, creditsUsed: Math.max(0, rec.creditsUsed - credits), requests: Math.max(0, rec.requests - 1) };
  });
}

async function recordTokens(uid: string, tokensIn = 0, tokensOut = 0, ownKey = false) {
  const store = await getStore();
  await store.mutate<AiUsageRecord>("aiUsage", `${uid}_${today()}`, (cur) => {
    const rec = cur || { id: `${uid}_${today()}`, uid, date: today(), creditsUsed: 0, requests: 0, tokensIn: 0, tokensOut: 0 };
    return { ...rec, tokensIn: rec.tokensIn + tokensIn, tokensOut: rec.tokensOut + tokensOut, ownKeyRequests: (rec.ownKeyRequests || 0) + (ownKey ? 1 : 0) };
  });
}

function stripFences(text: string): string {
  const t = text.trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fenced) return fenced[1].trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first > 0 && last > first) return t.slice(first, last + 1);
  return t;
}

export interface GenerateOptions {
  task: AiTask;
  uid: string;
  prompt: string;
  system?: string;
  maxTokens?: number;
  /** Images/PDFs to read. Restricts the call to Gemini, the only vision-capable provider here. */
  files?: Array<{ mime: string; base64: string }>;
  /** Receive raw model text as it is generated (providers without streaming deliver it in one piece). */
  onText?: (chunk: string) => void;
  /** Called when a provider failed after streaming some text and another one starts over. */
  onReset?: () => void;
}

async function orderedPool(task: AiTask, vision = false): Promise<AiProvider[]> {
  const order = ROUTES[task];
  return [...(await getPool())].filter((p) => !vision || kindOf(p) === "gemini").sort((a, b) => order.indexOf(kindOf(a)) - order.indexOf(kindOf(b))).filter((p) => p.available() && cool(p));
}

function noteFailure(p: AiProvider, err: any) {
  const msg = String(err?.message || err);
  const rateLimited = /429|quota|rate|RESOURCE_EXHAUSTED/i.test(msg);
  cooldownUntil.set(p.id, Date.now() + (rateLimited ? 90_000 : 30_000));
  console.warn(`[ai] ${p.id} failed (${rateLimited ? "rate limited" : "error"}): ${msg.slice(0, 200)}`);
}

async function withGateway<T>(
  opts: GenerateOptions,
  json: boolean,
  parse: (text: string) => T,
): Promise<T> {
  const request = { system: opts.system, prompt: opts.prompt, json, maxTokens: opts.maxTokens, files: opts.files };
  let streamed = false;
  const call = async (p: AiProvider): Promise<GenerateResponse> => {
    if (streamed) opts.onReset?.();
    streamed = false;
    if (!opts.onText) return p.generate(request);
    if (!p.stream) {
      const out = await p.generate(request);
      streamed = true;
      opts.onText(out.text);
      return out;
    }
    return p.stream(request, (t) => { streamed = true; opts.onText!(t); });
  };

  // 1) The user's own free key: their quota, so no shared credits are spent.
  const own = await getOwn(opts.uid);
  if (own?.available() && cool(own) && (!opts.files?.length || kindOf(own) === "gemini")) {
    try {
      const out = await call(own);
      const parsed = parse(out.text);
      await noteUserKeyResult(opts.uid).catch(() => undefined);
      await recordTokens(opts.uid, out.tokensIn, out.tokensOut, true).catch(() => undefined);
      return parsed;
    } catch (err: any) {
      if (err?.name !== "AiOutputError") {
        noteFailure(own, err);
        await noteUserKeyResult(opts.uid, err).catch(() => undefined);
      }
      // Fall through to the shared pool.
    }
  }

  // 2) The shared pool, metered by the daily allowance.
  const providersInOrder = await orderedPool(opts.task, Boolean(opts.files?.length));
  if (!providersInOrder.length) throw new AiUnavailableError();

  const credits = TASK_CREDITS[opts.task];
  await reserve(opts.uid, credits);
  let lastErr: unknown;
  for (const p of providersInOrder) {
    try {
      const out = await call(p);
      const parsed = parse(out.text);
      await recordTokens(opts.uid, out.tokensIn, out.tokensOut).catch(() => undefined);
      return parsed;
    } catch (err: any) {
      lastErr = err;
      // Schema/JSON problems are not the provider being down; only cool down on transport errors.
      if (err?.name !== "AiOutputError") noteFailure(p, err);
      else console.warn(`[ai] ${p.id} returned invalid output: ${String(err.message).slice(0, 200)}`);
    }
  }
  await refund(opts.uid, credits).catch(() => undefined);
  throw new AiUnavailableError(`All AI providers failed${lastErr ? `: ${String((lastErr as any).message || lastErr).slice(0, 120)}` : ""}`);
}

class AiOutputError extends Error {
  constructor(m: string) {
    super(m);
    this.name = "AiOutputError";
  }
}

export async function generateJSON<T>(opts: GenerateOptions & { schema: ZodType<T, any, any>; cache?: boolean }): Promise<T> {
  const store = await getStore();
  const cacheOn = opts.cache ?? CACHEABLE.includes(opts.task);
  const cacheId = cacheOn ? crypto.createHash("sha256").update(`${opts.task}|${opts.system || ""}|${opts.prompt}`).digest("hex") : "";
  if (cacheOn) {
    const hit = await store.get<{ data: unknown; at: number }>("aiCache", cacheId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      const ok = opts.schema.safeParse(hit.data);
      if (ok.success) return ok.data;
    }
  }
  const result = await withGateway(opts, true, (text) => {
    let raw: unknown;
    try {
      raw = JSON.parse(stripFences(text));
    } catch {
      throw new AiOutputError("Model did not return valid JSON");
    }
    const v = opts.schema.safeParse(raw);
    if (!v.success) throw new AiOutputError(`Schema mismatch: ${v.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    return v.data;
  });
  if (cacheOn) await store.put("aiCache", cacheId, { data: result, at: Date.now() }).catch(() => undefined);
  return result;
}

export async function generateText(opts: GenerateOptions): Promise<string> {
  return withGateway(opts, false, (t) => {
    if (!t.trim()) throw new AiOutputError("Empty response");
    return t.trim();
  });
}
