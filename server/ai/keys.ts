// Who pays for each AI request: the user's own free Gemini key first, then the owner's shared pool.
import crypto from "node:crypto";
import { config } from "../config.js";
import { getStore, type Store } from "../db/store.js";
import { decryptSecret, encryptSecret, last4 } from "./secrets.js";
import { COMPAT_PRESETS, GeminiProvider, OpenAiCompatProvider, detectGeminiModels, isAuthError, pingProvider, type AiProvider } from "./providers.js";

export interface PoolKey {
  id: string;
  kind: "gemini" | "compat";
  label: string;
  baseUrl?: string; // compat only
  models: string[]; // gemini: detected cascade; compat: [model]
  keyEnc: string;
  last4: string;
  enabled: boolean;
  addedAt: string;
  lastOkAt?: string;
  lastError?: string;
}

export interface UserKey {
  uid: string;
  kind: "gemini";
  keyEnc: string;
  last4: string;
  models: string[];
  addedAt: string;
  lastOkAt?: string;
  lastError?: string;
  status: "ok" | "invalid" | "quota";
}

/** What the browser may see about a key. Never the key itself. */
export type PublicKey = Omit<PoolKey, "keyEnc"> & { source: "admin" | "env" };

const POOL_DOC = "ai_pool";

async function readPool(): Promise<PoolKey[]> {
  const rec = await (await getStore()).get<{ keys: PoolKey[] }>("settings", POOL_DOC);
  return rec?.keys || [];
}
async function writePool(keys: PoolKey[]) {
  const store = await getStore();
  await store.put("settings", POOL_DOC, { keys });
  poolCache.delete(store);
}

/** Keys from .env still work, shown in Admin as read-only entries. */
function envEntries(): Array<PublicKey & { key: string }> {
  const out: Array<PublicKey & { key: string }> = [];
  if (config.gemini.apiKey) out.push({ id: "env_gemini", kind: "gemini", label: "Gemini (from .env)", models: config.gemini.models, last4: last4(config.gemini.apiKey), enabled: true, addedAt: "", source: "env", key: config.gemini.apiKey });
  if (config.fallbackAi.apiKey) out.push({ id: "env_fallback", kind: "compat", label: "Fallback (from .env)", baseUrl: config.fallbackAi.baseUrl, models: [config.fallbackAi.model], last4: last4(config.fallbackAi.apiKey), enabled: true, addedAt: "", source: "env", key: config.fallbackAi.apiKey });
  return out;
}

const toProvider = (e: { id: string; kind: "gemini" | "compat"; baseUrl?: string; models: string[] }, key: string): AiProvider =>
  e.kind === "gemini" ? new GeminiProvider(e.id, key, e.models.length ? e.models : config.gemini.models) : new OpenAiCompatProvider(e.id, e.baseUrl || "", key, e.models[0] || "");

// Cached per store instance so a swapped store (tests) never sees another store's keys.
const poolCache = new WeakMap<Store, { at: number; providers: AiProvider[] }>();

/** The owner's shared pool, cached briefly so every request doesn't hit the store. */
export async function poolProviders(): Promise<AiProvider[]> {
  const store = await getStore();
  const hit = poolCache.get(store);
  if (hit && Date.now() - hit.at < 30_000) return hit.providers;
  const providers: AiProvider[] = envEntries().map((e) => toProvider(e, e.key));
  for (const k of await readPool()) {
    if (!k.enabled) continue;
    try { providers.push(toProvider(k, decryptSecret(k.keyEnc))); } catch { /* undecryptable (secret rotated): skip */ }
  }
  poolCache.set(store, { at: Date.now(), providers });
  return providers;
}

export async function listPool(): Promise<PublicKey[]> {
  return [...envEntries().map(({ key: _k, ...e }) => e), ...(await readPool()).map(({ keyEnc: _k, ...k }) => ({ ...k, source: "admin" as const }))];
}

export class KeyTestError extends Error {}

function friendly(err: unknown): string {
  const msg = String((err as any)?.message || err);
  if (isAuthError(err)) return "That key was rejected. Check you copied the whole key.";
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) return "The key works but is out of free quota right now. Try again later.";
  if (/fetch failed|ENOTFOUND|ECONN|timed? ?out|abort/i.test(msg)) return "Couldn't reach the AI service. Check the internet connection and try again.";
  return `The AI service returned an error: ${msg.slice(0, 140)}`;
}

/** Validate a Gemini key for real: list its models, then make one tiny request. Returns the model cascade to use. */
async function testGemini(key: string): Promise<string[]> {
  let models: string[] = [];
  try { models = await detectGeminiModels(key); } catch (e) { if (isAuthError(e)) throw new KeyTestError(friendly(e)); }
  if (!models.length) models = config.gemini.models;
  try { await pingProvider(new GeminiProvider("test", key, models)); } catch (e) { throw new KeyTestError(friendly(e)); }
  return models;
}

export async function addPoolKey(input: { kind: "gemini" | "compat"; key: string; label?: string; preset?: string; baseUrl?: string; model?: string }): Promise<PublicKey> {
  const key = input.key.trim();
  let entry: Omit<PoolKey, "keyEnc" | "last4" | "addedAt" | "enabled" | "id">;
  if (input.kind === "gemini") {
    entry = { kind: "gemini", label: input.label || "Google Gemini", models: await testGemini(key) };
  } else {
    const preset = input.preset ? COMPAT_PRESETS[input.preset] : undefined;
    const baseUrl = input.baseUrl || preset?.baseUrl || "";
    const model = input.model || preset?.model || "";
    if (!/^https:\/\//.test(baseUrl) || !model) throw new KeyTestError("Choose a provider (or give its https base URL) and a model.");
    try { await pingProvider(new OpenAiCompatProvider("test", baseUrl, key, model)); } catch (e) { throw new KeyTestError(friendly(e)); }
    entry = { kind: "compat", label: input.label || preset?.label || new URL(baseUrl).hostname, baseUrl, models: [model] };
  }
  const now = new Date().toISOString();
  const rec: PoolKey = { ...entry, id: `pk_${crypto.randomBytes(5).toString("hex")}`, keyEnc: encryptSecret(key), last4: last4(key), enabled: true, addedAt: now, lastOkAt: now };
  await writePool([...(await readPool()), rec]);
  const { keyEnc: _k, ...pub } = rec;
  return { ...pub, source: "admin" };
}

export async function updatePoolKey(id: string, patch: { enabled?: boolean; label?: string }): Promise<boolean> {
  const keys = await readPool();
  const k = keys.find((x) => x.id === id);
  if (!k) return false;
  Object.assign(k, patch);
  await writePool(keys);
  return true;
}

export async function removePoolKey(id: string): Promise<boolean> {
  const keys = await readPool();
  if (!keys.some((k) => k.id === id)) return false;
  await writePool(keys.filter((k) => k.id !== id));
  return true;
}

export async function retestPoolKey(id: string): Promise<PublicKey> {
  const keys = await readPool();
  const k = keys.find((x) => x.id === id);
  if (!k) throw new KeyTestError("Key not found");
  try {
    const key = decryptSecret(k.keyEnc);
    if (k.kind === "gemini") k.models = await testGemini(key);
    else await pingProvider(toProvider(k, key)).catch((e) => { throw new KeyTestError(friendly(e)); });
    k.lastOkAt = new Date().toISOString();
    k.lastError = undefined;
  } catch (e: any) {
    k.lastError = e instanceof KeyTestError ? e.message : friendly(e);
  }
  await writePool(keys);
  const { keyEnc: _k, ...pub } = k;
  return { ...pub, source: "admin" };
}

// ---------------- users' own keys ----------------

export async function getUserKey(uid: string): Promise<UserKey | null> {
  return (await getStore()).get<UserKey>("userKeys", uid);
}

export async function userProvider(uid: string): Promise<AiProvider | null> {
  const k = await getUserKey(uid);
  if (!k || k.status === "invalid") return null;
  try { return new GeminiProvider(`user:${uid}`, decryptSecret(k.keyEnc), k.models); } catch { return null; }
}

export async function saveUserKey(uid: string, rawKey: string): Promise<Omit<UserKey, "keyEnc">> {
  const key = rawKey.trim();
  // Google has changed key formats over time, so don't guess a prefix: reject only obvious non-keys and let the real test call decide.
  if (!/^\S{20,300}$/.test(key)) throw new KeyTestError("That doesn't look like an API key. Copy the whole key from Google AI Studio, without spaces.");
  const models = await testGemini(key);
  const now = new Date().toISOString();
  const rec: UserKey = { uid, kind: "gemini", keyEnc: encryptSecret(key), last4: last4(key), models, addedAt: now, lastOkAt: now, status: "ok" };
  await (await getStore()).put("userKeys", uid, rec);
  const { keyEnc: _k, ...pub } = rec;
  return pub;
}

export async function deleteUserKey(uid: string): Promise<void> {
  await (await getStore()).del("userKeys", uid);
}

/** Record what happened when a user's key was used, so the UI can tell them if it stopped working. */
export async function noteUserKeyResult(uid: string, err?: unknown): Promise<void> {
  const store = await getStore();
  const k = await store.get<UserKey>("userKeys", uid);
  if (!k) return;
  if (!err) {
    if (k.status !== "ok" || !k.lastOkAt || Date.now() - new Date(k.lastOkAt).getTime() > 3600_000)
      await store.update<UserKey>("userKeys", uid, { status: "ok", lastOkAt: new Date().toISOString(), lastError: undefined });
    return;
  }
  const status: UserKey["status"] = isAuthError(err) ? "invalid" : "quota";
  await store.update<UserKey>("userKeys", uid, { status, lastError: friendly(err) });
}

export async function countUserKeys(): Promise<number> {
  return (await (await getStore()).query("userKeys")).length;
}
