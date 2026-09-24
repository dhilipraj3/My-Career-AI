import { config } from "../config.js";
import type { ConnectorHealth } from "../../shared/types.js";
import { getStore } from "../db/store.js";
import { parseLocation } from "../nlp/location.js";
import { buildConnectors, type JobConnector } from "./connectors.js";
import { autoDiscoverBoards } from "./registry.js";
import { SOURCE_SETUP, discoverySettings, sourceKeyStatus, type KeyedSource } from "./settings.js";
import { describeNetError } from "./http.js";
import { ingestRawJobs, refreshFreshness } from "./ingest.js";
import type { RawJob } from "./normalize.js";

const CONNECTOR_TIMEOUT_MS = 90_000;

/** Keep jobs a candidate in India could actually take: India-based, or remote without a foreign restriction. */
export function regionOk(raw: Pick<RawJob, "location" | "remote">): boolean {
  const text = raw.location || "";
  const loc = parseLocation(text, raw.remote);
  if (loc.india) return true;
  if (loc.remote) {
    if (/worldwide|anywhere|global|apac|asia/i.test(text)) return true;
    // A bare "Remote" is open to anyone; "Remote - US", "London (remote)" etc. name a place we can't serve.
    const rest = text.toLowerCase().replace(/\b(remote|work from home|wfh|distributed|hybrid|flexible|fully|friendly|first|only|based|role|position|the|in|or|and|of|-|–|\/|\|)\b|[(),;:.]/g, " ").replace(/\s+/g, " ").trim();
    return rest === "";
  }
  return false;
}

export interface ConnectorRun {
  id: string;
  fetched: number;
  inserted: number;
  merged: number;
  rejected: number;
  regionFiltered: number;
  error?: string;
  durationMs: number;
}
export interface DiscoveryReport {
  startedAt: string;
  finishedAt: string;
  connectors: ConnectorRun[];
  newJobIds: string[];
  touchedJobIds: string[];
  expiredChanged: number;
}

let running: Promise<DiscoveryReport> | null = null;
let connectorsOverride: JobConnector[] | null = null;

export function setConnectors(c: JobConnector[] | null) {
  connectorsOverride = c;
}
const connectors = () => connectorsOverride || buildConnectors();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function baseHealth(c: JobConnector): ConnectorHealth {
  return { id: c.id, name: c.name, kind: c.kind, enabled: true, access: c.access, terms: c.terms, jobsRetrieved: 0, jobsRejected: 0, duplicates: 0, errorCount: 0, status: "unknown" };
}

const statusOf = (h: ConnectorHealth): ConnectorHealth["status"] =>
  !h.enabled ? "disabled" : h.errorCount >= 3 ? "failing" : h.errorCount > 0 ? "degraded" : h.lastSuccessAt ? "healthy" : "unknown";

export async function listConnectorHealth(): Promise<ConnectorHealth[]> {
  const store = await getStore();
  const out: ConnectorHealth[] = [];
  for (const c of connectors()) {
    const stored = await store.get<ConnectorHealth>("connectors", c.id);
    const h = { ...baseHealth(c), ...(stored || {}), name: c.name, kind: c.kind, access: c.access, terms: c.terms };
    const keyed = (SOURCE_SETUP as Record<string, (typeof SOURCE_SETUP)[KeyedSource]>)[c.id];
    const keyState = keyed ? sourceKeyStatus()[c.id as KeyedSource] : undefined;
    out.push({
      ...h, status: c.isConfigured() ? statusOf(h) : keyed ? "needs_key" : "not_set_up",
      setup: keyed ? { ...keyed, ...keyState! } : undefined, intervalMinutes: discoverySettings().sources[c.id]?.intervalMinutes,
    });
  }
  return out;
}

export async function setConnectorEnabled(id: string, enabled: boolean): Promise<ConnectorHealth | null> {
  const c = connectors().find((x) => x.id === id);
  if (!c) return null;
  const store = await getStore();
  const cur = (await store.get<ConnectorHealth>("connectors", id)) || baseHealth(c);
  const next = { ...cur, enabled };
  next.status = statusOf(next);
  await store.put("connectors", id, next);
  return next;
}

async function runConnector(c: JobConnector, keywords: string[]): Promise<{ run: ConnectorRun; newIds: string[]; touched: string[] }> {
  const store = await getStore();
  const started = Date.now();
  const health = (await store.get<ConnectorHealth>("connectors", c.id)) || baseHealth(c);
  const run: ConnectorRun = { id: c.id, fetched: 0, inserted: 0, merged: 0, rejected: 0, regionFiltered: 0, durationMs: 0 };
  let newIds: string[] = [];
  let touched: string[] = [];
  try {
    const raws = await withTimeout(c.fetch({ keywords }), c.timeoutMs ?? CONNECTOR_TIMEOUT_MS);
    run.fetched = raws.length;
    const relevant = raws.filter(regionOk);
    run.regionFiltered = raws.length - relevant.length;
    const stats = await ingestRawJobs(relevant);
    Object.assign(run, { inserted: stats.inserted, merged: stats.merged, rejected: stats.rejected });
    newIds = stats.newJobIds;
    touched = stats.jobIds;
    const next: ConnectorHealth = {
      ...health, enabled: health.enabled, name: c.name, kind: c.kind, access: c.access, terms: c.terms,
      lastSuccessAt: new Date().toISOString(), lastError: undefined, errorCount: 0,
      jobsRetrieved: health.jobsRetrieved + stats.inserted, jobsRejected: health.jobsRejected + stats.rejected, duplicates: health.duplicates + stats.merged,
      lastRun: { at: new Date().toISOString(), fetched: raws.length, inserted: stats.inserted, merged: stats.merged, rejected: stats.rejected, durationMs: Date.now() - started },
    };
    next.status = statusOf(next);
    await store.put("connectors", c.id, next);
  } catch (err: any) {
    run.error = (/fetch failed/i.test(String(err?.message)) ? describeNetError(err) : String(err?.message || err)).slice(0, 200);
    console.warn(`[discovery] connector "${c.id}" failed: ${run.error}`);
    const next: ConnectorHealth = {
      ...health, name: c.name, kind: c.kind, access: c.access, terms: c.terms, lastFailureAt: new Date().toISOString(), lastError: run.error, errorCount: health.errorCount + 1,
      lastRun: { at: new Date().toISOString(), fetched: 0, inserted: 0, merged: 0, rejected: 0, durationMs: Date.now() - started, error: run.error },
    };
    next.status = statusOf(next);
    await store.put("connectors", c.id, next);
  }
  run.durationMs = Date.now() - started;
  return { run, newIds, touched };
}

export type RunTrigger = "schedule" | "admin" | "user" | "manual";
export interface DiscoveryRunRecord extends DiscoveryReport { id: string; trigger: RunTrigger; skipped: string[]; newCompanies: number }

const HISTORY_KEEP = 30;
export const isDiscoveryRunning = () => running !== null;

/**
 * Runs every enabled+configured connector in isolation; a failing source never affects the others.
 * Scheduled runs honour per-source intervals (a source set to "every 6 hours" is skipped until due).
 */
export function runDiscovery(opts: { keywords?: string[]; connectorIds?: string[]; trigger?: RunTrigger; respectIntervals?: boolean } = {}): Promise<DiscoveryReport> {
  if (running) return running; // coalesce overlapping runs
  running = (async () => {
    const startedAt = new Date().toISOString();
    const store = await getStore();
    const settings = discoverySettings();
    const chosen: JobConnector[] = [];
    const skipped: string[] = [];
    for (const c of connectors()) {
      if (opts.connectorIds && !opts.connectorIds.includes(c.id)) continue;
      if (!c.isConfigured()) continue;
      const h = await store.get<ConnectorHealth>("connectors", c.id);
      if (h && !h.enabled) continue;
      const every = settings.sources[c.id]?.intervalMinutes;
      if (opts.respectIntervals && every && h?.lastSuccessAt && Date.now() - new Date(h.lastSuccessAt).getTime() < every * 60_000 * 0.95) {
        skipped.push(c.id);
        continue;
      }
      chosen.push(c);
    }
    // A few sources at a time: each one can hold thousands of raw postings in memory until they're ingested, and
    // running all of them at once is what ran small (512 MB) servers out of memory.
    const results: Array<Awaited<ReturnType<typeof runConnector>>> = new Array(chosen.length);
    let nextIdx = 0;
    await Promise.all(Array.from({ length: Math.max(1, Math.min(config.sources.concurrency, chosen.length)) }, async () => {
      while (nextIdx < chosen.length) {
        const i = nextIdx++;
        results[i] = await runConnector(chosen[i], opts.keywords || []);
      }
    }));
    const expiredChanged = await refreshFreshness();
    const touched = [...new Set(results.flatMap((r) => r.touched))];
    // Every job link we just saw may reveal a company careers board we don't know yet: add it, so coverage grows by itself.
    const newCompanies = await autoDiscoverBoards(touched).catch((e) => { console.warn("[registry] auto-discovery failed", e); return 0; });
    const report: DiscoveryReport = {
      startedAt, finishedAt: new Date().toISOString(), connectors: results.map((r) => r.run),
      newJobIds: results.flatMap((r) => r.newIds), touchedJobIds: touched, expiredChanged,
    };
    await recordRun({ ...report, id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, trigger: opts.trigger || "manual", skipped, newCompanies }).catch(() => undefined);
    return report;
  })().finally(() => { running = null; });
  return running;
}

async function recordRun(r: DiscoveryRunRecord) {
  const store = await getStore();
  // Keep the history light: ids and counts only, not the touched-job lists.
  await store.put("discoveryRuns", r.id, { ...r, newJobIds: [], touchedJobIds: [], newJobs: r.newJobIds.length, touchedJobs: r.touchedJobIds.length });
  const all = (await store.query<{ id: string; startedAt: string }>("discoveryRuns")).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const old of all.slice(HISTORY_KEEP)) await store.del("discoveryRuns", old.id);
}

export async function discoveryHistory(limit = HISTORY_KEEP) {
  const all = await (await getStore()).query<DiscoveryRunRecord & { newJobs: number; touchedJobs: number }>("discoveryRuns");
  return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
}
