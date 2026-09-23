import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { getStore } from "../server/db/store.js";
import { runDiscovery, setConnectors } from "../server/jobs/discovery.js";
import { LOCATION_CAP, scoreBand } from "../server/matching/engine.js";
import { matchCandidate } from "../server/matching/service.js";
import { RESUME_TEXT, fakeConnector, freshEnv, rawJob } from "./fixtures.js";

const app = createApp();
const A = { Authorization: "Bearer dev:alice" };

async function onboard() {
  await request(app).post("/api/resume").set(A).attach("resume", Buffer.from(RESUME_TEXT), "cv.txt");
  for (let i = 0; i < 50; i++) {
    const me = await request(app).get("/api/me").set(A);
    if (me.body.profile?.status === "needs_info") break;
    await new Promise((r) => setTimeout(r, 40));
  }
  const r = await request(app).post("/api/profile/answer").set(A).send({ text: "Chennai only, hybrid or remote, minimum 20 LPA, 30 days notice" });
  expect(r.body.profile.status).toBe("ready");
}

const pm = (id: string, location: string, extra = {}) => rawJob({ sourceJobId: id, url: `https://x.example/${id}`, applyUrl: `https://x.example/${id}`, company: `Company ${id}`, location, ...extra });

beforeEach(async () => {
  freshEnv();
  setConnectors([fakeConnector("greenhouse", [
    pm("c1", "Chennai, India"),
    pm("b1", "Bengaluru, India"), pm("b2", "Bengaluru, India"), pm("h1", "Hyderabad, India"),
    pm("r1", "Remote - India", { remote: true }),
  ])]);
  await runDiscovery();
  await onboard();
  await matchCandidate("alice");
});

describe("scoring honesty", () => {
  it("score bands", () => {
    expect([85, 70, 55, 30].map(scoreBand)).toEqual(["excellent", "good", "fair", "low"]);
  });

  it("jobs outside the candidate's cities are capped at Fair and say why; remote and local are not", async () => {
    const matches = await (await getStore()).query<any>("matches", { where: { uid: "alice" } });
    const jobs = await (await getStore()).query<any>("jobs");
    const byLoc = (loc: string) => matches.find((m) => jobs.find((j) => j.id === m.jobId).location === loc);
    expect(byLoc("Bengaluru, India").score).toBeLessThanOrEqual(LOCATION_CAP);
    expect(byLoc("Bengaluru, India").gaps.join(" ")).toMatch(/outside your preferred locations \(Chennai\)/);
    expect(byLoc("Chennai, India").score).toBeGreaterThan(LOCATION_CAP);
    expect(byLoc("Remote - India").score).toBeGreaterThan(LOCATION_CAP);
  });
});

describe("For you", () => {
  it("summary gives real totals per band and diagnoses why there are no excellent matches", async () => {
    const s = (await request(app).get("/api/feed/summary").set(A)).body;
    const b = s.bands;
    expect(b.excellent + b.good + b.fair + b.low).toBe(5);
    expect(s.total).toBe(b.excellent + b.good + b.fair);
    if (b.excellent < 3) {
      const loc = s.diagnosis.find((d: any) => d.kind === "location");
      expect(loc.title).toMatch(/outside Chennai/);
      expect(loc.cities).toContain("Bengaluru");
    }
    expect(s.newSinceLastVisit).toBe(0); // first visit: nothing is "new since last time"
  });

  it("counts new matches only after a previous visit", async () => {
    await request(app).post("/api/feed/seen").set(A).send({});
    setConnectors([fakeConnector("greenhouse", [pm("c2", "Chennai, India", { title: "Senior Project Manager - Payments" })])]);
    await runDiscovery();
    await matchCandidate("alice");
    expect((await request(app).get("/api/feed/summary").set(A)).body.newSinceLastVisit).toBe(1);
  });

  it("the matched-only list pages through every match, not a silent top 60", async () => {
    const all = (await request(app).get("/api/jobs/search?matchedOnly=true&minScore=0&sort=match&pageSize=2").set(A)).body;
    expect(all.total).toBe(5);
    expect(all.hits).toHaveLength(2);
    expect(all.hits[0].matchScore).toBeGreaterThanOrEqual(all.hits[1].matchScore);
    const fairUp = (await request(app).get("/api/jobs/search?matchedOnly=true&minScore=50").set(A)).body;
    expect(fairUp.hits.every((h: any) => h.matchScore >= 50)).toBe(true);
  });

  it("hidden and applied jobs leave the matched list", async () => {
    const list = (await request(app).get("/api/jobs/search?matchedOnly=true&minScore=0").set(A)).body.hits;
    await request(app).post(`/api/jobs/${list[0].job.id}/hide`).set(A).send({ reason: "not_relevant" });
    await request(app).post(`/api/jobs/${list[1].job.id}/direct-apply`).set(A).send({ confirm: true });
    const after = (await request(app).get("/api/jobs/search?matchedOnly=true&minScore=0").set(A)).body;
    expect(after.total).toBe(3);
  });
});
