import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyRecord } from "../shared/types.js";
import { createApp } from "../server/app.js";
import { getStore } from "../server/db/store.js";
import { fetchOracle, fetchRecruitee, fetchWorkable, fetchWorkday, jobLinksFromHtml, jobPostingsFromHtml } from "../server/jobs/ats.js";
import { detectFromText } from "../server/jobs/detect.js";
import { boardProblem, closeMissing, companyId, ensureSeeded, fetchCompany, listCompanies, pickBoards, registryConnector } from "../server/jobs/registry.js";
import { ingestRawJobs } from "../server/jobs/ingest.js";
import { isRejected, normalizeRaw } from "../server/jobs/normalize.js";
import { freshEnv } from "./fixtures.js";

const app = createApp();
const ADMIN = { Authorization: "Bearer dev:admin" };
const USER = { Authorization: "Bearer dev:alice" };

/** Route global fetch to canned responses: first matching [urlPart, body] wins. Unmatched URLs 404. */
function mockFetch(routes: Array<[string | RegExp, unknown]>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    calls.push(`${init?.method || "GET"} ${url}`);
    const hit = routes.find(([k]) => (typeof k === "string" ? url.includes(k) : k.test(url)));
    if (!hit) return new Response("not found", { status: 404 });
    return new Response(typeof hit[1] === "string" ? hit[1] : JSON.stringify(hit[1]), { status: 200, headers: { "content-type": "application/json" } });
  }));
  return calls;
}

beforeEach(() => freshEnv());
afterEach(() => vi.unstubAllGlobals());

describe("ATS detection", () => {
  const cases: Array<[string, string | null, string]> = [
    ["https://boards.greenhouse.io/groww", "greenhouse", "groww"],
    ["https://job-boards.greenhouse.io/postman/jobs/123", "greenhouse", "postman"],
    ['<iframe src="https://boards.greenhouse.io/embed/job_board?for=razorpay">', "greenhouse", "razorpay"],
    ["https://jobs.lever.co/meesho/abc-123", "lever", "meesho"],
    ["https://jobs.ashbyhq.com/notion", "ashby", "notion"],
    ["https://jobs.smartrecruiters.com/BoschGroup/7443", "smartrecruiters", "BoschGroup"],
    ["https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/India-Pune/X_JR1", "workday", "nvidia|wd5|NVIDIAExternalCareerSite"],
    ["https://walmart.wd5.myworkdayjobs.com/WalmartExternal", "workday", "walmart|wd5|WalmartExternal"],
    ["https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs", "oracle", "jpmc.fa.oraclecloud.com|CX_1001"],
    ["https://bunq.recruitee.com/o/some-role", "recruitee", "bunq"],
    ["https://apply.workable.com/acme/j/ABC123/", "workable", "acme"],
  ];
  it.each(cases)("%s", (text, ats, board) => {
    const d = detectFromText(text)!;
    expect(d.ats).toBe(ats);
    expect(d.board).toBe(board);
  });

  it("recognises systems we won't read automatically and says why", () => {
    const d = detectFromText("https://swiggy.darwinbox.in/ms/candidate/careers")!;
    expect(d.ats).toBeNull();
    expect(d.unsupported).toMatch(/Darwinbox/);
    expect(detectFromText("https://www.naukri.com/job-listings-abc")!.unsupported).toMatch(/portals/);
  });

  it("returns nothing for an unrelated URL", () => {
    expect(detectFromText("https://example.com/about")).toBeNull();
  });

  it("validates board ids per system", () => {
    expect(boardProblem("workday", "nvidia|wd5|Site")).toBeNull();
    expect(boardProblem("workday", "nvidia")).toMatch(/Invalid Workday/);
    expect(boardProblem("oracle", "evil.com|CX_1")).toMatch(/Invalid Oracle/);
    expect(boardProblem("careers_page", "ftp://x.com")).toBeTruthy();
    expect(boardProblem("greenhouse", "../../etc")).toMatch(/Invalid/);
  });
});

describe("schema.org JobPosting extraction", () => {
  const html = `<html><head>
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"X"},
      {"@type":"JobPosting","title":"Delivery Executive","identifier":{"value":"D-1"},"hiringOrganization":{"name":"QuickShip"},
       "jobLocation":[{"address":{"addressLocality":"Pune","addressRegion":"Maharashtra","addressCountry":"IN"}},{"address":{"addressLocality":"Mumbai"}}],
       "description":"<p>Deliver parcels across the city. Two-wheeler and licence required. Fuel allowance provided.</p>","datePosted":"2026-09-01",
       "baseSalary":{"currency":"INR","value":{"minValue":18000,"maxValue":24000,"unitText":"MONTH"}},"url":"https://quickship.in/careers/delivery-executive"}]}</script>
    <script type="application/ld+json">{ not json </script>
  </head><body>
    <a href="/careers/job/accountant-chennai-123">Accountant</a><a href="/about">About</a><a href="https://other.com/jobs/x-1">x</a>
  </body></html>`;

  it("reads postings from @graph, with multi-city locations and salary", () => {
    const [j] = jobPostingsFromHtml(html, "https://quickship.in/careers");
    expect(j.title).toBe("Delivery Executive");
    expect(j.company).toBe("QuickShip");
    expect(j.location).toBe("Pune, Maharashtra, IN; Mumbai");
    expect(j.sourceJobId).toBe("D-1");
    expect(j.salary).toEqual({ min: 18000, max: 24000, currency: "INR", period: "month" });
    expect(j.description).not.toMatch(/<p>/);
  });

  it("reads postings inside an ItemList", () => {
    const list = `<script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"ListItem","item":{"@type":"JobPosting","title":"Nurse","hiringOrganization":{"name":"City Hospital"},"description":"Ward nurse role","url":"https://h.in/j/1"}}]}</script>`;
    expect(jobPostingsFromHtml(list, "https://h.in/careers").map((j) => j.title)).toEqual(["Nurse"]);
  });

  it("finds same-site job links only", () => {
    expect(jobLinksFromHtml(html, "https://quickship.in/careers")).toEqual(["https://quickship.in/careers/job/accountant-chennai-123"]);
  });
});

describe("connector contracts (recorded responses)", () => {
  it("Workday: lists with an India search, keeps India/multi-location postings, reads details", async () => {
    const base = "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Ext";
    const calls = mockFetch([
      [`${base}/jobs`, { total: 3, jobPostings: [
        { title: "Data Analyst", externalPath: "/job/India-Bengaluru/Data-Analyst_R1", locationsText: "India, Bengaluru" },
        { title: "Sales Lead", externalPath: "/job/US-Austin/Sales_R2", locationsText: "US, Austin" },
        { title: "Support Engineer", externalPath: "/job/multi/Support_R3", locationsText: "3 Locations" },
      ] }],
      [`${base}/job/India-Bengaluru/Data-Analyst_R1`, { jobPostingInfo: { title: "Data Analyst", jobReqId: "R1", location: "India, Bengaluru", jobDescription: "<p>Analyse sales data with SQL and Python. Build dashboards for regional teams and present weekly insights.</p>", timeType: "Full time", startDate: "2026-09-10", externalUrl: "https://acme.wd5.myworkdayjobs.com/Ext/job/India-Bengaluru/Data-Analyst_R1" } }],
      [`${base}/job/multi/Support_R3`, { jobPostingInfo: { title: "Support Engineer", jobReqId: "R3", location: "Germany, Berlin", additionalLocations: ["India, Hyderabad"], jobDescription: "Support enterprise customers across time zones.", timeType: "Full time" } }],
    ]);
    const jobs = await fetchWorkday("acme|wd5|Ext", "Acme");
    expect(jobs.map((j) => j.title)).toEqual(["Data Analyst", "Support Engineer"]);
    expect(calls[0]).toMatch(/^POST .*\/jobs$/);
    expect(calls.some((c) => c.includes("Sales_R2"))).toBe(false); // US-only posting never fetched
    expect(jobs[0]).toMatchObject({ connector: "workday", company: "Acme", sourceJobId: "R1", employmentType: "Full time" });
    expect(jobs[1].location).toContain("Hyderabad");
    const n = normalizeRaw(jobs[0]);
    expect(isRejected(n)).toBe(false);
  });

  it("Oracle: keeps India requisitions and builds candidate-experience apply links", async () => {
    mockFetch([
      ["recruitingCEJobRequisitions?", { items: [{ TotalJobsCount: 2, requisitionList: [
        { Id: "11", Title: "Operations Analyst", PrimaryLocation: "Mumbai, Maharashtra, India", PrimaryLocationCountry: "IN", PostedDate: "2026-09-20" },
        { Id: "12", Title: "Banker", PrimaryLocation: "London, UK", PrimaryLocationCountry: "GB" },
      ] }] }],
      ["recruitingCEJobRequisitionDetails?", { items: [{ ExternalDescriptionStr: "<p>Run daily reconciliations and controls.</p>", ExternalQualificationsStr: "<p>Graduate in commerce.</p>", JobSchedule: "Full time", ExternalPostedStartDate: "2026-09-20T02:00:00+00:00" }] }],
    ]);
    const jobs = await fetchOracle("bank.fa.oraclecloud.com|CX_1", "Big Bank");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ title: "Operations Analyst", applyUrl: "https://bank.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/11", employmentType: "Full time" });
    expect(jobs[0].description).toContain("Graduate in commerce");
  });

  it("Recruitee and Workable map their public payloads", async () => {
    mockFetch([
      ["acme.recruitee.com/api/offers", { offers: [{ id: 5, title: "Accountant", company_name: "Acme", city: "Chennai", country: "India", description: "<p>Books</p>", requirements: "<p>CA Inter</p>", careers_url: "https://acme.recruitee.com/o/accountant", careers_apply_url: "https://acme.recruitee.com/o/accountant/c/new", published_at: "2026-09-01", salary: { min: "300000", max: "450000", currency: "INR" } }] }],
      ["widget/accounts/acme", { name: "Acme Ltd", jobs: [{ title: "Store Manager", shortcode: "ABC", employment_type: "Full-time", telecommuting: false, url: "https://apply.workable.com/acme/j/ABC", application_url: "https://apply.workable.com/acme/j/ABC/apply", published_on: "2026-09-02", locations: [{ city: "Jaipur", region: "Rajasthan", country: "India" }], description: "<p>Run the store</p>" }] }],
    ]);
    const [r] = await fetchRecruitee("acme");
    expect(r).toMatchObject({ title: "Accountant", location: "Chennai, India", salary: { min: 300000, max: 450000, currency: "INR" } });
    expect(r.description).toContain("CA Inter");
    const [w] = await fetchWorkable("acme");
    expect(w).toMatchObject({ title: "Store Manager", company: "Acme Ltd", location: "Jaipur, Rajasthan, India", sourceJobId: "ABC" });
  });
});

describe("company registry", () => {
  const seed = [
    { name: "Alpha", ats: "greenhouse" as const, board: "alpha" },
    { name: "Beta", ats: "greenhouse" as const, board: "beta" },
    { name: "Gamma", ats: "lever" as const, board: "gamma" },
  ];

  it("seeds once and is idempotent", async () => {
    await ensureSeeded(seed);
    await ensureSeeded(seed);
    const all = await (await getStore()).query<CompanyRecord>("companies");
    expect(all).toHaveLength(3);
    expect(all.every((c) => c.status === "unverified" && c.origin === "seed")).toBe(true);
  });

  it("rotates boards: never-fetched first, then least recently fetched; skips disabled and dead", async () => {
    await ensureSeeded(seed);
    const store = await getStore();
    await store.update("companies", companyId("greenhouse", "alpha"), { lastFetchedAt: "2026-09-20T00:00:00Z" });
    expect((await pickBoards("greenhouse")).map((c) => c.name)).toEqual(["Beta", "Alpha"]);
    await store.update("companies", companyId("greenhouse", "beta"), { status: "dead" });
    expect((await pickBoards("greenhouse")).map((c) => c.name)).toEqual(["Alpha"]);
    await store.update("companies", companyId("greenhouse", "alpha"), { enabled: false });
    expect(await pickBoards("greenhouse")).toEqual([]);
  });

  it("records success, uses the curated name, and marks a board dead after three 404s", async () => {
    await ensureSeeded(seed);
    const store = await getStore();
    const id = companyId("greenhouse", "alpha");
    const ok = await fetchCompany((await store.get<CompanyRecord>("companies", id))!, async () => [{ connector: "greenhouse", sourceName: "Greenhouse · alpha inc", sourceJobId: "1", title: "Engineer", company: "alpha inc", description: "x".repeat(100), url: "https://a/1" }]);
    expect(ok.jobs[0].company).toBe("Alpha");
    expect(ok.jobs[0].sourceName).toBe("Greenhouse · Alpha");
    expect((await store.get<CompanyRecord>("companies", id))!).toMatchObject({ status: "active", lastJobCount: 1, errorCount: 0 });

    const fail = async () => { throw new Error("HTTP 404 from boards-api.greenhouse.io"); };
    for (let i = 0; i < 3; i++) await fetchCompany((await store.get<CompanyRecord>("companies", id))!, fail);
    expect((await store.get<CompanyRecord>("companies", id))!).toMatchObject({ status: "dead", errorCount: 3 });
  });

  it("a transient error never kills a board", async () => {
    await ensureSeeded(seed);
    const store = await getStore();
    const id = companyId("lever", "gamma");
    for (let i = 0; i < 4; i++) await fetchCompany((await store.get<CompanyRecord>("companies", id))!, async () => { throw new Error("Timed out"); });
    expect((await store.get<CompanyRecord>("companies", id))!.status).toBe("unverified");
  });

  it("closes jobs a complete board no longer lists, but keeps multi-source jobs alive", async () => {
    await ensureSeeded(seed);
    const store = await getStore();
    const alpha = (await store.get<CompanyRecord>("companies", companyId("greenhouse", "alpha")))!;
    const posting = (id: string, title: string) => ({ connector: "greenhouse", sourceName: "Greenhouse · Alpha", sourceJobId: id, title, company: "Alpha", location: "Pune", description: `${title} role. `.repeat(10), url: `https://a/${id}` });
    await ingestRawJobs([posting("1", "Backend Engineer"), posting("2", "Data Analyst")]);
    // Job 2 is also listed on an aggregator.
    await ingestRawJobs([{ ...posting("x9", "Data Analyst"), connector: "adzuna", sourceName: "Adzuna", url: "https://a/2" }]);

    await fetchCompany(alpha, async () => []); // board now empty (only 2 jobs held, so not treated as a glitch)
    const jobs = await store.query<any>("jobs");
    const backend = jobs.find((j) => j.title === "Backend Engineer");
    const analyst = jobs.find((j) => j.title === "Data Analyst");
    expect(backend.status).toBe("closed");
    expect(analyst.status).not.toBe("closed");
    expect(analyst.sources.map((s: any) => s.connector)).toEqual(["adzuna"]);
  });

  it("does not close anything when a full board suddenly returns nothing", async () => {
    await ensureSeeded(seed);
    const store = await getStore();
    const alpha = (await store.get<CompanyRecord>("companies", companyId("greenhouse", "alpha")))!;
    await ingestRawJobs(["1", "2", "3", "4"].map((id) => ({ connector: "greenhouse", sourceName: "Greenhouse · Alpha", sourceJobId: id, title: `Role ${id} Engineer`, company: "Alpha", location: `${["Pune", "Delhi", "Chennai", "Kochi"][+id - 1]}`, description: `Role ${id} description. `.repeat(10), url: `https://a/${id}` })));
    expect(await closeMissing(alpha, [])).toBe(0);
    expect((await store.query<any>("jobs")).every((j) => j.status !== "closed")).toBe(true);
  });

  it("registry connector fails only when every board failed", async () => {
    await ensureSeeded(seed);
    mockFetch([]); // every board 404s
    await expect(registryConnector("greenhouse").fetch({ keywords: [] })).rejects.toThrow(/All 2 boards failed/);
  });
});

describe("admin registry API", () => {
  it("is admin-only", async () => {
    expect((await request(app).get("/api/admin/companies").set(USER)).status).toBe(403);
  });

  it("adds, validates, toggles and removes companies", async () => {
    const bad = await request(app).post("/api/admin/companies").set(ADMIN).send({ name: "X", ats: "workday", board: "nope" });
    expect(bad.status).toBe(400);

    const add = await request(app).post("/api/admin/companies").set(ADMIN).send({ name: "Acme", ats: "workday", board: "acme|wd5|Ext", industries: ["retail"] });
    expect(add.status).toBe(201);
    const again = await request(app).post("/api/admin/companies").set(ADMIN).send({ name: "Acme", ats: "workday", board: "acme|wd5|Ext" });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);

    const id = add.body.company.id;
    expect((await request(app).patch(`/api/admin/companies/${id}`).set(ADMIN).send({ enabled: false })).body.company.enabled).toBe(false);
    expect((await listCompanies()).find((c) => c.id === id)).toBeTruthy();
    expect((await request(app).delete(`/api/admin/companies/${id}`).set(ADMIN)).status).toBe(200);
    expect((await listCompanies()).find((c) => c.id === id)).toBeUndefined();
  });

  it("detects a careers system from a URL and previews India jobs", async () => {
    mockFetch([["recruitee.com/api/offers", { offers: [
      { id: 1, title: "Accountant", city: "Chennai", country: "India", description: "d", careers_url: "https://a" },
      { id: 2, title: "Chef", city: "Paris", country: "France", description: "d", careers_url: "https://b" },
    ] }]]);
    const r = await request(app).post("/api/admin/companies/detect").set(ADMIN).send({ url: "https://acme.recruitee.com/" });
    expect(r.status).toBe(200);
    expect(r.body.detection).toMatchObject({ ats: "recruitee", board: "acme" });
    expect(r.body.preview).toMatchObject({ total: 2, india: 1 });
    expect(r.body.preview.sample[0].title).toBe("Accountant");
  });
});
