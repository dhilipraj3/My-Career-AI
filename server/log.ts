// Structured logs (one JSON line each, easy to search on any host) and a small in-memory list of recent errors for the
// admin screen. No personal data: request paths without query strings, ids and error text only.
import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export interface ErrorEntry { at: string; requestId: string; method: string; path: string; status: number; message: string; stack?: string }

const RING_SIZE = 50;
const ring: ErrorEntry[] = [];

export const recentErrors = () => [...ring].reverse();
export const _clearErrors = () => { ring.length = 0; };

export function log(level: "info" | "warn" | "error", msg: string, meta: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, msg, at: new Date().toISOString(), ...meta });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export function recordError(req: Request, err: unknown, status = 500): string {
  const requestId = String((req as any).requestId || "");
  const e = err instanceof Error ? err : new Error(String(err));
  const entry: ErrorEntry = { at: new Date().toISOString(), requestId, method: req.method, path: req.path, status, message: e.message.slice(0, 300), stack: e.stack?.split("\n").slice(0, 6).join("\n") };
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
  log("error", "request.failed", { requestId, method: entry.method, path: entry.path, status, message: entry.message });
  return requestId;
}

/** Gives every request an id (also returned as X-Request-Id) and logs slow ones. */
export function requestContext(slowMs = 3000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = (req.get("x-request-id") || "").replace(/[^\w-]/g, "").slice(0, 40) || crypto.randomBytes(6).toString("hex");
    (req as any).requestId = id;
    res.setHeader("X-Request-Id", id);
    const t0 = Date.now();
    res.on("finish", () => { const ms = Date.now() - t0; if (ms > slowMs && req.path !== "/api/health") log("warn", "request.slow", { requestId: id, method: req.method, path: req.path, status: res.statusCode, ms }); });
    next();
  };
}
