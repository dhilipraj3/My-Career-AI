// People come first. Background work (fetching jobs, re-scoring everyone) runs on the same small server as the app, so
// it works in short slices and lets people's requests go first between them. Someone clicking around slows the
// background work down (it keeps a small share); it never stops it, and it never makes them wait for it.
import type { RequestHandler } from "express";

let lastRequestAt = 0;
let inFlight = 0;
let polite = !process.env.VITEST && process.env.NODE_ENV !== "test";
let sliceStart = performance.now();
const SLICE_MS = 20;

/** Counts real user requests (not the keep-awake pings). Mount before the API. */
export function trackUsers(): RequestHandler {
  return (req, res, next) => {
    if (req.path === "/health" || req.path === "/api/health") return next();
    inFlight++;
    lastRequestAt = Date.now();
    let done = false;
    const end = () => { if (!done) { done = true; inFlight--; lastRequestAt = Date.now(); } };
    res.on("finish", end);
    res.on("close", end);
    next();
  };
}

/** A request is being answered, or one just finished (a screen usually fires several in a row). */
export const someoneIsUsingTheApp = () => inFlight > 0 || Date.now() - lastRequestAt < 300;
export const setPolite = (on: boolean) => { polite = on; };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const breathe = () => new Promise<void>((r) => setImmediate(r));

/**
 * Call often inside background loops (it is cheap when there is nothing to do). Once a 20 ms slice of work is used up it
 * lets waiting requests run; if someone is actively using the app it also rests for up to maxWaitMs before the next slice.
 */
export async function yieldToUsers(maxWaitMs = 250): Promise<void> {
  if (performance.now() - sliceStart < SLICE_MS) return;
  if (polite && someoneIsUsingTheApp()) {
    const start = Date.now();
    while (someoneIsUsingTheApp() && Date.now() - start < maxWaitMs) await sleep(25);
  } else await breathe();
  sliceStart = performance.now();
}
