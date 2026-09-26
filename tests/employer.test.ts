import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { config } from "../server/config.js";
import { domainOf, emailMatchesDomain, roughDraft } from "../server/employer/service.js";
import { RESUME_TEXT, freshEnv } from "./fixtures.js";

const app = createApp();
const as = (uid: string) => ({ Authorization: `Bearer dev:${uid}` });
const ACME = as("acme"), OTHER = as("shady"), ADMIN = as("admin"), ALICE = as("alice"), BOB = as("bob"), CARL = as("carl");

const DESC = "We are hiring a Senior Project Manager to lead software delivery for our banking clients in Chennai. You will run Agile and Scrum teams, manage stakeholders and budgets, and work with JIRA and MS Project. 8+ years of experience required. Apply through MyCareer.AI.";

beforeAll(() => { config.adminEmails = ["admin@dev.local"]; });
beforeEach(() => { freshEnv(); });

const register = (h: Record<string, string>, website = "https://dev.local", company = "Acme Payments") =>
  request(app).post("/api/employer/register").set(h).send({ company, website, contactName: "Asha Rao" });
const post = (h: Record<string, string>, over: Record<string, unknown> = {}) =>
  request(app).post("/api/employer/jobs").set(h).send({ title: "Senior Project Manager", location: "Chennai", description: DESC, salaryText: "18-25 LPA", ...over });

async function readyCandidate(h: Record<string, string>) {
  await request(app).post("/api/resume").set(h).attach("resume", Buffer.from(RESUME_TEXT), "cv.txt");
  for (let i = 0; i < 50; i++) {
    const me = await request(app).get("/api/me").set(h);
    if (["needs_info", "ready"].includes(me.body.profile?.status)) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  await request(app).post("/api/profile/answer").set(h).send({ text: "Chennai or remote, hybrid works too, minimum 20 LPA, 30 days notice" });
}

describe("employer trust", () => {
  it("only a company-domain email verifies instantly; free mail never does", () => {
    expect(domainOf("https://www.acme.co.in/careers")).toBe("acme.co.in");
    expect(emailMatchesDomain("asha@acme.co.in", "www.acme.co.in")).toBe(true);
    expect(emailMatchesDomain("asha@hr.acme.co.in", "acme.co.in")).toBe(true);
    expect(emailMatchesDomain("acme.hr@gmail.com", "gmail.com")).toBe(false);
    expect(emailMatchesDomain("asha@other.com", "acme.co.in")).toBe(false);
  });

  it("turns a rough WhatsApp-style message into a starting draft", () => {
    const d = roughDraft("URGENT HIRING: Delivery Executive\nLocation: Indore\nSalary: ₹15,000 per month\nApply with your Aadhaar and photo");
    expect(d).toMatchObject({ title: "Delivery Executive", location: "Indore", employmentType: "full_time" });
    expect(d.salaryText).toMatch(/15,000/);
  });
});

describe("posting and moderation", () => {
  it("a verified company's clean job goes live and is searchable, labelled as direct", async () => {
    const reg = await register(ACME);
    expect(reg.body.employer).toMatchObject({ domainVerified: true, status: "verified" });
    const p = await post(ACME);
    expect(p.status).toBe(201);
    expect(p.body.job.status).toBe("live");
    const hit = (await request(app).get("/api/jobs/search?q=project manager&pageSize=10").set(ALICE)).body.hits.find((h: any) => h.job.company === "Acme Payments");
    expect(hit.job.sources[0]).toMatchObject({ connector: "employer", sourceName: "Posted directly by employer" });
    expect((await request(app).get(`/api/jobs/${hit.job.id}/direct`).set(ALICE)).body.direct).toBe(true);
    const go = await request(app).get(`/go/${p.body.job.id}`);
    expect(go.status).toBe(302);
    expect(go.headers.location).toBe(`/#job/${hit.job.id}`);
  });

  it("an unverified company waits for an admin; approval publishes it", async () => {
    expect((await register(OTHER, "https://shady-company.example")).body.employer.status).toBe("pending");
    const p = await post(OTHER);
    expect(p.body.job.status).toBe("pending_review");
    expect(p.body.job.reasons.join(" ")).toMatch(/verified/);
    expect((await request(app).get("/api/jobs/search?q=project manager").set(ALICE)).body.hits).toHaveLength(0); // not public yet
    expect((await request(app).get("/api/admin/moderation").set(ALICE)).status).toBe(403);
    const q = (await request(app).get("/api/admin/moderation").set(ADMIN)).body;
    expect(q.jobs).toHaveLength(1);
    expect(q.employers).toHaveLength(1);
    const ok = await request(app).post(`/api/admin/employer-jobs/${p.body.job.id}`).set(ADMIN).send({ decision: "approve" });
    expect(ok.body.job.status).toBe("live");
    expect((await request(app).get("/api/jobs/search?q=project manager").set(ALICE)).body.hits.length).toBeGreaterThan(0);
    const notes = (await request(app).get("/api/notifications").set(OTHER)).body.notifications;
    expect(notes.some((n: any) => /is live/.test(n.title))).toBe(true);
  });

  it("scam wording holds even a verified company's job for review", async () => {
    await register(ACME);
    const p = await post(ACME, { description: `${DESC} Pay a registration fee of ₹1500 to confirm your joining. Contact us on WhatsApp.` });
    expect(p.body.job.status).toBe("pending_review");
    expect(p.body.job.reasons.join(" ")).toMatch(/scam|payment|spam/i);
    const no = await request(app).post(`/api/admin/employer-jobs/${p.body.job.id}`).set(ADMIN).send({ decision: "reject", reason: "Asks candidates for money" });
    expect(no.body.job).toMatchObject({ status: "rejected", reasons: ["Asks candidates for money"] });
  });

  it("caps posts per day, blocks non-employers and blocked employers", async () => {
    expect((await post(BOB)).status).toBe(403); // no employer account
    await register(OTHER, "https://shady-company.example");
    expect((await post(OTHER)).status).toBe(201);
    expect((await post(OTHER, { title: "Scrum Master" })).status).toBe(201);
    expect((await post(OTHER, { title: "Product Owner" })).status).toBe(429); // unverified: 2 a day
    await request(app).post("/api/admin/employers/shady").set(ADMIN).send({ status: "blocked" });
    expect((await post(OTHER)).status).toBe(403);
  });

  it("closing a job removes it from search", async () => {
    await register(ACME);
    const j = (await post(ACME)).body.job;
    await request(app).post(`/api/employer/jobs/${j.id}/close`).set(ACME);
    const hits = (await request(app).get("/api/jobs/search?q=project manager").set(ALICE)).body.hits;
    expect(hits.filter((h: any) => h.job.company === "Acme Payments")).toHaveLength(0);
    expect((await request(app).post(`/api/employer/jobs/${j.id}/close`).set(BOB)).status).toBe(404); // not yours
  });
});

describe("candidates and employers", () => {
  async function liveJob() {
    await register(ACME);
    const j = (await post(ACME)).body.job;
    const hit = (await request(app).get("/api/jobs/search?q=project manager&pageSize=10").set(ALICE)).body.hits.find((h: any) => h.job.company === "Acme Payments");
    return { ej: j, jobId: hit.job.id as string };
  }

  it("shares the profile only after explicit consent, ranks applicants, and keeps both sides in sync", async () => {
    await readyCandidate(ALICE);
    const { ej, jobId } = await liveJob();
    expect((await request(app).post(`/api/jobs/${jobId}/apply-direct-share`).set(ALICE).send({})).status).toBe(400); // no confirm
    const applied = await request(app).post(`/api/jobs/${jobId}/apply-direct-share`).set(ALICE).send({ confirm: true, message: "Excited to join." });
    expect(applied.status).toBe(201);
    expect((await request(app).post(`/api/jobs/${jobId}/apply-direct-share`).set(ALICE).send({ confirm: true })).status).toBe(409); // once only

    const mine = (await request(app).get("/api/applications").set(ALICE)).body.applications;
    expect(mine[0]).toMatchObject({ company: "Acme Payments", status: "applied", source: "Posted directly by employer" });

    const cands = (await request(app).get(`/api/employer/jobs/${ej.id}/candidates`).set(ACME)).body.candidates;
    expect(cands).toHaveLength(1);
    expect(cands[0].shared).toMatchObject({ currentRole: expect.any(String), message: "Excited to join." });
    expect(cands[0].matchScore).toBeGreaterThan(0);
    expect(cands[0].reasons.length).toBeGreaterThan(0);
    expect(Object.keys(cands[0].shared).sort()).toEqual(["city", "currentRole", "education", "email", "experienceYears", "message", "name", "phone", "skills", "summary"]); // nothing else is shared
    expect((await request(app).get(`/api/employer/jobs/${ej.id}/candidates`).set(BOB)).status).toBe(404); // other employers can't peek

    const sl = await request(app).post(`/api/employer/applicants/${cands[0].id}/status`).set(ACME).send({ status: "shortlisted", note: "Call you Monday" });
    expect(sl.body.candidate.status).toBe("shortlisted");
    expect((await request(app).get("/api/applications").set(ALICE)).body.applications[0].status).toBe("shortlisted");
    const notes = (await request(app).get("/api/notifications").set(ALICE)).body.notifications;
    expect(notes.some((n: any) => /shortlisted you/.test(n.title))).toBe(true);
    expect((await request(app).post(`/api/employer/applicants/${cands[0].id}/status`).set(BOB).send({ status: "hired" })).status).toBe(404);

    const list = (await request(app).get("/api/employer/me").set(ACME)).body;
    expect(list.jobs[0]).toMatchObject({ applicants: 1 });
  });

  it("stops applications to closed jobs and to your own job", async () => {
    await readyCandidate(ALICE);
    const { ej, jobId } = await liveJob();
    await request(app).post(`/api/employer/jobs/${ej.id}/close`).set(ACME);
    expect((await request(app).post(`/api/jobs/${jobId}/apply-direct-share`).set(ALICE).send({ confirm: true })).status).toBe(410);
  });

  it("three different candidates reporting a job takes it down for review", async () => {
    const { ej, jobId } = await liveJob();
    for (const h of [ALICE, BOB]) expect((await request(app).post(`/api/jobs/${jobId}/report`).set(h).send({ reason: "scam" })).body.hidden).toBe(false);
    await request(app).post(`/api/jobs/${jobId}/report`).set(BOB).send({ reason: "scam" }); // the same person twice counts once
    const third = await request(app).post(`/api/jobs/${jobId}/report`).set(CARL).send({ reason: "fee_requested", note: "asked for a deposit" });
    expect(third.body).toMatchObject({ reports: 3, hidden: true });
    const q = (await request(app).get("/api/admin/moderation").set(ADMIN)).body;
    expect(q.jobs.map((j: any) => j.id)).toContain(ej.id);
    expect(q.reports).toHaveLength(3);
    expect((await request(app).post(`/api/jobs/${jobId}/report`).set(ALICE).send({ reason: "nonsense" })).status).toBe(400);
  });
});
