import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { Job } from "../shared/types.js";
import { createApp } from "../server/app.js";
import { getStore } from "../server/db/store.js";
import { runDiscovery, setConnectors } from "../server/jobs/discovery.js";
import { jobPath } from "../server/seo/render.js";
import { resolveCity } from "../server/seo/pages.js";
import { syncJobs } from "../server/search/index.js";
import { _resetPublicCache } from "../server/public.js";
import { fakeConnector, freshEnv, rawJob } from "./fixtures.js";

const app = createApp();

const jsonLd = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const robots = (html: string) => /<meta name="robots" content="([^"]+)"/.exec(html)?.[1];
const canonical = (html: string) => /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];

async function seed(extra: Array<Partial<ReturnType<typeof rawJob>>> = []) {
  const jobs = [
    rawJob(),
    rawJob({ sourceJobId: "2", title: "Project Manager - Payments", company: "Beta Payments Pvt Ltd", description: `Payments platform team.
${rawJob().description}`, url: "https://boards.greenhouse.io/beta/jobs/2", applyUrl: "https://boards.greenhouse.io/beta/jobs/2" }),
    rawJob({ sourceJobId: "3", title: "Senior Project Manager (Cloud)", company: "Gamma Cloud Services", description: `Cloud migration programme.
${rawJob().description}`, url: "https://boards.greenhouse.io/gamma/jobs/3", applyUrl: "https://boards.greenhouse.io/gamma/jobs/3" }),
    ...extra.map((e, i) => rawJob({ sourceJobId: `x${i}`, company: `Extra Co ${i}`, url: `https://boards.greenhouse.io/extra${i}/jobs/x${i}`, applyUrl: `https://boards.greenhouse.io/extra${i}/jobs/x${i}`, ...e })),
  ];
  setConnectors([fakeConnector("greenhouse", jobs)]);
  await runDiscovery();
  _resetPublicCache();
  return (await (await getStore()).query<Job>("jobs")).sort((a, b) => a.title.localeCompare(b.title));
}

beforeEach(() => freshEnv());

describe("robots and sitemaps", () => {
  it("robots.txt allows the site, blocks the API and points at the sitemap", async () => {
    const r = await request(app).get("/robots.txt");
    expect(r.status).toBe(200);
    expect(r.text).toContain("Disallow: /api/");
    expect(r.text).toMatch(/Sitemap: https:\/\/app\.tiaslab\.in\/sitemap\.xml/);
  });

  it("sitemap lists listing pages and every public live job, never private or suspicious ones", async () => {
    const jobs = await seed([{ title: "Work from home — pay registration fee", description: "Pay a registration fee of Rs 500 to join. Contact on WhatsApp only." }]);
    const store = await getStore();
    await store.update<Job>("jobs", jobs[0].id, { ownerUid: "someone" }); // a user's private job
    const idx = await request(app).get("/sitemap.xml");
    expect(idx.text).toContain("<sitemapindex");
    expect(idx.text).toContain("https://app.tiaslab.in/sitemaps/pages.xml");
    expect(idx.text).toContain("https://app.tiaslab.in/sitemaps/jobs-1.xml");

    const pages = await request(app).get("/sitemaps/pages.xml");
    expect(pages.text).toContain("<loc>https://app.tiaslab.in/project-manager-jobs</loc>");
    expect(pages.text).toContain("<loc>https://app.tiaslab.in/jobs-in-chennai</loc>");
    expect(pages.text).not.toContain("data-analyst-jobs"); // no live jobs → not listed

    const jobsXml = (await request(app).get("/sitemaps/jobs-1.xml")).text;
    const visible = (await store.query<Job>("jobs")).filter((j) => !j.ownerUid && !j.quality.suspicious);
    for (const j of visible) expect(jobsXml).toContain(jobPath(j));
    expect(jobsXml).not.toContain(jobs[0].id);
    expect(jobsXml).not.toMatch(/registration/i);
  });
});

describe("job pages", () => {
  it("renders a crawlable page with JobPosting data, canonical URL and an apply link", async () => {
    const [job] = await seed();
    const r = await request(app).get(jobPath(job));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/html/);
    expect(canonical(r.text)).toBe(`https://app.tiaslab.in${jobPath(job)}`);
    expect(robots(r.text)).toMatch(/^index/);
    expect(r.text).toContain(`<h1>${job.title}</h1>`);
    expect(r.text).toMatch(/href="https:\/\/boards\.greenhouse\.io\/[a-z]+\/jobs\/\w+" rel="nofollow noopener" target="_blank" data-track="apply_click"/);
    const posting = jsonLd(r.text).find((x) => x["@type"] === "JobPosting");
    expect(posting).toMatchObject({ title: job.title, hiringOrganization: { name: job.company }, directApply: false });
    expect(posting.datePosted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(posting.jobLocation)).toContain('"addressCountry":"IN"');
    expect(posting.description).toContain("<p>");
    expect(jsonLd(r.text).some((x) => x["@type"] === "BreadcrumbList")).toBe(true);
  });

  it("redirects an outdated slug to the canonical address", async () => {
    const [job] = await seed();
    const r = await request(app).get(`/jobs/old-title-${job.id}`);
    expect(r.status).toBe(301);
    expect(r.headers.location).toBe(jobPath(job));
  });

  it("escapes posting text so it can't inject markup", async () => {
    const jobs = await seed([{ title: "Engineer <img src=x onerror=alert(1)>", description: `${rawJob().description}\n</script><script>alert(1)</script>` }]);
    const evil = jobs.find((j) => j.company === "Extra Co 0")!;
    const r = await request(app).get(jobPath(evil));
    expect(r.text).not.toContain("<img src=x");
    expect(r.text).not.toContain("<script>alert(1)</script>");
    expect(() => jsonLd(r.text)).not.toThrow();
  });

  it("closed jobs stay readable but leave the index and drop JobPosting", async () => {
    const [job] = await seed();
    await (await getStore()).update<Job>("jobs", job.id, { status: "closed" });
    await syncJobs([job.id]);
    const r = await request(app).get(jobPath(job));
    expect(r.status).toBe(200);
    expect(robots(r.text)).toMatch(/^noindex/);
    expect(r.text).toContain("no longer accepting applications");
    expect(jsonLd(r.text).some((x) => x["@type"] === "JobPosting")).toBe(false);
  });

  it("private, suspicious and unknown jobs are real 404s", async () => {
    const [job, other] = await seed();
    const store = await getStore();
    await store.update<Job>("jobs", job.id, { ownerUid: "u1" });
    await store.update<Job>("jobs", other.id, { quality: { ...other.quality, suspicious: true } });
    expect((await request(app).get(jobPath(job))).status).toBe(404);
    expect((await request(app).get(jobPath(other))).status).toBe(404);
    const missing = await request(app).get("/jobs/some-job-job_doesnotexist");
    expect(missing.status).toBe(404);
    expect(robots(missing.text)).toMatch(/^noindex/);
  });
});

describe("listing pages", () => {
  it("role, city and role-in-city pages list live jobs with unique intros", async () => {
    await seed();
    const role = await request(app).get("/project-manager-jobs");
    expect(role.status).toBe(200);
    expect(role.text).toContain("<h1>Project Manager Jobs in India</h1>");
    expect(role.text).toMatch(/3 live Project Manager jobs in India/);
    expect(robots(role.text)).toMatch(/^index/);
    expect(role.text).toContain('href="/project-manager-jobs-in-chennai"');

    const city = await request(app).get("/jobs-in-chennai");
    expect(city.status).toBe(200);
    expect(city.text).toContain("<h1>Jobs in Chennai</h1>");
    expect(city.text).not.toContain("live  jobs");

    const both = await request(app).get("/project-manager-jobs-in-chennai");
    expect(both.status).toBe(200);
    expect(canonical(both.text)).toBe("https://app.tiaslab.in/project-manager-jobs-in-chennai");
  });

  it("thin pages are noindex; aliases and duplicates redirect; unknown slugs 404", async () => {
    await seed();
    const thin = await request(app).get("/data-analyst-jobs");
    expect(thin.status).toBe(200);
    expect(robots(thin.text)).toMatch(/^noindex/);
    expect((await request(app).get("/jobs-in-bangalore")).headers.location).toBe("/jobs-in-bengaluru");
    expect((await request(app).get("/work-from-home-jobs")).headers.location).toBe("/remote-jobs");
    expect((await request(app).get("/jobs?city=Madras")).headers.location).toBe("/jobs-in-chennai");
    expect((await request(app).get("/astronaut-jobs")).status).toBe(404);
    expect((await request(app).get("/jobs-in-atlantis")).status).toBe(404);
  });

  it("search-result pages are for people, not the index", async () => {
    await seed();
    const r = await request(app).get("/jobs?q=project+manager");
    expect(r.status).toBe(200);
    expect(robots(r.text)).toMatch(/^noindex/);
    const hub = await request(app).get("/jobs");
    expect(robots(hub.text)).toMatch(/^index/);
    expect(hub.text).toContain('href="/jobs-in-chennai"');
  });

  it("paging past the end is a 404, and page 2 has its own canonical", async () => {
    await seed();
    expect((await request(app).get("/jobs-in-chennai?page=9")).status).toBe(404);
  });

  it("resolves city slugs and aliases", () => {
    expect(resolveCity("bengaluru")).toEqual({ name: "Bengaluru", slug: "bengaluru" });
    expect(resolveCity("bangalore")).toEqual({ name: "Bengaluru", slug: "bengaluru" });
    expect(resolveCity("navi-mumbai")?.slug).toBe("navi-mumbai");
    expect(resolveCity("atlantis")).toBeNull();
  });
});

describe("styles", () => {
  it("serves the public-page stylesheet with long caching", async () => {
    const r = await request(app).get("/seo.css");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/css/);
    expect(r.headers["cache-control"]).toMatch(/max-age=86400/);
  });
});
