import dns from "node:dns/promises";
import net from "node:net";
import { config } from "../config.js";

// Tunable at runtime from Admin → Discovery settings (see server/jobs/settings.ts).
export const httpLimits = { timeoutMs: 20_000, maxConcurrent: 6, retries: 2 };

// Discovery fans out to dozens of company boards. Cap concurrent outbound requests so we stay polite to
// the job-board APIs and don't exhaust sockets / the DNS thread pool (which shows up as connect timeouts).
let active = 0;
const waiters: Array<() => void> = [];
async function acquire() {
  if (active >= httpLimits.maxConcurrent) await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
}
function release() {
  active--;
  waiters.shift()?.();
}

/** A site told us to slow down (HTTP 429). We back off that host only; everything else keeps going. */
export class RateLimitedError extends Error {}
const hostCooldown = new Map<string, number>();
export const hostCoolingDown = (host: string) => Math.max(0, (hostCooldown.get(host) || 0) - Date.now());

const NET_CAUSES: Record<string, string> = {
  ENOTFOUND: "address not found (DNS)", EAI_AGAIN: "DNS lookup timed out", ECONNRESET: "connection was reset", ECONNREFUSED: "connection refused",
  ETIMEDOUT: "connection timed out", UND_ERR_CONNECT_TIMEOUT: "connection timed out", UND_ERR_HEADERS_TIMEOUT: "site took too long to answer",
  UND_ERR_SOCKET: "connection dropped", CERT_HAS_EXPIRED: "site's security certificate has expired", UNABLE_TO_VERIFY_LEAF_SIGNATURE: "site's certificate couldn't be verified",
};

/** Turn Node's bare "fetch failed" into the real reason, so Admin can tell a blip from a block. */
export function describeNetError(err: any): string {
  if (err?.name === "AbortError" || /aborted/i.test(String(err?.message))) return `timed out after ${Math.round(httpLimits.timeoutMs / 1000)}s`;
  const code = err?.cause?.code || err?.code;
  if (code) return NET_CAUSES[code] || `network error (${code})`;
  return String(err?.message || err);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const host = new URL(url).hostname;
  const wait = hostCoolingDown(host);
  if (wait > 0) throw new RateLimitedError(`rate limited by ${host} — cooling down ${Math.ceil(wait / 1000)}s`);
  await acquire();
  try {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= httpLimits.retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), httpLimits.timeoutMs);
      try {
        const res = await fetch(url, {
          ...init,
          signal: ctrl.signal,
          headers: { Accept: "application/json", "User-Agent": config.userAgent, ...(init.headers || {}) },
        });
        if (res.status === 429) {
          // Respect Retry-After when given; otherwise back off this host for 5 minutes.
          const after = Number(res.headers.get("retry-after"));
          hostCooldown.set(host, Date.now() + (Number.isFinite(after) && after > 0 ? Math.min(after, 3600) * 1000 : 300_000));
          throw Object.assign(new RateLimitedError(`HTTP 429 — rate limited by ${host}`), { noRetry: true });
        }
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status} from ${host}`);
          if (res.status < 500) throw Object.assign(err, { noRetry: true }); // 404, 403 etc. won't improve by retrying
          throw err;
        }
        return (await res.json()) as T;
      } catch (err: any) {
        lastErr = err?.noRetry || err instanceof RateLimitedError || /^HTTP /.test(String(err?.message)) ? err : new Error(describeNetError(err), { cause: err });
        if (err?.noRetry) break;
        if (attempt < httpLimits.retries) await sleep(1000 * 3 ** attempt); // 1s, 3s, 9s…
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  } finally {
    release();
  }
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}

export class UnsafeUrlError extends Error {}

/** SSRF guard: http(s) only, no credentials, public IPs only. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That doesn't look like a valid URL.");
  }
  if (!/^https?:$/.test(u.protocol)) throw new UnsafeUrlError("Only http(s) links are supported.");
  if (u.username || u.password) throw new UnsafeUrlError("Links with credentials are not allowed.");
  if (u.port && !["80", "443", ""].includes(u.port)) throw new UnsafeUrlError("Unsupported port.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new UnsafeUrlError("That address is not allowed.");
  } else {
    if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new UnsafeUrlError("That address is not allowed.");
    const addrs = await dns.lookup(host, { all: true }).catch(() => []);
    if (!addrs.length) throw new UnsafeUrlError("Couldn't resolve that address.");
    if (addrs.some((a) => isPrivateIp(a.address))) throw new UnsafeUrlError("That address is not allowed.");
  }
  return u;
}

/** Fetches a user-supplied page: SSRF-checked at every redirect hop, size- and time-capped. */
export async function safeFetchText(rawUrl: string, maxBytes = 2_000_000): Promise<{ url: string; text: string; contentType: string }> {
  let current = rawUrl;
  for (let hop = 0; hop < 4; hop++) {
    const u = await assertPublicUrl(current);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), httpLimits.timeoutMs);
    try {
      const res = await fetch(u, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "User-Agent": config.userAgent, Accept: "text/html,application/xhtml+xml,application/json" },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location")!, u).toString();
        continue;
      }
      if (!res.ok) throw new Error(`The site responded with HTTP ${res.status}.`);
      const reader = res.body?.getReader();
      if (!reader) return { url: u.toString(), text: await res.text(), contentType: res.headers.get("content-type") || "" };
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
      return { url: u.toString(), text: Buffer.concat(chunks).toString("utf8"), contentType: res.headers.get("content-type") || "" };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects.");
}
