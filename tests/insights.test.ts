import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { funnelStats } from "../server/insights/funnel.js";
import { linksFor } from "../server/insights/learning.js";
import { _resetInsightCaches } from "../server/insights/routes.js";
import { runDiscovery, setConnectors } from "../server/jobs/discovery.js";
import { matchCandidate } from "../server/matching/service.js";
import { RESUME_TEXT, fakeConnector, freshEnv, rawJob } from "./fixtures.js";
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
beforeEach(() => { freshEnv(); _resetInsightCaches(); });

const rec = (o: Partial<ApplicationRecord>): ApplicationRecord => ({
  id: "a", uid: "u", jobId: "j", company: "Acme", role: "PM", source: "Naukri", applyUrl: "", mode: "assisted", status: "applied", notes: "", interviewDates: [], history: [], createdAt: "", updatedAt: "", ...o,
});

describe("funnel", () => {
  const now = new Date("2026-09-30T10:00:00Z");
  it("shows no percentages until there are 5 applications", () => {
    const f = funnelStats([rec({ appliedAt: "2026-09-28T00:00:00Z" })], now);
    expect(f).toMatchObject({ applied: 1, responseRate: null, interviewRate: null, offerRate: null });
    expect(f.insight).toMatch(/Rates appear after 5/);
  });

  it("computes rates, days to first reply and per-source results", () => {
    const apps = [
      rec({ id: "1", appliedAt: "2026-09-01T00:00:00Z", status: "interview", interviewDates: ["2026-09-20T10:00:00Z"], history: [{ at: "2026-09-04T00:00:00Z", status: "under_review", actor: "user" }, { at: "2026-09-10T00:00:00Z", status: "interview", actor: "user" }] }),
      rec({ id: "2", appliedAt: "2026-09-02T00:00:00Z", status: "rejected", history: [{ at: "2026-09-08T00:00:00Z", status: "rejected", actor: "user" }] }),
      rec({ id: "3", appliedAt: "2026-09-25T00:00:00Z", source: "LinkedIn" }),
      rec({ id: "4", appliedAt: "2026-09-26T00:00:00Z", source: "LinkedIn" }),
      rec({ id: "5", appliedAt: "2026-09-27T00:00:00Z" }),
    ];
    const f = funnelStats(apps, now);
    expect(f).toMatchObject({ applied: 5, responses: 2, interviews: 1, offers: 0, responseRate: 40, interviewRate: 20, offerRate: 0, medianDaysToResponse: 4.5 });
    expect(f.weekly).toHaveLength(8);
    expect(f.weekly[6].applied).toBe(3); // Sep 25-27 fall in the week of Mon Sep 21; "now" is Wed Sep 30
    expect(f.bySource.find((s) => s.source === "Naukri")).toMatchObject({ applied: 3, responses: 2 });
  });

  it("says when applications get no replies", () => {
    const apps = [1, 2, 3, 4, 5].map((n) => rec({ id: `a${n}`, appliedAt: "2026-09-20T00:00:00Z" }));
    expect(funnelStats(apps, now).insight).toMatch(/no replies/);
  });
});

describe("learning links", () => {
  it("gives official free links where known and free search links otherwise", () => {
    expect(linksFor("python", "Python")[0].url).toContain("docs.python.org");
    const other = linksFor("obscure_tool", "Obscure Tool");
    expect(other.length).toBe(2);
    expect(other.every((l) => l.free)).toBe(true);
  });
});

describe("insights API", () => {
  it("needs sign-in and a finished profile", async () => {
    expect((await request(app).get("/api/insights/funnel")).status).toBe(401);
    expect((await request(app).get("/api/insights/market").set(A)).status).toBe(409);
  });

  it("learning ROI counts only jobs that really move up, and market pulse reports live numbers", async () => {
    await readyUser();
    const base = rawJob();
    const skillLess = (n: string, extra: string) => rawJob({ sourceJobId: `x${n}`, company: `Co${n}`, title: "Project Manager", description: `${base.description}\n${extra}`, url: `https://boards.greenhouse.io/co${n}/jobs/${n}`, applyUrl: `https://boards.greenhouse.io/co${n}/jobs/${n}` });
    setConnectors([fakeConnector("greenhouse", [base, skillLess("1", "Also requires Tableau and Power BI dashboards. Salary 18-24 LPA."), skillLess("2", "Must know Tableau and Power BI reporting. Salary 20-26 LPA."), skillLess("3", "Tableau experience needed. Salary 19-25 LPA.")])]);
    await runDiscovery();
    await matchCandidate("alice", { notifyNew: true });

    const roi = (await request(app).get("/api/insights/learning").set(A)).body;
    expect(roi.jobsChecked).toBeGreaterThanOrEqual(4);
    for (const s of roi.skills) {
      expect(s.newStrong + s.newExcellent).toBeGreaterThan(0);
      expect(s.links.length).toBeGreaterThan(0);
    }
    const market = (await request(app).get("/api/insights/market?role=project manager").set(A)).body.market;
    expect(market.openingsInIndia).toBeGreaterThanOrEqual(4);
    expect(market.topCompanies.length).toBeGreaterThan(0);
    expect(market.topSkills.length).toBeGreaterThan(0);
    const funnel = (await request(app).get("/api/insights/funnel").set(A)).body.funnel;
    expect(funnel).toMatchObject({ applied: 0, responseRate: null });
  });
});
