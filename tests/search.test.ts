import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { Job } from "../shared/types.js";
import { createApp } from "../server/app.js";
import { getStore } from "../server/db/store.js";
import { ingestRawJobs, refreshFreshness } from "../server/jobs/ingest.js";
import type { RawJob } from "../server/jobs/normalize.js";
import { indexSize, searchJobs, suggest } from "../server/search/index.js";
import { portalLinks } from "../server/search/portals.js";
import { expandQuery } from "../server/search/synonyms.js";
import { freshEnv } from "./fixtures.js";

const app = createApp();
const A = { Authorization: "Bearer dev:alice" };

let n = 0;
const job = (over: Partial<RawJob>): RawJob => ({
  connector: "test", sourceName: "Test", sourceJobId: String(++n), title: "Job", company: `Company ${n}`, location: "Pune",
  description: "Detailed description of the role, responsibilities, the team, shift timings and benefits offered to the candidate.",
  url: `https://example.in/jobs/${n}`, postedAt: new Date(Date.now() - n * 3600_000).toISOString(), ...over,
});

async function seed() {
  await ingestRawJobs([
    job({ title: "Delivery Partner", company: "QuickShip", location: "Pune", description: "Deliver orders on a two-wheeler. ₹18,000 - ₹24,000 per month. 10th pass. Freshers welcome. Fuel allowance and weekly payouts." }),
    job({ title: "Senior Software Engineer", company: "Acme Tech", location: "Bengaluru", description: "Build backend services in Java and Kafka. 6+ years experience. B.Tech required. Salary 30-45 LPA. Hybrid work." }),
    job({ title: "Telecaller - Hindi", company: "CallPro", location: "Pan India", description: "Voice process for inbound customer calls. 12th pass. Freshers welcome. Salary ₹14,000 - ₹17,000 per month. Work from office." }),
    job({ title: "React Developer", company: "RemoteCo", location: "Remote - India", remote: true, description: "Frontend work with React and TypeScript. 2+ years of experience. Graduate in any discipline. Fully remote team." }),
    job({ title: "Data Entry Operator", company: "Scammy", location: "Pune", description: "Work from home typing job, earn ₹50,000 per week! Pay a registration fee of ₹999 to start. Contact on WhatsApp." }),
  ]);
}

beforeEach(async () => {
  freshEnv();
  n = 0;
  await seed();
});

describe("query expansion", () => {
  it("adds synonyms for Indian job vocabulary and reports them", () => {
    const e = expandQuery("Delivery Boy Pune");
    expect(e.expanded).toEqual(expect.arrayContaining(["delivery partner", "rider"]));
    expect(e.term.startsWith("delivery boy pune")).toBe(true);
    expect(expandQuery("").term).toBe("");
  });
});

describe("searchJobs", () => {
  it("finds jobs by synonym and never shows suspicious listings", async () => {
    const r = await searchJobs("alice", { q: "delivery boy" });
    expect(r.hits[0].job.title).toBe("Delivery Partner");
    expect(r.expandedTerms).toContain("delivery partner");
    const all = await searchJobs("alice", {});
    expect(all.hits.map((h) => h.job.company)).not.toContain("Scammy");
    expect(all.total).toBe(4);
    expect(await indexSize()).toBe(4);
  });

  it("synonyms only match job titles, never stray words in descriptions (live-data regression)", async () => {
    await ingestRawJobs([
      job({ title: "Talent Partner", company: "HireCo", description: "Partner with delivery leaders to hire engineers. Great executive presence. Bengaluru based talent team role." }),
      job({ title: "Delivery Director", company: "BigIT", description: "Own programme delivery for enterprise clients across India. 15+ years of experience managing delivery teams." }),
    ]);
    const titles = (await searchJobs("alice", { q: "delivery boy" })).hits.map((h) => h.job.title);
    expect(titles).toEqual(["Delivery Partner"]);
  });

  it("title matches outrank jobs that only mention the words in the description", async () => {
    await ingestRawJobs([
      job({ title: "Account Executive", company: "Datadog", location: "Bengaluru", description: "Sell observability to customers. Work with data and analyst teams at enterprise accounts across India." }),
      job({ title: "Data Analyst", company: "Insight Co", location: "Bengaluru", description: "Build reports and dashboards for business teams using SQL, Excel and Power BI in Bengaluru." }),
    ]);
    const r = await searchJobs("alice", { q: "data analyst", sort: "relevance" });
    expect(r.hits[0].job.title).toBe("Data Analyst");
  });

  it("tolerates typos", async () => {
    expect((await searchJobs("alice", { q: "telecalller" })).hits[0]?.job.title).toBe("Telecaller - Hindi");
  });

  it("a city filter includes remote and Pan-India jobs unless strict", async () => {
    const loose = await searchJobs("alice", { cities: ["Pune"] });
    expect(loose.hits.map((h) => h.job.title).sort()).toEqual(["Delivery Partner", "React Developer", "Telecaller - Hindi"]);
    const strict = await searchJobs("alice", { cities: ["Pune"], strictCity: true });
    expect(strict.hits.map((h) => h.job.title)).toEqual(["Delivery Partner"]);
  });

  it("filters: freshers, education ceiling, salary, work mode, category, experience", async () => {
    const titles = async (q: Parameters<typeof searchJobs>[1]) => (await searchJobs("alice", q)).hits.map((h) => h.job.title).sort();
    expect(await titles({ freshersOnly: true })).toEqual(["Delivery Partner", "Telecaller - Hindi"]);
    expect(await titles({ maxEducation: "12th" })).toEqual(["Delivery Partner", "Telecaller - Hindi"]);
    expect(await titles({ minSalaryLPA: 10 })).toEqual(["Senior Software Engineer"]);
    expect(await titles({ workModes: ["remote"] })).toEqual(["React Developer"]);
    expect(await titles({ categories: ["customer_support"] })).toEqual(["Telecaller - Hindi"]);
    expect(await titles({ experienceYears: 3 })).not.toContain("Senior Software Engineer");
  });

  it("facets count what the current filters return", async () => {
    const r = await searchJobs("alice", { cities: ["Pune"] });
    expect(r.facets.category).toMatchObject({ logistics_delivery: 1, customer_support: 1, tech: 1 });
    expect(r.facets.city.Pune).toBe(1);
  });

  it("sorts by newest and by salary, and pages", async () => {
    expect((await searchJobs("alice", { sort: "newest" })).hits[0].job.title).toBe("Delivery Partner");
    expect((await searchJobs("alice", { sort: "salary" })).hits[0].job.title).toBe("Senior Software Engineer");
    const p2 = await searchJobs("alice", { sort: "newest", pageSize: 3, page: 2 });
    expect(p2.hits).toHaveLength(1);
    expect(p2.total).toBe(4);
  });

  it("user-provided jobs are visible only to their owner", async () => {
    await ingestRawJobs([job({ title: "Warehouse Supervisor", company: "LocalMart", connector: "user_manual" })], { ownerUid: "bob" });
    expect((await searchJobs("bob", { q: "warehouse" })).hits.map((h) => h.job.title)).toContain("Warehouse Supervisor");
    expect((await searchJobs("alice", { q: "warehouse" })).hits.map((h) => h.job.title)).not.toContain("Warehouse Supervisor");
  });

  it("jobs that expire drop out of the index", async () => {
    const store = await getStore();
    const tele = (await store.query<Job>("jobs")).find((j) => j.title.startsWith("Telecaller"))!;
    await store.update<Job>("jobs", tele.id, { lastVerifiedAt: new Date(Date.now() - 20 * 86400000).toISOString() });
    await refreshFreshness();
    expect((await searchJobs("alice", {})).hits.map((h) => h.job.title)).not.toContain("Telecaller - Hindi");
  });

  it("suggests titles and companies", async () => {
    expect(await suggest("alice", "Tele")).toContain("Telecaller - Hindi");
    expect(await suggest("alice", "a")).toEqual([]);
  });
});

describe("portal links", () => {
  it("builds pre-filled searches", () => {
    const links = portalLinks({ role: "Delivery Partner", city: "Navi Mumbai", experienceYears: 1.5 });
    const byId = Object.fromEntries(links.map((l) => [l.id, l.url]));
    expect(byId.naukri).toBe("https://www.naukri.com/delivery-partner-jobs-in-navi-mumbai?experience=1");
    expect(byId.linkedin).toContain("keywords=Delivery%20Partner&location=Navi%20Mumbai%2C%20India");
    expect(byId.apna).toBe("https://apna.co/jobs/delivery-partner-jobs-in-navi-mumbai");
    expect(portalLinks({ role: "Nurse", city: "Anywhere in India" }).find((l) => l.id === "naukri")!.url).toBe("https://www.naukri.com/nurse-jobs");
  });
});

describe("search API", () => {
  it("parses comma lists and booleans from the query string", async () => {
    const r = await request(app).get("/api/jobs/search?cities=Pune&strictCity=true&sort=newest").set(A);
    expect(r.status).toBe(200);
    expect(r.body.hits.map((h: any) => h.job.title)).toEqual(["Delivery Partner"]);
    expect(r.body.hits[0].job.description.length).toBeLessThanOrEqual(600);
  });

  it("rejects bad filters", async () => {
    expect((await request(app).get("/api/jobs/search?workModes=spaceship").set(A)).status).toBe(400);
    expect((await request(app).get("/api/jobs/search?page=0").set(A)).status).toBe(400);
  });

  it("suggest and portal-links endpoints", async () => {
    expect((await request(app).get("/api/jobs/suggest?q=React").set(A)).body.suggestions).toContain("React Developer");
    const links = await request(app).get("/api/portal-links?role=Accountant&city=Chennai").set(A);
    expect(links.body.links.find((l: any) => l.id === "naukri").url).toBe("https://www.naukri.com/accountant-jobs-in-chennai");
  });

  it("job detail still works (route order)", async () => {
    const id = (await (await getStore()).query<Job>("jobs"))[0].id;
    expect((await request(app).get(`/api/jobs/${id}`).set(A)).status).toBe(200);
  });
});

describe("large indexes", () => {
  it("personal filters see every job, not just the first 1,000 the index returns", async () => {
    const { normalizeRaw } = await import("../server/jobs/normalize.js");
    const store = await getStore();
    const ids: string[] = [];
    for (let i = 0; i < 1100; i++) {
      const r = normalizeRaw(job({ title: `Analyst ${i}`, company: `Firm ${i}` }));
      if ("job" in r) { await store.put("jobs", r.job.id, r.job); ids.push(r.job.id); }
    }
    const { syncJobs } = await import("../server/search/index.js");
    await syncJobs(ids);
    const base = await indexSize() - 1100; // jobs the shared setup already added
    // The user's only excellent and only saved match are the last jobs added.
    const now = new Date().toISOString();
    const match = (jobId: string, score: number, saved: boolean) => ({
      id: `u1_${jobId}`, uid: "u1", jobId, score, confidence: "high", breakdown: { skills: 90, experience: 90, roleAlignment: 90, domain: 90, location: 90, preferences: 90 },
      matchedSkills: [], missingSkills: [], hardFailures: [], reasons: [], gaps: [], assumptions: [], rankScore: score, hidden: false, saved, notified: true, createdAt: now, updatedAt: now,
    });
    await store.put("matches", `u1_${ids[1099]}`, match(ids[1099], 91, false));
    await store.put("matches", `u1_${ids[1098]}`, match(ids[1098], 55, true));
    expect((await searchJobs("u1", { matchedOnly: true, minScore: 80 })).total).toBe(1);
    expect((await searchJobs("u1", { matchedOnly: true, savedOnly: true, minScore: 0 })).total).toBe(1);
    expect((await searchJobs("__public__", {})).total).toBe(1100 + base);
    expect((await searchJobs("__public__", { q: "analyst" })).total).toBe(1100);
  }, 60_000);
});
