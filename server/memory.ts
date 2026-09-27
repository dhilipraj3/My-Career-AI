// How much memory this server really has. Containers (Render, Docker) limit memory with cgroups, while the OS still
// reports the whole host's RAM — so read the cgroup limit first.
import fs from "node:fs";
import os from "node:os";

export function containerMemoryMB(): number {
  const read = (f: string) => { try { return fs.readFileSync(f, "utf8").trim(); } catch { return ""; } };
  const v2 = read("/sys/fs/cgroup/memory.max"); // cgroup v2: bytes or "max"
  if (v2 && v2 !== "max" && Number(v2) > 0) return Math.round(Number(v2) / 1048576);
  const v1 = read("/sys/fs/cgroup/memory/memory.limit_in_bytes"); // cgroup v1 (huge number when unlimited)
  if (v1 && Number(v1) > 0 && Number(v1) < 2 ** 50) return Math.round(Number(v1) / 1048576);
  return Math.round(os.totalmem() / 1048576);
}

/** Small servers (Render free = 512 MB) get gentler defaults for background work. */
export const isSmallServer = () => process.env.FORCE_SMALL_SERVER === "1" || containerMemoryMB() <= 1024;

// ---------------- live pressure on the JavaScript heap ----------------
import v8 from "node:v8";

/** Share of the heap limit in use right now (0..1). The limit is the one the process was started with. */
export const heapFraction = (): number => {
  const s = v8.getHeapStatistics();
  // scripts/start.mjs tells us the limit it set (the engine's own figure also counts short-lived young-generation space).
  const limit = Number(process.env.HEAP_LIMIT_MB) > 0 ? Number(process.env.HEAP_LIMIT_MB) * 1048576 : s.heap_size_limit;
  return s.used_heap_size / limit;
};

/** One line for the logs: how much memory the app is really using. */
export function memoryLine(): string {
  const m = process.memoryUsage();
  return `[mem] heap ${Math.round(m.heapUsed / 1048576)} MB (${Math.round(heapFraction() * 100)}% of limit), rss ${Math.round(m.rss / 1048576)} MB, external ${Math.round(m.external / 1048576)} MB`;
}

/** Give the collector a chance (only if the process was started with --expose-gc; see scripts/start.mjs). */
export const tryCollect = () => { (globalThis as { gc?: () => void }).gc?.(); };

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Background work that downloads and parses big files calls this before each one. True when there is room; if the heap
 * is above `threshold` it lets things settle for up to `maxWaitMs` and returns false when it never came down, so the
 * caller can skip that piece instead of taking the whole server down with an out-of-memory crash.
 */
export async function waitForMemory(threshold = 0.7, maxWaitMs = 15_000): Promise<boolean> {
  const start = Date.now();
  while (heapFraction() > threshold) {
    tryCollect();
    if (Date.now() - start >= maxWaitMs) return false;
    await pause(500);
  }
  return true;
}

/** Most downloads a small server may run at once (each is parsed in memory, several times its size). */
export const maxParallelDownloads = (wanted: number): number => (isSmallServer() ? Math.min(wanted, 2) : wanted);

/** Largest single download (bytes) we will read into memory. */
export const maxDownloadBytes = (): number => Number(process.env.MAX_DOWNLOAD_MB || (isSmallServer() ? 6 : 16)) * 1048576;
