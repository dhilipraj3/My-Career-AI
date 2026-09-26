import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { pulseOf, stageOf } from "../server/companion/service.js";
import { matchCandidate } from "../server/matching/service.js";
import { runDiscovery, setConnectors } from "../server/jobs/discovery.js";
import { FakeProvider, RESUME_TEXT, fakeConnector, freshEnv, rawJob } from "./fixtures.js";
import type { ApplicationRecord } from "../shared/types.js";

const app = createApp();
const A = { Authorization: "Bearer dev:alice" };

async function readyUser() {
  await request(app).post("/api/resume").set(A).attach("resume", Buffer.from(RESUME_TEXT), "cv.txt");
  for (let i = 0; i < 50; i++) {
    const me = await request(app).get("/api/me").set(A);
    if (["needs_info", "ready"].includes(me.body.profile?.status)) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  await request(app).post("/api/profile/answer").set(A).send({ text: "Chennai or remote, hybrid works too, minimum 20 LPA, 30 days notice" });
}

beforeEach(() => { freshEnv(); });

const appRec = (o: Partial<ApplicationRecord>): ApplicationRecord => ({
  id: "a", uid: "u", jobId: "j", company: "Acme", role: "PM", source: "x", applyUrl: "", mode: "assisted", status: "applied", notes: "", interviewDates: [], history: [], createdAt: "", updatedAt: "", ...o,
});

describe("placement companion", () => {
  it("counts responses honestly and only gives a rate once there is enough data", () => {
    const few = pulseOf([appRec({ appliedAt: "2026-09-01" })]);
    expect(few.responseRate).toBeNull();
    const apps = [1, 2, 3, 4, 5].map((n) => appRec({ id: `a${n}`, appliedAt: "2026-09-01", status: n <= 2 ? "interview" : "applied", interviewDates: n === 1 ? ["2099-01-01T10:00:00Z"] : [] }));
    const p = pulseOf(apps);
    expect(p).toMatchObject({ applied: 5, responses: 2, interviews: 2, responseRate: 40 });
    expect(p.upcoming).toHaveLength(1);
  });

  it("stage follows the furthest thing that has really happened", () => {
    const ready = { status: "ready" } as any;
    expect(stageOf(ready, [], false)).toBe("searching");
    expect(stageOf({ status: "empty" } as any, [], false)).toBe("understanding");
    expect(stageOf(ready, [appRec({ status: "applied" })], false)).toBe("applying");
    expect(stageOf(ready, [appRec({ status: "applied" }), appRec({ status: "interview" })], false)).toBe("interviewing");
    expect(stageOf(ready, [appRec({ status: "offer" })], false)).toBe("offer");
    expect(stageOf(ready, [], true)).toBe("placed");
  });

  it("journey → interview action → placed pauses the search; undo resumes it", async () => {
    await readyUser();
    setConnectors([fakeConnector("greenhouse", [rawJob()])]);
    await runDiscovery();
    await matchCandidate("alice", { notifyNew: true });
    const feed = await request(app).get("/api/feed").set(A);
    const jobId = feed.body.items[0].job.id;
    const prep = await request(app).post(`/api/jobs/${jobId}/prepare`).set(A).send({});
    const appId = prep.body.application.id;
    await request(app).post(`/api/resume-versions/${prep.body.resume.id}/approve`).set(A).send({});
    await request(app).post(`/api/applications/${appId}/status`).set(A).send({ status: "applied" });
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    await request(app).post(`/api/applications/${appId}/status`).set(A).send({ status: "interview", interviewDate: soon });

    const j = await request(app).get("/api/companion/journey").set(A);
    expect(j.body.journey.stage).toBe("interviewing");
    expect(j.body.journey.actions[0]).toMatchObject({ kind: "interview" });
    expect(j.body.plan.goals.map((g: any) => g.id)).toEqual(["apply", "practise", "learn", "profile"]);
    expect(j.body.plan.goals.find((g: any) => g.id === "apply").done).toBe(1); // counted automatically
    expect(j.body.activity.some((a: any) => /Tailored a resume/.test(a.text))).toBe(true);

    const tick = await request(app).post("/api/companion/plan/tick").set(A).send({ goal: "practise", done: 2 });
    expect(tick.body.plan.goals.find((g: any) => g.id === "practise").done).toBe(2);
    const auto = await request(app).post("/api/companion/plan/tick").set(A).send({ goal: "apply", done: 9 }); // auto goals can't be self-reported
    expect(auto.body.plan.goals.find((g: any) => g.id === "apply").done).toBe(1);

    const placed = await request(app).post("/api/companion/placed").set(A).send({ company: "Acme", role: "Senior Project Manager", salaryLPA: 24 });
    expect(placed.status).toBe(200);
    const after = await request(app).get("/api/companion/journey").set(A);
    expect(after.body.journey).toMatchObject({ stage: "placed", actions: [] });
    expect((await request(app).get("/api/profile").set(A)).body.profile.discoveryPaused).toBe(true);

    await request(app).delete("/api/companion/placed").set(A);
    expect((await request(app).get("/api/profile").set(A)).body.profile.discoveryPaused).toBe(false);
  });

  it("needs sign-in", async () => {
    expect((await request(app).get("/api/companion/journey")).status).toBe(401);
  });
});
void FakeProvider;

describe("quiet nudge", () => {
  it("starts the conversation after 5 quiet days, and only once", async () => {
    const { quietNudge } = await import("../server/scheduler.js");
    const { listNotifications } = await import("../server/notifications.js");
    await readyUser();
    const later = Date.now() + 6 * 86_400_000;
    await quietNudge("alice", later);
    await quietNudge("alice", later + 1000);
    const nudges = (await listNotifications("alice")).filter((n) => n.title.startsWith("Let's pick up"));
    expect(nudges).toHaveLength(1);
    await quietNudge("alice", Date.now()); // active today → nothing new
  });
});
