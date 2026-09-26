import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { runDiscovery, setConnectors } from "../server/jobs/discovery.js";
import { matchCandidate } from "../server/matching/service.js";
import { RESUME_TEXT, fakeConnector, freshEnv, rawJob } from "./fixtures.js";

const app = createApp();
const A = { Authorization: "Bearer dev:alice" };
beforeEach(() => { freshEnv(); });

async function readyUser() {
  await request(app).post("/api/resume").set(A).attach("resume", Buffer.from(RESUME_TEXT), "cv.txt");
  for (let i = 0; i < 50; i++) {
    const me = await request(app).get("/api/me").set(A);
    if (["needs_info", "ready"].includes(me.body.profile?.status)) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  await request(app).post("/api/profile/answer").set(A).send({ text: "Chennai or remote, hybrid works too, minimum 5 LPA, 30 days notice" });
}
const summary = async () => (await request(app).get("/api/feed/summary").set(A)).body;
const prefs = async (patch: object) => { await request(app).put("/api/profile/preferences").set(A).send(patch); await matchCandidate("alice"); };

describe("when preferences hide the jobs", () => {
  it("says so, names the preference, and adding it back brings the jobs back", async () => {
    await readyUser();
    setConnectors([fakeConnector("greenhouse", [1, 2, 3, 4].map((i) => rawJob({ sourceJobId: `h${i}`, company: `Northwind${i} Technologies Pvt Ltd`, url: `https://boards.greenhouse.io/h/jobs/${i}`, applyUrl: `https://boards.greenhouse.io/h/jobs/${i}`, employmentType: "full_time" })))]);
    await runDiscovery();
    await matchCandidate("alice");
    expect((await summary()).total).toBeGreaterThan(0); // full-time is fine before the preference is set
    await prefs({ employmentTypes: ["contract"] });
    const s = await summary();
    expect(s.total).toBe(0);
    const d = s.diagnosis.find((x: any) => x.kind === "preferences");
    expect(d.title).toMatch(/4 jobs are hidden by your preferences/);
    expect(d.detail).toMatch(/job type \(full time: 4\)/);
    expect(d.employmentTypes).toEqual(["full_time"]);
    await prefs({ employmentTypes: ["contract", "full_time"] });
    const after = await summary();
    expect(after.total).toBeGreaterThan(0);
    expect(after.diagnosis.some((x: any) => x.kind === "preferences")).toBe(false);

  });
});
