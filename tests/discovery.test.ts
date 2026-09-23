import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyRecord } from "../shared/types.js";
import { createApp } from "../server/app.js";
import { config } from "../server/config.js";
import { getStore } from "../server/db/store.js";
import { fetchHimalayas, fetchJobicy, fetchRemoteOk } from "../server/jobs/aggregators.js";
import { fetchTeamtailor } from "../server/jobs/ats.js";
import { detectFromText } from "../server/jobs/detect.js";
import { discoveryHistory, listConnectorHealth, regionOk, runDiscovery, setConnectors } from "../server/jobs/discovery.js";
import { describeNetError, fetchJson, hostCoolingDown, httpLimits } from "../server/jobs/http.js";
import { ingestRawJobs } from "../server/jobs/ingest.js";
import { autoDiscoverBoards, companyId } from "../server/jobs/registry.js";
import { discoverySettings, loadDiscoverySettings, removeSourceKey, saveDiscoverySettings } from "../server/jobs/settings.js";
import { fakeConnector, freshEnv, rawJob } from "./fixtures.js";

const app = createApp();
const ADMIN = { Authorization: "Bearer dev:admin" };
const USER = { Authorization: "Bearer dev:alice" };

function mockFetch(handler: (url: string, init?: any) => Response | Promise<Response>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    calls.push(`${init?.method || "GET"} ${url}`);
    return handler(url, init);
  }));
  return calls;
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

beforeEach(async () => {
  freshEnv();
  await loadDiscoverySettings(); // reset module state to defaults for the new in-memory store
});
afterEach(() => vi.unstubAllGlobals());

describe("reliable fetching", () => {
  it("explains network failures instead of 'fetch failed'", () => {
    expect(describeNetError(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }))).toMatch(/DNS/);
    expect(describeNetError(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }))).toMatch(/reset/);
    expect(describeNetError(Object.assign(new Error("x"), { name: "AbortError" }))).toMatch(/timed out/);
    expect(describeNetError(Object.assign(new TypeError("fetch failed"), { cause: { code: "EWHATEVER" } }))).toMatch(/EWHATEVER/);
  });

  it("backs off a host that answers 429 and leaves other hosts alone", async () => {
    const calls = mockFetch((url) => (url.includes("busy.example") ? json({}, 429, { "retry-after": "120" }) : json({ ok: true })));
    await expect(fetchJson("https://busy.example/a")).rejects.toThrow(/429/);
    expect(hostCoolingDown("busy.example")).toBeGreaterThan(100_000);
    // No second request: the cooldown answers without touching the network.
    await expect(fetchJson("https://busy.example/b")).rejects.toThrow(/cooling down/);
    expect(calls.filter((c) => c.includes("busy.example"))).toHaveLength(1);
    expect(await fetchJson("https://calm.example/x")).toEqual({ ok: true });
  });

  it("does not retry a 404 but does retry a network blip", async () => {
    const saved = httpLimits.retries;
    httpLimits.retries = 1;
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      let n = 0;
      const calls = mockFetch((url) => {
        if (url.includes("gone")) return json({}, 404);
        if (n++ === 0) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
        return json({ ok: 1 });
      });
      await expect(fetchJson("https://x.example/gone")).rejects.toThrow(/HTTP 404/);
      const p = fetchJson("https://x.example/flaky");
      await vi.advanceTimersByTimeAsync(1500);
      expect(await p).toEqual({ ok: 1 });
      expect(calls.filter((c) => c.includes("gone"))).toHaveLength(1);
      expect(calls.filter((c) => c.includes("flaky"))).toHaveLength(2);
    } finally {
      vi.useRealTimers();
      httpLimits.retries = saved;
    }
  });
});

describe("discovery settings", () => {
  it("admin can change schedule and pace; values apply live and persist", async () => {
    const res = await request(app).put("/api/admin/discovery/settings").set(ADMIN).send({ intervalMinutes: 180, maxConcurrent: 3, timeoutSeconds: 30, boardsPerRun: 80 });
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ intervalMinutes: 180, maxConcurrent: 3, timeoutSeconds: 30, boardsPerRun: 80 });
    expect(httpLimits.maxConcurrent).toBe(3);
    expect(httpLimits.timeoutMs).toBe(30_000);
    expect(config.sources.boardsPerRun).toBe(80);
    expect(await (await getStore()).get("settings", "discovery")).toMatchObject({ intervalMinutes: 180 });
  });

  it("rejects out-of-range and unknown settings, and is admin-only", async () => {
    expect((await request(app).put("/api/admin/discovery/settings").set(ADMIN).send({ intervalMinutes: 1 })).status).toBe(400);
    expect((await request(app).put("/api/admin/discovery/settings").set(ADMIN).send({ hack: true })).status).toBe(400);
    expect((await request(app).put("/api/admin/discovery/settings").set(USER).send({ paused: true })).status).toBe(403);
    expect((await request(app).get("/api/admin/discovery").set(USER)).status).toBe(403);
  });

  it("overview reports schedule, history, sources and registry growth", async () => {
    setConnectors([fakeConnector("greenhouse", [rawJob()])]);
    await runDiscovery({ trigger: "manual" });
    const res = await request(app).get("/api/admin/discovery").set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.history[0]).toMatchObject({ trigger: "manual" });
    expect(res.body.history[0].connectors[0]).toMatchObject({ id: "greenhouse", fetched: 1, inserted: 1 });
    expect(res.body.connectors[0].lastRun).toMatchObject({ fetched: 1, inserted: 1 });
    expect(res.body.registry.total).toBeGreaterThan(0);
    expect(res.body.state).toHaveProperty("paused");
  });

  it("manual run starts in the background and answers 202", async () => {
    setConnectors([fakeConnector("slow", () => new Promise((r) => setTimeout(() => r([]), 50)))]);
    const res = await request(app).post("/api/admin/discovery/run").set(ADMIN).send({ connectorIds: ["slow"] });
    expect(res.status).toBe(202);
    expect(res.body.started).toBe(true);
    const again = await request(app).post("/api/admin/discovery/run").set(ADMIN).send({ connectorIds: ["slow"] });
    expect(again.body.started).toBe(false);
    await new Promise((r) => setTimeout(r, 120));
    expect((await discoveryHistory())[0].connectors.map((c) => c.id)).toEqual(["slow"]);
  });
});

describe("per-source schedule and history", () => {
  it("skips a source until its own interval has passed, on scheduled runs only", async () => {
    const fetchA = vi.fn(async () => [rawJob()]);
    const fetchB = vi.fn(async () => [rawJob({ sourceJobId: "2", title: "Scrum Master", url: "https://boards.greenhouse.io/acme/jobs/2" })]);
    setConnectors([{ ...fakeConnector("a", []), fetch: fetchA }, { ...fakeConnector("b", []), fetch: fetchB }]);
    await saveDiscoverySettings({ sources: { b: { intervalMinutes: 360 } } });
    await runDiscovery({ trigger: "schedule", respectIntervals: true });
    await runDiscovery({ trigger: "schedule", respectIntervals: true });
    expect(fetchA).toHaveBeenCalledTimes(2);
    expect(fetchB).toHaveBeenCalledTimes(1); // second run: not due yet
    const [latest] = await discoveryHistory();
    expect(latest.skipped).toEqual(["b"]);
    await runDiscovery({ trigger: "admin" }); // an admin "run now" ignores intervals
    expect(fetchB).toHaveBeenCalledTimes(2);
  });

  it("keeps a bounded run history, newest first", async () => {
    setConnectors([fakeConnector("a", [])]);
    for (let i = 0; i < 33; i++) await runDiscovery({ trigger: "manual" });
    const h = await discoveryHistory(100);
    expect(h.length).toBe(30);
    expect(h[0].startedAt >= h[29].startedAt).toBe(true);
  });

  it("records the real error cause on the source", async () => {
    setConnectors([fakeConnector("broken", async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); })]);
    await runDiscovery();
    const h = (await listConnectorHealth()).find((c) => c.id === "broken")!;
    expect(h.lastError).toMatch(/DNS/);
    expect(h.lastRun?.error).toMatch(/DNS/);
  });
});

describe("keyed sources", () => {
  afterEach(async () => { await removeSourceKey("jooble"); });

  it("a source without a key says so and links to the free sign-up", async () => {
    setConnectors(null); // real connector list
    const jooble = (await listConnectorHealth()).find((c) => c.id === "jooble")!;
    if (jooble.setup?.from === "env") return; // a developer's .env key makes this case moot
    expect(jooble.status).toBe("needs_key");
    expect(jooble.setup?.url).toMatch(/^https:\/\/jooble\.org/);
    expect(jooble.setup?.fields.map((f) => f.id)).toEqual(["key"]);
  });

  it("tests a pasted key before keeping it, stores it encrypted and never returns it", async () => {
    setConnectors(null);
    if (config.jooble.apiKey) return;
    mockFetch((url) => (url.startsWith("https://jooble.org/api/") ? json({ jobs: [{ id: 1, title: "Project Manager", company: "Acme", location: "Pune", snippet: "Lead delivery", link: "https://jooble.org/desc/1" }] }) : json({}, 404)));
    const res = await request(app).put("/api/admin/sources/jooble/key").set(ADMIN).send({ key: "jooble-secret-key-123456" });
    expect(res.status).toBe(200);
    expect(res.body.sample).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain("jooble-secret-key-123456");
    const stored = JSON.stringify(await (await getStore()).get("settings", "sourceKeys"));
    expect(stored).not.toContain("jooble-secret-key-123456");
    expect(res.body.connectors.find((c: any) => c.id === "jooble").setup).toMatchObject({ configured: true, from: "admin" });

    expect((await request(app).delete("/api/admin/sources/jooble/key").set(ADMIN)).status).toBe(200);
    expect(config.jooble.apiKey).toBe("");
  });

  it("drops a key the source rejects", async () => {
    setConnectors(null);
    if (config.jooble.apiKey) return;
    mockFetch(() => json({ error: "bad key" }, 403));
    const res = await request(app).put("/api/admin/sources/jooble/key").set(ADMIN).send({ key: "wrong-key-000000000" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/didn't work/);
    expect(config.jooble.apiKey).toBe("");
  });

  it("only known sources accept keys, and only from admins", async () => {
    expect((await request(app).put("/api/admin/sources/evil/key").set(ADMIN).send({ key: "x".repeat(20) })).status).toBe(400);
    expect((await request(app).put("/api/admin/sources/jooble/key").set(USER).send({ key: "x".repeat(20) })).status).toBe(403);
  });
});

describe("self-growing registry", () => {
  it("adds company boards it recognises in job links", async () => {
    const stats = await ingestRawJobs([
      rawJob({ connector: "careerjet", sourceName: "Careerjet", sourceJobId: "cj1", company: "Newco", applyUrl: "https://jobs.lever.co/newco/abc", url: "https://www.careerjet.co.in/x" }),
      rawJob({ connector: "careerjet", sourceName: "Careerjet", sourceJobId: "cj2", title: "Data Analyst", company: "Tailco", applyUrl: "https://tailco.teamtailor.com/jobs/1-analyst", url: "https://www.careerjet.co.in/y" }),
    ]);
    expect(await autoDiscoverBoards(stats.jobIds)).toBe(2);
    const store = await getStore();
    expect(await store.get<CompanyRecord>("companies", companyId("lever", "newco"))).toMatchObject({ origin: "auto", name: "Newco", enabled: true });
    expect(await store.get<CompanyRecord>("companies", companyId("teamtailor", "tailco.teamtailor.com"))).toMatchObject({ origin: "auto" });
    expect(await autoDiscoverBoards(stats.jobIds)).toBe(0); // idempotent
  });

  it("discovery runs register boards from what they fetched", async () => {
    setConnectors([fakeConnector("careerjet", [rawJob({ connector: "careerjet", sourceName: "Careerjet", url: "https://www.careerjet.co.in/z", applyUrl: "https://jobs.ashbyhq.com/freshco/1", company: "Freshco" })])]);
    await runDiscovery();
    const [run] = await discoveryHistory();
    expect(run.newCompanies).toBe(1);
    expect(await (await getStore()).get<CompanyRecord>("companies", companyId("ashby", "freshco"))).toMatchObject({ origin: "auto", name: "Freshco" });
  });
});

describe("new free sources", () => {
  it("Himalayas keeps worldwide and India roles, marks them remote and follows the cursor", async () => {
    mockFetch((url) => url.includes("cursor=") ? json({ jobs: [] }) : json({
      nextCursor: "abc",
      jobs: [
        { title: "Backend Engineer", companyName: "Acme", guid: "https://himalayas.app/j/1", applicationLink: "https://acme.com/apply", locationRestrictions: [], description: "<p>Build APIs</p>", pubDate: 1_750_000_000 },
        { title: "Support Lead", companyName: "Beta", guid: "https://himalayas.app/j/2", applicationLink: "https://beta.com/apply", locationRestrictions: ["India"], description: "Help users" },
        { title: "US Sales", companyName: "Gamma", guid: "https://himalayas.app/j/3", applicationLink: "https://g.com", locationRestrictions: ["United States"], description: "Sell" },
      ],
    }));
    const jobs = await fetchHimalayas();
    expect(jobs).toHaveLength(3);
    expect(jobs.filter(regionOk).map((j) => j.title)).toEqual(["Backend Engineer", "Support Lead"]);
    expect(jobs[0]).toMatchObject({ remote: true, description: "Build APIs", applyUrl: "https://acme.com/apply" });
    expect(new Date(jobs[0].postedAt!).getFullYear()).toBeGreaterThan(2020);
  });

  it("Remote OK skips its legal notice and credits the source", async () => {
    mockFetch(() => json([{ legal: "API terms" }, { id: 7, position: "React Developer", company: "Delta", location: "", description: "UI work", url: "https://remoteok.com/remote-jobs/7", apply_url: "https://delta.io/apply", date: "2026-09-01T00:00:00Z" }]));
    const jobs = await fetchRemoteOk();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ sourceName: "Remote OK", url: "https://remoteok.com/remote-jobs/7", remote: true });
    expect(regionOk(jobs[0])).toBe(true);
  });

  it("Jobicy fetches APAC and anywhere roles", async () => {
    const calls = mockFetch((url) => json({ jobs: [{ id: url.includes("apac") ? 1 : 2, jobTitle: "QA Engineer", companyName: "Eps", jobGeo: url.includes("apac") ? "APAC" : "Anywhere", jobDescription: "Test", url: "https://jobicy.com/jobs/1", pubDate: "2026-09-01" }] }));
    const jobs = await fetchJobicy();
    expect(calls.some((c) => c.includes("geo=apac")) && calls.some((c) => c.includes("geo=anywhere"))).toBe(true);
    expect(jobs.every(regionOk)).toBe(true);
  });

  it("Teamtailor boards are detected and read from their jobs feed", async () => {
    expect(detectFromText("https://acme.teamtailor.com/jobs/123-engineer")).toMatchObject({ ats: "teamtailor", board: "acme.teamtailor.com" });
    mockFetch(() => json({ items: [{ id: "123", title: "Field Sales Executive", url: "https://acme.teamtailor.com/jobs/123", date_published: "2026-09-10", content_html: "<p>Sell in Pune</p>",
      _jobposting: { title: "Field Sales Executive", description: "<p>Sell in Pune</p>", hiringOrganization: { name: "Acme" }, jobLocation: [{ address: { addressLocality: "Pune", addressCountry: "IN" } }], datePosted: "2026-09-10" } }] }));
    const [job] = await fetchTeamtailor("acme.teamtailor.com", "Acme");
    expect(job).toMatchObject({ connector: "teamtailor", sourceJobId: "123", title: "Field Sales Executive", company: "Acme", url: "https://acme.teamtailor.com/jobs/123" });
    expect(job.location).toMatch(/Pune/);
    expect(regionOk(job)).toBe(true);
  });
});

describe("sync status for users", () => {
  it("tells signed-in users when jobs were last updated", async () => {
    setConnectors([fakeConnector("greenhouse", [rawJob()])]);
    await runDiscovery();
    const res = await request(app).get("/api/sync-status").set(USER);
    expect(res.status).toBe(200);
    expect(res.body.lastSyncAt).toBeTruthy();
    expect(res.body).toHaveProperty("nextRunAt");
    expect(res.body.liveJobs).toBeGreaterThanOrEqual(1);
    expect((await request(app).get("/api/sync-status")).status).toBe(401);
  });

  it("settings reset between tests", () => {
    expect(discoverySettings().sources).toEqual({});
  });
});
