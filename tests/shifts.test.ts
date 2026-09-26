import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { detectShift } from "../server/jobs/normalize.js";
import { computeMatch, shiftMismatch } from "../server/matching/engine.js";
import { runDiscovery, setConnectors } from "../server/jobs/discovery.js";
import { getStore } from "../server/db/store.js";
import { RESUME_TEXT, fakeConnector, freshEnv, rawJob } from "./fixtures.js";
import type { CandidateProfile, Job } from "../shared/types.js";

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
  await request(app).post("/api/profile/answer").set(A).send({ text: "Chennai or remote, hybrid works too, minimum 20 LPA, 30 days notice" });
}

describe("shifts", () => {
  it("reads the working hours a posting states", () => {
    expect(detectShift("Customer support executive. Rotational shifts, 24x7 process.")).toBe("rotational");
    expect(detectShift("Voice process, US shift, cab provided")).toBe("night");
    expect(detectShift("Timings: 9 PM to 6 AM")).toBe("night");
    expect(detectShift("General shift, Monday to Friday")).toBe("day");
    expect(detectShift("Flexible hours, work from home")).toBe("flexible");
    expect(detectShift("We are hiring a project manager in Chennai.")).toBeUndefined();
  });

  it("keeps night and rotational jobs out of top matches for day-shift people, and says why", async () => {
    await readyUser();
    const store = await getStore();
    const p = (await store.get<CandidateProfile>("profiles", "alice"))!;
    setConnectors([fakeConnector("greenhouse", [rawJob(), rawJob({ sourceJobId: "n1", company: "NightCo", description: `${rawJob().description}\nThis role is on a night shift (US hours).`, url: "https://boards.greenhouse.io/n/jobs/1", applyUrl: "https://boards.greenhouse.io/n/jobs/1" })])]);
    await runDiscovery();
    const jobs = await store.query<Job>("jobs");
    const day = jobs.find((j) => j.company !== "NightCo")!, night = jobs.find((j) => j.company === "NightCo")!;
    expect(night.shift).toBe("night");
    const dayPerson = { ...p, preferences: { ...p.preferences, shifts: ["day" as const] } };
    expect(shiftMismatch(dayPerson, night)).toBe(true);
    expect(shiftMismatch(dayPerson, day)).toBe(false);
    expect(shiftMismatch({ ...p, preferences: { ...p.preferences, shifts: ["any" as const] } }, night)).toBe(false);
    const a = computeMatch({ profile: dayPerson, job: night }), b = computeMatch({ profile: { ...p, preferences: { ...p.preferences, shifts: ["night" as const] } }, job: night });
    expect(a.score).toBeLessThan(b.score);
    expect(a.gaps.join(" ")).toMatch(/Night shift job; you said you work day shifts/);
  });

  it("asks about job type, then shifts, and saves the answer", async () => {
    await readyUser();
    const ans = (questionId: string, choices: string[]) => request(app).post("/api/career/understanding/answer").set(A).send({ questionId, choices });
    for (const [q, c] of [["locations", ["Chennai"]], ["salary", ["lpa:18"]], ["notice", ["days:30"]], ["workModes", ["any"]], ["employment", ["full_time", "contract"]]] as const) await ans(q, [...c]);
    let u = (await request(app).get("/api/career/understanding").set(A)).body;
    const avail = u.areas.find((x: any) => x.id === "availability");
    expect(avail.gaps.join(" ")).toMatch(/shifts/);
    const r = await ans("shifts", ["day", "flexible"]);
    expect(r.body.profile.preferences.shifts).toEqual(["day", "flexible"]);
    u = r.body.understanding;
    expect(u.areas.find((x: any) => x.id === "availability").evidence.join(" ")).toMatch(/Shifts: day, flexible/);
    const anyShift = await ans("shifts", ["day", "any"]);
    expect(anyShift.body.profile.preferences.shifts).toEqual(["any"]);
  });

  it("confirms an estimated experience instead of asking from scratch", async () => {
    await readyUser();
    const store = await getStore();
    const p = (await store.get<CandidateProfile>("profiles", "alice"))!;
    // Resume without clear dates: an estimate, not a fact.
    await store.put("profiles", "alice", { ...p, experience: p.experience.map((e) => ({ ...e, startDate: undefined, endDate: undefined })), totalExperienceYears: 11.2, provenance: { ...p.provenance, totalExperienceYears: "resume" } });
    await request(app).post("/api/career/understanding/answer").set(A).send({ questionId: "role", choices: ["Senior Project Manager"] });
    await request(app).post("/api/career/understanding/answer").set(A).send({ questionId: "motivation", choices: ["growth"] });
    const u = (await request(app).get("/api/career/understanding").set(A)).body;
    const q = u.next;
    expect(q.id).toBe("experience");
    const area = u.areas.find((x: any) => x.id === "experience");
    expect(area.gaps.join(" ")).toMatch(/Confirm/);
    {
      expect(q.text).toBe("Your resume suggests about 11 years of experience. Is that right?");
      expect(q.choices[0]).toEqual({ value: "years:11", label: "Yes, about 11 years" });
    }
    const r = await request(app).post("/api/career/understanding/answer").set(A).send({ questionId: "experience", choices: ["years:11"] });
    expect(r.body.profile.totalExperienceYears).toBe(11);
    expect(r.body.understanding.areas.find((x: any) => x.id === "experience").score).toBe(100);
  });
});
