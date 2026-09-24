import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { setProviders } from "../server/ai/gateway.js";
import { _resetCareerCaches } from "../server/career/routes.js";
import { ruleFacts } from "../server/career/interview.js";
import { runDiscovery, setConnectors } from "../server/jobs/discovery.js";
import { FakeProvider, RESUME_TEXT, fakeConnector, freshEnv, rawJob } from "./fixtures.js";

const app = createApp();
const A = { Authorization: "Bearer dev:alice" };
const B = { Authorization: "Bearer dev:bob" };

async function uploadResume(headers = A) {
  await request(app).post("/api/resume").set(headers).attach("resume", Buffer.from(RESUME_TEXT), "cv.txt");
  for (let i = 0; i < 50; i++) {
    const me = await request(app).get("/api/me").set(headers);
    if (["needs_info", "ready"].includes(me.body.profile?.status)) return me.body.profile;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("never parsed");
}

async function seedJobs() {
  setConnectors([fakeConnector("greenhouse", [
    rawJob(),
    rawJob({ sourceJobId: "2", title: "Project Manager", company: "Beta Payments", description: `Payments team.\n${rawJob().description}\nKanban and Confluence required. Salary 18-26 LPA.`, url: "https://boards.greenhouse.io/beta/jobs/2", applyUrl: "https://boards.greenhouse.io/beta/jobs/2" }),
    rawJob({ sourceJobId: "4", company: "Delta Bank", description: `Core banking.
${rawJob().description}`, url: "https://boards.greenhouse.io/delta/jobs/4", applyUrl: "https://boards.greenhouse.io/delta/jobs/4" }),
    rawJob({ sourceJobId: "5", company: "Epsilon Tech", description: `Platform team.
${rawJob().description}`, url: "https://boards.greenhouse.io/eps/jobs/5", applyUrl: "https://boards.greenhouse.io/eps/jobs/5" }),
    rawJob({ sourceJobId: "3", title: "Scrum Master", company: "Gamma Cloud", location: "Pune, India", description: `Cloud programme.\n${rawJob().description}\nKanban, Jira. Salary 20-28 LPA.`, url: "https://boards.greenhouse.io/gamma/jobs/3", applyUrl: "https://boards.greenhouse.io/gamma/jobs/3" }),
  ])]);
  await runDiscovery();
}

const understanding = async (headers = A, lang = "en") => (await request(app).get(`/api/career/understanding?lang=${lang}`).set(headers)).body;
const answer = (body: object, headers = A) => request(app).post("/api/career/understanding/answer").set(headers).send(body);

beforeEach(() => { freshEnv(); _resetCareerCaches(); });

describe("understanding: confidence model and question planner", () => {
  it("scores six areas from evidence and asks the most useful question first", async () => {
    await uploadResume();
    const u = await understanding();
    expect(u.areas.map((a: any) => a.id)).toEqual(["role", "skills", "experience", "locationPay", "availability", "motivation"]);
    expect(u.areas.find((a: any) => a.id === "experience").score).toBeGreaterThanOrEqual(90); // dated roles on the resume
    expect(u.areas.find((a: any) => a.id === "role").score).toBe(55); // guessed from the resume, not confirmed
    expect(u.score).toBeLessThan(u.threshold);
    expect(u.next.id).toBe("locations"); // nothing known about location yet: the biggest uncertainty × weight
    await answer({ questionId: "locations", choices: ["Chennai"] });
    await answer({ questionId: "salary", choices: ["lpa:18"] });
    const u2 = await understanding();
    expect(u2.next.id).toBe("role"); // then confirming the guessed role beats minor questions
    expect(u2.next.choices.map((c: any) => c.value)).toContain("Senior Project Manager");
    expect(u.summary).toMatch(/Senior Project Manager with \d+(\.\d)? years' experience, most recently at Infosys/);
  });

  it("answers move the score up until the planner runs out of useful questions", async () => {
    await uploadResume();
    const before = (await understanding()).score;
    let r = await answer({ questionId: "role", choices: ["Senior Project Manager"], text: "Delivery Manager" });
    expect(r.status).toBe(200);
    expect(r.body.changed[0]).toBe("Target roles: Senior Project Manager, Delivery Manager");
    expect(r.body.understanding.areas[0].score).toBe(100);
    await answer({ questionId: "locations", choices: ["Chennai", "__relocate"] });
    await answer({ questionId: "salary", text: "₹2,00,000 a month" });
    await answer({ questionId: "notice", choices: ["days:30"] });
    await answer({ questionId: "workModes", choices: ["any"] });
    await answer({ questionId: "employment", choices: ["full_time"] });
    r = await answer({ questionId: "motivation", choices: ["growth", "balance", "hacking"] });
    const u = r.body.understanding;
    expect(u.score).toBeGreaterThan(before);
    expect(u.ready).toBe(true);
    const prefs = r.body.profile.preferences;
    expect(prefs).toMatchObject({ locations: ["Chennai"], willingToRelocate: true, minSalaryLPA: 24, noticePeriodDays: 30, workModes: ["remote", "hybrid", "onsite"], employmentTypes: ["full_time"], motivations: ["growth", "balance"] });
    expect(u.summary).toMatch(/from ₹24 LPA and can join in 30 days/);
  });

  it("the user's own experience figure wins and survives a re-upload", async () => {
    await uploadResume();
    await answer({ questionId: "experience", choices: ["years:7"] });
    const u = await understanding();
    expect(u.areas.find((a: any) => a.id === "experience")).toMatchObject({ score: 100 });
    await request(app).post("/api/resume/text").set(A).send({ text: `${RESUME_TEXT}\nUpdated.` });
    await uploadResume();
    expect((await request(app).get("/api/profile").set(A)).body.profile.totalExperienceYears).toBe(7);
  });

  it("guessed skills are confirmed or removed, never silently used", async () => {
    await uploadResume();
    const profile = (await request(app).get("/api/profile").set(A)).body.profile;
    // Pretend the AI guessed two skills.
    const { getStore } = await import("../server/db/store.js");
    await (await getStore()).update("profiles", profile.uid, { skills: [...profile.skills, { name: "Kanban", key: "kanban", category: "functional", source: "ai_derived", confidence: 0.4 }, { name: "SAFe", key: "safe", category: "functional", source: "ai_derived", confidence: 0.4 }] });
    let u = await understanding();
    expect(u.guesses.filter((g: any) => g.kind === "skill").map((g: any) => g.key)).toEqual(["kanban", "safe"]);
    const r = await answer({ questionId: "skills_confirm", choices: ["kanban"] });
    expect(r.body.changed).toEqual(["Confirmed: 1 skill", "Removed 1 guess"]);
    u = r.body.understanding;
    expect(u.guesses.filter((g: any) => g.kind === "skill")).toEqual([]);
    const skills = r.body.profile.skills;
    expect(skills.find((s: any) => s.key === "kanban").source).toBe("user");
    expect(skills.some((s: any) => s.key === "safe")).toBe(false);
  });

  it("asks in Hindi when asked to, and rejects nonsense answers", async () => {
    await uploadResume();
    const u = await understanding(A, "hi");
    expect(u.next.text).toMatch(/[ऀ-ॿ]/);
    expect(u.areas[0].label).toBe("लक्ष्य भूमिका");
    expect((await answer({ questionId: "salary", text: "whatever" })).status).toBe(400);
    expect((await answer({ questionId: "bogus", choices: ["x"] })).status).toBe(400);
  });
});

describe("no-resume path", () => {
  it("builds a working profile from a short conversation (rules, no AI)", async () => {
    let r = await request(app).get("/api/career/interview").set(B);
    expect(r.body.next.step).toBe("about");
    r = await request(app).post("/api/career/interview").set(B).send({ step: "about", text: "I am an electrician at Tata Motors in Pune, 4 years" });
    expect(r.body.by).toBe("rules");
    expect(r.body.changed).toEqual(expect.arrayContaining(["Role: Electrician", "City: Pune", "Experience: 4 years"]));
    expect(r.body.next.step).toBe("skills");
    r = await request(app).post("/api/career/interview").set(B).send({ step: "skills", text: "wiring, panel repair, reading drawings, MS Excel", asked: ["about"] });
    expect(r.body.profile.skills.length).toBeGreaterThanOrEqual(3);
    expect(r.body.next.step).toBe("education");
    r = await request(app).post("/api/career/interview").set(B).send({ step: "education", choices: ["ITI"], asked: ["about", "skills"] });
    expect(r.body.profile.education[0].degree).toBe("ITI");
    r = await request(app).post("/api/career/interview").set(B).send({ step: "work", text: "Tata Motors, maintenance electrician, current", asked: ["about", "skills", "education"] });
    expect(r.body.profile.experience[0]).toMatchObject({ company: "Tata Motors" });
    expect(r.body.next).toBeNull();
    expect(r.body.profile.status).toBe("needs_info"); // now only the usual location/pay questions remain
    expect(r.body.profile.provenance.totalExperienceYears).toBe("user");
  });

  it("uses the AI to understand Hindi and stores English facts", async () => {
    setProviders([new FakeProvider("gemini", (req) => {
      if (!req.system?.includes("structured profile facts")) return "not json";
      expect(req.prompt).toContain("बिजली");
      return JSON.stringify({ fullName: "", currentRole: "Electrician", totalExperienceYears: 4, fresher: false, city: "Pune", skills: ["Wiring", "Panel repair"], experience: [], education: [], targetRoles: [] });
    })]);
    const r = await request(app).post("/api/career/interview").set(B).send({ step: "about", text: "मैं बिजली मिस्त्री हूँ, पुणे में 4 साल से", lang: "hi" });
    expect(r.body.by).toBe("ai");
    expect(r.body.profile).toMatchObject({ currentRole: "Electrician", city: "Pune", totalExperienceYears: 4 });
    expect(r.body.next.text).toMatch(/कौशल/);
  });

  it("reads fresher answers with rules", () => {
    const f = ruleFacts("about", "Fresher, finished B.Com in 2025 from Chennai");
    expect(f).toMatchObject({ fresher: true, totalExperienceYears: 0, city: "Chennai" });
    expect(f.education[0]).toMatchObject({ degree: "Graduate", gradYear: "2025" });
  });
});

describe("role discovery", () => {
  it("returns role paths with live counts, salary and skill fit, and lets the user target one", async () => {
    await uploadResume();
    await seedJobs();
    const r = await request(app).get("/api/career/role-paths").set(A);
    expect(r.status).toBe(200);
    const pm = r.body.paths.find((x: any) => x.role === "Senior Project Manager");
    expect(pm.jobsIndia).toBeGreaterThanOrEqual(3);
    expect(pm.salaryLPA?.median).toBeGreaterThan(0);
    expect(pm.fitPct).toBeGreaterThanOrEqual(0);
    expect(r.body.paths.some((x: any) => x.source === "similar role")).toBe(true);
    const t = await request(app).post("/api/career/role-paths/target").set(A).send({ role: "Scrum Master", target: true });
    expect(t.body.profile.preferences.targetRoles).toContain("Scrum Master");
    const again = await request(app).get("/api/career/role-paths").set(A);
    expect(again.body.paths.find((x: any) => x.role === "Scrum Master").targeted).toBe(true);
  });
});

describe("resume builder and health", () => {
  it("builds a resume from profile facts only, with a health score and specific fixes", async () => {
    await uploadResume();
    await seedJobs();
    const r = await request(app).get("/api/career/resume").set(A);
    expect(r.status).toBe(200);
    const { resume, health } = r.body;
    expect(resume.name).toBe("Priya Sharma");
    expect(resume.experience[0]).toMatchObject({ company: expect.stringMatching(/Infosys/) });
    expect(resume.experience[0].bullets.length).toBeGreaterThan(0);
    expect(resume.skills).toContain("Agile");
    expect(health.score).toBeGreaterThan(40);
    expect(health.score).toBeLessThanOrEqual(100);
    expect(health.checks.map((c: any) => c.id)).toEqual(["contact", "summary", "history", "bullets", "numbers", "verbs", "skills", "keywords", "length"]);
    for (const c of health.checks) if (!c.ok) expect(c.fix).toBeTruthy();
  });

  it("never puts AI-guessed skills on the resume", async () => {
    const p = await uploadResume();
    const { getStore } = await import("../server/db/store.js");
    await (await getStore()).update("profiles", p.uid, { skills: [...p.skills, { name: "Quantum Computing", key: "quantum_computing", category: "technical", source: "ai_derived", confidence: 0.3 }] });
    const r = await request(app).get("/api/career/resume").set(A);
    expect(r.body.resume.skills).not.toContain("Quantum Computing");
  });
});
