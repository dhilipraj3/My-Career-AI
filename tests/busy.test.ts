import express from "express";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { setPolite, someoneIsUsingTheApp, trackUsers, yieldToUsers } from "../server/busy.js";

afterEach(() => setPolite(false));

describe("background work steps aside for people", () => {
  it("waits while a request is in flight, then carries on; ignores health pings", async () => {
    setPolite(true);
    let release!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    const app = express();
    app.use("/api", trackUsers());
    app.get("/api/slow", async (_req, res) => { await hold; res.json({ ok: true }); });
    app.get("/api/health", (_req, res) => res.json({ ok: true }));
    const server = await new Promise<http.Server>((r) => { const s = app.listen(0, () => r(s)); });
    const port = (server.address() as { port: number }).port;

    await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(someoneIsUsingTheApp()).toBe(false); // keep-awake pings don't count as people

    const pending = fetch(`http://127.0.0.1:${port}/api/slow`).then((r) => r.json());
    await new Promise((r) => setTimeout(r, 100));
    expect(someoneIsUsingTheApp()).toBe(true);

    await new Promise((r) => setTimeout(r, 40)); // a slice of work has been used up
    let resumed = false;
    const waiting = yieldToUsers(5000).then(() => { resumed = true; });
    await new Promise((r) => setTimeout(r, 600));
    expect(resumed).toBe(false); // still holding back while the request is open
    release(); await pending;
    await waiting;
    expect(resumed).toBe(true);
    server.close();
  });

  it("never waits longer than the limit, so background work still finishes on a busy day", async () => {
    setPolite(true);
    const app = express();
    app.use("/api", trackUsers());
    app.get("/api/never", () => { /* never answers */ });
    const server = await new Promise<http.Server>((r) => { const s = app.listen(0, () => r(s)); });
    const ctl = new AbortController();
    void fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/never`, { signal: ctl.signal }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 40));
    const t = Date.now();
    await yieldToUsers(700);
    expect(Date.now() - t).toBeLessThan(1500);
    ctl.abort(); server.close();
  });
});
