import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { annualTax, compareOffers, monthlyInHand } from "../server/interview/offers.js";
import { interviewCalendar } from "../server/interview/ics.js";
import { scoreAnswer } from "../server/interview/mock.js";
import { matchCandidate } from "../server/matching/service.js";
import { runDiscovery, setConnectors } from "../server/jobs/discovery.js";
import { RESUME_TEXT, fakeConnector, freshEnv, rawJob } from "./fixtures.js";
import type { ApplicationRecord, CandidateProfile } from "../shared/types.js";
import type { PrepQuestion } from "../shared/interview.js";

const app = createApp();
const A = { Authorization: "Bearer dev:alice" };
const B = { Authorization: "Bearer dev:bob" };

async function readyUser(h = A) {
  await request(app).post("/api/resume").set(h).attach("resume", Buffer.from(RESUME_TEXT), "cv.txt");
  for (let i = 0; i < 50; i++) {
    const me = await request(app).get("/api/me").set(h);
    if (["needs_info", "ready"].includes(me.body.profile?.status)) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  await request(app).post("/api/profile/answer").set(h).send({ text: "Chennai or remote, hybrid works too, minimum 20 LPA, 30 days notice" });
}
async function firstJob() {
  setConnectors([fakeConnector("greenhouse", [rawJob()])]);
  await runDiscovery();
  await matchCandidate("alice", { notifyNew: true });
  return (await request(app).get("/api/feed").set(A)).body.items[0].job.id as string;
}
beforeEach(() => { freshEnv(); });

const profile = { skills: [{ key: "jira", source: "resume", name: "JIRA" }] } as unknown as CandidateProfile;
const behavioural: PrepQuestion = { id: "q", kind: "behavioural", question: "Tell me about a time you faced a conflict at work and how you handled it.", tip: "" };

describe("mock interview scoring", () => {
  it("scores a structured, evidenced answer above a vague one, and explains why", () => {
    const strong = scoreAnswer(behavioural, "When I was leading the Chennai project, two engineers disagreed on the release approach and the situation was blocking the team. My responsibility was to unblock delivery. I set up a short call, listened to both views, and proposed a phased release. As a result we shipped 3 days earlier and reduced defects by 20%.", profile);
    const vague = scoreAnswer(behavioural, "Um, basically we just talked and like it was fine, you know, we sort of worked it out and it was good in the end and everyone was happy actually.", profile);
    expect(strong.score).toBeGreaterThan(vague.score + 15);
    expect(strong.strengths.join(" ")).toMatch(/number|structure/i);
    expect(vague.improvements.join(" ")).toMatch(/filler|STAR|number/i);
  });

  it("flags a skill claimed in the answer that is not on the profile", () => {
    const fb = scoreAnswer({ ...behavioural, kind: "technical" }, "I have deep experience with Kubernetes and Terraform in production, where I ran clusters and reduced downtime by 40 percent last year for our clients.", profile);
    expect(fb.flags.join(" ")).toMatch(/kubernetes/i);
  });

  it("tells the user when an answer is too short", () => {
    expect(scoreAnswer(behavioural, "I talked to them.", profile).improvements[0]).toMatch(/short/);
  });
});

describe("offers", () => {
  it("estimates in-hand pay with the new tax regime", () => {
    expect(annualTax(1_100_000)).toBe(0); // section 87A rebate
    expect(annualTax(2_000_000)).toBe(Math.round(((800_000 - 400_000) * 0.05 + (1_200_000 - 800_000) * 0.1 + (1_600_000 - 1_200_000) * 0.15 + (2_000_000 - 1_600_000) * 0.2) * 1.04));
    expect(monthlyInHand(10)).toBeGreaterThan(65_000);
    expect(monthlyInHand(10)).toBeLessThan(83_334);
    expect(monthlyInHand(30)).toBeGreaterThan(monthlyInHand(20));
  });

  it("compares offers and highlights real differences only", () => {
    const c = compareOffers([
      { company: "Acme", role: "PM", fixedLPA: 20, variableLPA: 0, growth: 3, commuteMinutes: 20 },
      { company: "Beta", role: "PM", fixedLPA: 18, variableLPA: 6, growth: 5, commuteMinutes: 20 },
    ]);
    expect(c.offers.every((o) => o.estimate)).toBe(true);
    const labels = Object.fromEntries(c.highlights.map((h) => [h.label, h.company]));
    expect(labels["Highest monthly in-hand"]).toBe("Acme");
    expect(labels["Highest first-year total"]).toBe("Beta");
    expect(labels["Best growth"]).toBe("Beta");
    expect(labels["Shortest commute"]).toBeUndefined(); // a tie must not produce a false winner
    expect(c.notes.join(" ")).toMatch(/Acme pays more every month, but Beta/);
  });
});

describe("calendar", () => {
  it("produces a valid event with reminders and escapes text", () => {
    const a = { id: "app1", role: "PM, Payments", company: "Acme; Co", interviewDates: ["2026-10-01T10:00:00Z", "not a date"] } as unknown as ApplicationRecord;
    const ics = interviewCalendar(a);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(1);
    expect(ics).toContain("DTSTART:20261001T100000Z");
    expect(ics).toContain("DTEND:20261001T110000Z");
    expect(ics).toContain("SUMMARY:Interview: PM\\, Payments at Acme\\; Co");
    expect(ics).toContain("TRIGGER:-PT1H");
  });
});

describe("interview API", () => {
  it("prep → mock interview → history, and counts toward this week's practice", async () => {
    await readyUser();
    const jobId = await firstJob();
    const prep = (await request(app).get(`/api/interview/prep/${jobId}`).set(A)).body.prep;
    expect(prep.generatedBy).toBe("rules");
    const kinds = new Set(prep.questions.map((x: any) => x.kind));
    expect(kinds.has("behavioural") && kinds.has("role")).toBe(true);
    expect(prep.stories.length).toBeGreaterThan(0);
    expect(prep.stories[0].prompts.result).toMatch(/true/); // asks the candidate; never invents the result
    expect(prep.askEmployer.length).toBeGreaterThanOrEqual(5);

    const start = await request(app).post("/api/interview/mock").set(A).send({ jobId });
    expect(start.status).toBe(201);
    const id = start.body.session.id;
    let last: any;
    for (let i = 0; i < start.body.session.questions.length; i++) {
      last = await request(app).post(`/api/interview/mock/${id}/answer`).set(A).send({ text: "When I was leading a delivery, the team had a tight deadline. My responsibility was the plan. I organised daily standups and reduced blockers by 30 percent, so we shipped on time." });
      expect(last.status).toBe(200);
    }
    expect(last.body.session.status).toBe("done");
    expect(last.body.session.score).toBeGreaterThan(40);
    expect(last.body.next).toBeNull();
    expect((await request(app).post(`/api/interview/mock/${id}/answer`).set(A).send({ text: "more" })).status).toBe(409);

    const hist = await request(app).get("/api/interview/mocks").set(A);
    expect(hist.body.sessions[0]).toMatchObject({ id, status: "done" });
    const plan = (await request(app).get("/api/companion/journey").set(A)).body.plan;
    expect(plan.goals.find((g: any) => g.id === "practise").done).toBe(1);
  });

  it("keeps sessions and applications private to their owner", async () => {
    await readyUser(); await readyUser(B);
    const jobId = await firstJob();
    const s = (await request(app).post("/api/interview/mock").set(A).send({ jobId })).body.session;
    expect((await request(app).get(`/api/interview/mock/${s.id}`).set(B)).status).toBe(404);
    expect((await request(app).post(`/api/interview/mock/${s.id}/answer`).set(B).send({ text: "hi" })).status).toBe(404);
  });

  it("drafts messages from real application facts and negotiates with market data", async () => {
    await readyUser(); await readyUser(B);
    const jobId = await firstJob();
    const prep = (await request(app).post(`/api/jobs/${jobId}/prepare`).set(A).send({})).body;
    const id = prep.application.id;
    const fu = (await request(app).post(`/api/applications/${id}/draft`).set(A).send({ kind: "follow_up" })).body.draft;
    expect(fu.subject).toMatch(/Following up/);
    expect(fu.body).toContain("Acme");
    const neg = (await request(app).post(`/api/applications/${id}/draft`).set(A).send({ kind: "negotiate", offerLPA: 20 })).body.draft;
    expect(neg.body).toContain("₹20 LPA");
    expect(neg.notes.join(" ")).toMatch(/whole package/);
    expect((await request(app).post(`/api/applications/${id}/draft`).set(B).send({ kind: "follow_up" })).status).toBe(404);
  });

  it("exports interview dates as .ics and 404s when there are none", async () => {
    await readyUser();
    const jobId = await firstJob();
    const prep = (await request(app).post(`/api/jobs/${jobId}/prepare`).set(A).send({})).body;
    const id = prep.application.id;
    expect((await request(app).get(`/api/applications/${id}/calendar.ics`).set(A)).status).toBe(404);
    await request(app).post(`/api/resume-versions/${prep.resume.id}/approve`).set(A).send({});
    await request(app).post(`/api/applications/${id}/status`).set(A).send({ status: "applied" });
    await request(app).post(`/api/applications/${id}/status`).set(A).send({ status: "interview", interviewDate: "2026-10-01T10:00:00Z" });
    const ics = await request(app).get(`/api/applications/${id}/calendar.ics`).set(A);
    expect(ics.status).toBe(200);
    expect(ics.headers["content-type"]).toMatch(/text\/calendar/);
    expect(ics.text).toContain("DTSTART:20261001T100000Z");
  });

  it("explains what tailoring changed", async () => {
    await readyUser();
    const jobId = await firstJob();
    const prep = (await request(app).post(`/api/jobs/${jobId}/prepare`).set(A).send({})).body;
    const ch = (await request(app).get(`/api/resume-versions/${prep.resume.id}/changes`).set(A)).body.changes;
    expect(ch.headline.after).toMatch(/Seeking/);
    expect(ch.fit.length).toBeGreaterThan(0);
    expect(ch.experience.length).toBeGreaterThan(0);
  });

  it("validates offers input and needs sign-in", async () => {
    expect((await request(app).post("/api/offers/compare").set(A).send({ offers: [] })).status).toBe(400);
    expect((await request(app).post("/api/offers/compare")).status).toBe(401);
    expect((await request(app).post("/api/offers/compare").set(A).send({ offers: [{ company: "Acme", fixedLPA: 12 }] })).status).toBe(200);
  });
});
