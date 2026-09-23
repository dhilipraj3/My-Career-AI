import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { ingestRawJobs } from "../server/jobs/ingest.js";
import { _resetPublicCache } from "../server/public.js";
import { freshEnv, rawJob } from "./fixtures.js";

const app = createApp();

beforeEach(async () => {
  freshEnv();
  _resetPublicCache();
  await ingestRawJobs([
    rawJob({ sourceJobId: "1", title: "Data Analyst", company: "Insight Co", location: "Bengaluru", url: "https://x.example/1", applyUrl: "https://x.example/1", description: "Analyse sales data with SQL and Excel for regional teams. Freshers welcome. Build weekly dashboards for managers." }),
    rawJob({ sourceJobId: "2", title: "Senior Project Manager", company: "Acme", location: "Chennai", url: "https://x.example/2", applyUrl: "https://x.example/2" }),
  ]);
  // A private job a user pasted in must never reach the public.
  await ingestRawJobs([rawJob({ connector: "user_manual", sourceJobId: "p", title: "Secret Data Analyst Role", company: "Private Co", url: "", applyUrl: "" })], { ownerUid: "alice" });
});

describe("public landing endpoints (no sign-in)", () => {
  it("stats are real counts of live public jobs", async () => {
    const r = await request(app).get("/api/public/stats");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ liveJobs: 2, companies: 2, freshersJobs: 1 });
    expect(r.body.topCities.map((c: any) => c.city).sort()).toEqual(["Bengaluru", "Chennai"]);
  });

  it("search returns safe fields only, never private jobs", async () => {
    const r = await request(app).get("/api/public/search?q=data%20analyst");
    expect(r.status).toBe(200);
    expect(r.body.jobs.map((j: any) => j.title)).toEqual(["Data Analyst"]);
    const j = r.body.jobs[0];
    expect(Object.keys(j).sort()).toEqual(["company", "freshersWelcome", "location", "postedAt", "title", "workMode"].sort());
    expect(JSON.stringify(r.body)).not.toMatch(/Secret|Private Co|description|matchScore|sources|x\.example/);
  });

  it("validates input", async () => {
    expect((await request(app).get("/api/public/search?q=a")).status).toBe(400);
    expect((await request(app).get(`/api/public/search?q=${"x".repeat(80)}`)).status).toBe(400);
  });

  it("everything else still needs sign-in", async () => {
    expect((await request(app).get("/api/jobs/search?q=data")).status).toBe(401);
  });
});
