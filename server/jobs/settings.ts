// Discovery settings an admin can change at runtime (no restart): schedule, pace and aggregator keys.
// Stored in the "settings" collection; .env values are the defaults.
import { z } from "zod";
import { config } from "../config.js";
import { getStore } from "../db/store.js";
import { decryptSecret, encryptSecret, last4 } from "../ai/secrets.js";
import { httpLimits } from "./http.js";

export const DiscoverySettingsSchema = z.object({
  paused: z.boolean(),
  intervalMinutes: z.number().int().min(15).max(1440),
  boardsPerRun: z.number().int().min(5).max(500),
  maxConcurrent: z.number().int().min(1).max(20),
  timeoutSeconds: z.number().int().min(5).max(120),
  /** Per-source overrides, e.g. check a slow aggregator only every 6 hours. */
  sources: z.record(z.string().max(40), z.object({ intervalMinutes: z.number().int().min(15).max(10080).optional() })),
});
export type DiscoverySettings = z.infer<typeof DiscoverySettingsSchema> & { updatedAt?: string };

const DOC = "discovery";
const KEYS_DOC = "sourceKeys";

export const defaults = (): DiscoverySettings => ({
  paused: config.discoveryIntervalMinutes <= 0,
  intervalMinutes: Math.max(15, config.discoveryIntervalMinutes || 60),
  boardsPerRun: config.sources.boardsPerRun,
  maxConcurrent: httpLimits.maxConcurrent,
  timeoutSeconds: Math.round(httpLimits.timeoutMs / 1000),
  sources: {},
});

let current: DiscoverySettings = defaults();
const listeners = new Set<(s: DiscoverySettings) => void>();

/** Push settings into the live system: HTTP pace and rotation size change immediately. */
function apply(s: DiscoverySettings) {
  current = s;
  httpLimits.maxConcurrent = s.maxConcurrent;
  httpLimits.timeoutMs = s.timeoutSeconds * 1000;
  config.sources.boardsPerRun = s.boardsPerRun;
  for (const l of listeners) l(s);
}

export const discoverySettings = () => current;
export const onSettingsChange = (fn: (s: DiscoverySettings) => void) => { listeners.add(fn); return () => listeners.delete(fn); };

export async function loadDiscoverySettings(): Promise<DiscoverySettings> {
  const saved = await (await getStore()).get<Partial<DiscoverySettings>>("settings", DOC);
  apply({ ...defaults(), ...(saved || {}), sources: { ...(saved?.sources || {}) } });
  await loadSourceKeys();
  return current;
}

export async function saveDiscoverySettings(patch: Partial<DiscoverySettings>): Promise<DiscoverySettings> {
  const next = DiscoverySettingsSchema.parse({ ...current, ...patch, sources: patch.sources ?? current.sources });
  const saved: DiscoverySettings = { ...next, updatedAt: new Date().toISOString() };
  await (await getStore()).put("settings", DOC, saved);
  apply(saved);
  return saved;
}

// ---------------- aggregator keys (Adzuna, Careerjet, Jooble) ----------------

export type KeyedSource = "adzuna" | "careerjet" | "jooble";
interface StoredKeys { adzuna?: { appId: string; appKeyEnc: string }; careerjet?: { keyEnc: string; referer: string }; jooble?: { keyEnc: string } }

/** What a key-needing source requires, and where to get it — shown in Admin. */
export const SOURCE_SETUP: Record<KeyedSource, { url: string; fields: Array<{ id: string; label: string; secret: boolean; placeholder?: string }> }> = {
  adzuna: { url: "https://developer.adzuna.com/signup", fields: [{ id: "appId", label: "App ID", secret: false }, { id: "appKey", label: "App key", secret: true }] },
  careerjet: { url: "https://www.careerjet.com/partners/", fields: [{ id: "key", label: "API key", secret: true }, { id: "referer", label: "Your site URL (sent as Referer)", secret: false, placeholder: "https://yourdomain.com/jobs" }] },
  jooble: { url: "https://jooble.org/api/about", fields: [{ id: "key", label: "API key", secret: true }] },
};

// Keys from .env win when present; keys pasted in Admin fill in the rest.
const envKeys = { adzuna: { ...config.adzuna }, careerjet: { ...config.careerjet }, jooble: { ...config.jooble } };

async function loadSourceKeys() {
  const k = (await (await getStore()).get<StoredKeys>("settings", KEYS_DOC)) || {};
  const dec = (s?: string) => { try { return s ? decryptSecret(s) : ""; } catch { return ""; } };
  config.adzuna.appId = envKeys.adzuna.appId || k.adzuna?.appId || "";
  config.adzuna.appKey = envKeys.adzuna.appKey || dec(k.adzuna?.appKeyEnc);
  config.careerjet.apiKey = envKeys.careerjet.apiKey || dec(k.careerjet?.keyEnc);
  config.careerjet.referer = envKeys.careerjet.referer || k.careerjet?.referer || "";
  config.jooble.apiKey = envKeys.jooble.apiKey || dec(k.jooble?.keyEnc);
}

export async function saveSourceKey(source: KeyedSource, values: Record<string, string>): Promise<void> {
  const store = await getStore();
  const k = (await store.get<StoredKeys>("settings", KEYS_DOC)) || {};
  const v = (id: string) => (values[id] || "").trim();
  if (source === "adzuna") k.adzuna = { appId: v("appId"), appKeyEnc: encryptSecret(v("appKey")) };
  if (source === "careerjet") k.careerjet = { keyEnc: encryptSecret(v("key")), referer: v("referer") };
  if (source === "jooble") k.jooble = { keyEnc: encryptSecret(v("key")) };
  await store.put("settings", KEYS_DOC, k);
  await loadSourceKeys();
}

export async function removeSourceKey(source: KeyedSource): Promise<void> {
  const store = await getStore();
  const k = (await store.get<StoredKeys>("settings", KEYS_DOC)) || {};
  delete k[source];
  await store.put("settings", KEYS_DOC, k);
  await loadSourceKeys();
}

/** Masked view for Admin: which keys exist and where they came from. Never the secret itself. */
export function sourceKeyStatus(): Record<KeyedSource, { configured: boolean; from: "env" | "admin" | null; hint?: string }> {
  const one = (env: boolean, set: boolean, hint?: string) => ({ configured: set, from: env ? ("env" as const) : set ? ("admin" as const) : null, hint });
  return {
    adzuna: one(Boolean(envKeys.adzuna.appKey), Boolean(config.adzuna.appId && config.adzuna.appKey), config.adzuna.appKey ? `…${last4(config.adzuna.appKey)}` : undefined),
    careerjet: one(Boolean(envKeys.careerjet.apiKey), Boolean(config.careerjet.apiKey && config.careerjet.referer), config.careerjet.apiKey ? `…${last4(config.careerjet.apiKey)}` : undefined),
    jooble: one(Boolean(envKeys.jooble.apiKey), Boolean(config.jooble.apiKey), config.jooble.apiKey ? `…${last4(config.jooble.apiKey)}` : undefined),
  };
}
