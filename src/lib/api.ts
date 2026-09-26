import { useSyncExternalStore } from "react";
import { auth } from "./firebase";

/** `?dev=alice` in the URL (dev builds only) uses the server's DEV_AUTH_BYPASS so the app runs without Google sign-in. */
export const devUser = import.meta.env.DEV || import.meta.env.VITE_DEV_AUTH === "true" ? new URLSearchParams(location.search).get("dev") : null;

export async function token(): Promise<string | null> {
  if (devUser) return `dev:${devUser}`;
  return (await auth.currentUser?.getIdToken()) ?? null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

// ---------------- loading indicator: how many requests are in flight ----------------
let inFlight = 0;
const loadListeners = new Set<() => void>();
const bump = (d: number) => { inFlight = Math.max(0, inFlight + d); loadListeners.forEach((l) => l()); };
/** True while any request is running (drives the thin progress bar at the top of the app). */
export const useLoading = () => useSyncExternalStore((cb) => { loadListeners.add(cb); return () => loadListeners.delete(cb); }, () => inFlight > 0);

// ---------------- read cache: moving between screens is instant ----------------
// Reads are kept for a minute, so going back to a screen shows it immediately. Any change (save, apply, upload…)
// clears the cache, so nothing you just changed can show an old value. Live things are never cached.
const TTL_MS = 60_000;
const NEVER_CACHE = /^\/(me$|notifications|sync-status|agent\/(chat|history|briefing)|interview\/mock\/|inbox|me\/export|public)/;
const cache = new Map<string, { at: number; data: unknown }>();
const pending = new Map<string, Promise<unknown>>();
export const clearApiCache = () => { cache.clear(); pending.clear(); };

async function request<T>(path: string, opts: { method?: string; body?: unknown; form?: FormData }): Promise<T> {
  const t = await token();
  const headers: Record<string, string> = {};
  if (t) headers.Authorization = `Bearer ${t}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  bump(1);
  try {
    const res = await fetch(`/api${path}`, {
      method: opts.method || (opts.body !== undefined || opts.form ? "POST" : "GET"),
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || "Something went wrong", data.code);
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, "Can't reach MyCareer.AI. Check your connection and try again.");
  } finally {
    bump(-1);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData; fresh?: boolean } = {}): Promise<T> {
  const isRead = !opts.method && opts.body === undefined && !opts.form;
  if (!isRead) {
    const out = await request<T>(path, opts);
    clearApiCache();
    return out;
  }
  if (NEVER_CACHE.test(path) || opts.fresh) return request<T>(path, opts);
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T;
  const running = pending.get(path);
  if (running) return running as Promise<T>;
  const p = request<T>(path, opts).then((data) => { cache.set(path, { at: Date.now(), data }); return data; }).finally(() => pending.delete(path));
  pending.set(path, p);
  return p;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** Download a file the server generates for the signed-in user (data export, calendar file…). */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const t = await token();
  const res = await fetch(`/api${path}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Download failed");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
