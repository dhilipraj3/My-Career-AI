import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { extractLinks } from "../server/jobs/import.js";
import { matchCandidate } from "../server/matching/service.js";
import { runDiscovery, setConnectors } from "../server/jobs/discovery.js";
import { RESUME_TEXT, fakeConnector, freshEnv, rawJob } from "./fixtures.js";

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

describe("adding jobs you found", () => {
  it("pulls distinct links out of a pasted WhatsApp-style message", () => {
    const text = "Check this: https://www.naukri.com/job-listings-pm-123. Also (https://jobs.acme.com/apply/9), and again https://www.naukri.com/job-listings-pm-123!";
    expect(extractLinks(text)).toEqual(["https://www.naukri.com/job-listings-pm-123", "https://jobs.acme.com/apply/9"]);
    expect(extractLinks("no links here")).toEqual([]);
  });

  it("bulk import reports each link on its own and never stops at a bad one", async () => {
    await readyUser();
    const r = await request(app).post("/api/jobs/import-bulk").set(A).send({ text: "see http://127.0.0.1/admin and http://localhost:3000/x" });
    expect(r.status).toBe(200);
    expect(r.body.results).toHaveLength(2);
    expect(r.body.results.every((x: any) => x.ok === false && typeof x.error === "string")).toBe(true); // private addresses are refused
    expect((await request(app).post("/api/jobs/import-bulk").set(A).send({ text: "nothing to see" })).status).toBe(422);
    expect((await request(app).post("/api/jobs/import-bulk").set(A).send({})).status).toBe(400);
  });

  it("still imports a pasted description as before", async () => {
    await readyUser();
    const desc = `${rawJob().description}\nWe are hiring for our Chennai office. Apply with your updated resume.`;
    const r = await request(app).post("/api/jobs/import").set(A).send({ description: desc, title: "Senior Project Manager", company: "Manual Co" });
    expect(r.status).toBe(201);
    expect(r.body.job.company).toBe("Manual Co");
    expect(r.body.match.score).toBeGreaterThan(0);
  });
});

describe("application form helper", () => {
  it("fills what it knows from the profile and leaves pay for the user", async () => {
    await readyUser();
    setConnectors([fakeConnector("greenhouse", [rawJob()])]);
    await runDiscovery();
    await matchCandidate("alice", { notifyNew: true });
    const jobId = (await request(app).get("/api/feed").set(A)).body.items[0].job.id;
    const { fields } = (await request(app).get(`/api/jobs/${jobId}/form-helper`).set(A)).body;
    const by = Object.fromEntries(fields.map((f: any) => [f.id, f]));
    expect(by.noticePeriod).toMatchObject({ known: true, value: "30 days" });
    expect(by.expectedCtc.value).toMatch(/LPA/);
    expect(by.currentCtc).toMatchObject({ known: false, value: "" }); // never guessed
    expect(by.experience.value).toMatch(/years/);
    expect(by.whyThisRole.value).toContain("Acme");
    expect((await request(app).get(`/api/jobs/${jobId}/form-helper`)).status).toBe(401);
  });
});
