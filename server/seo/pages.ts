// Public, crawlable pages: every live job, "<role> jobs", "jobs in <city>", "<role> jobs in <city>", and sitemaps.
import { Router, type Request, type Response } from "express";
import type { Job, JobQuery, JobSearchResult } from "../../shared/types.js";
import { BRAND } from "../../shared/brand.js";
import { getStore, type Store } from "../db/store.js";
import { RECOMMENDABLE } from "../jobs/normalize.js";
import { CITY_ALIASES } from "../nlp/location.js";
import { publicStats } from "../public.js";
import { searchJobs } from "../search/index.js";
import {
  SEO_CSS, WORK_MODE, EMPLOYMENT, abs, ago, breadcrumbHtml, breadcrumbLd, citySlug, descriptionHtml, esc, expText, jobCardHtml, jobPath,
  jobPostingLd, monthYear, page, payText, placeText, type PageOptions,
} from "./render.js";
import { CANONICAL_SPECIAL, ROLE_PAGES, SPECIAL_PAGES, rolePage, slugify, type RolePage } from "./roles.js";

const PUBLIC_UID = "__public__";
/** Fewer live jobs than this and a listing page asks search engines not to index it (no thin pages). */
export const MIN_INDEXABLE = 3;
const PAGE_SIZE = 20;
const MAX_PAGE = 50;
const CACHE_MS = 10 * 60_000;
const SITEMAP_CHUNK = 5000;

// ---------------- small per-store cache (tests swap stores) ----------------
const caches = new WeakMap<Store, Map<string, { at: number; value: unknown }>>();
async function cached<T>(key: string, make: () => Promise<T>): Promise<T> {
  const store = await getStore();
  let c = caches.get(store);
  if (!c) caches.set(store, (c = new Map()));
  const hit = c.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await make();
  if (c.size > 2000) c.clear();
  c.set(key, { at: Date.now(), value });
  return value;
}

// ---------------- helpers ----------------
const CANONICAL_CITIES = [...new Set(Object.values(CITY_ALIASES))];

/** "bangalore" → Bengaluru (with the slug we prefer, so aliases can redirect). */
export function resolveCity(slug: string): { name: string; slug: string } | null {
  const name = CITY_ALIASES[slug.replace(/-/g, " ")] || CANONICAL_CITIES.find((c) => citySlug(c) === slug);
  return name ? { name, slug: citySlug(name) } : null;
}

const isPublic = (j: Job | null): j is Job => Boolean(j && !j.ownerUid && !j.quality.suspicious);
const pageNum = (req: Request) => Math.min(MAX_PAGE, Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1));
const withPage = (path: string, n: number) => (n > 1 ? `${path}${path.includes("?") ? "&" : "?"}page=${n}` : path);

async function footerLinks(): Promise<PageOptions["footerLinks"]> {
  const stats = await publicStats();
  return {
    cities: stats.topCities.slice(0, 10).map((c) => [`Jobs in ${c.city}`, `/jobs-in-${citySlug(c.city)}`]),
    roles: [...ROLE_PAGES.slice(0, 8), ...ROLE_PAGES.filter((r) => ["sales-executive", "customer-support", "delivery", "accountant"].includes(r.slug))].map((r) => [`${r.name} jobs`, `/${r.slug}-jobs`]),
  };
}

function send(res: Response, html: string, status = 200) {
  res.status(status).type("html").set("Cache-Control", status === 200 ? "public, max-age=600" : "no-store").send(html);
}

export async function notFoundHtml(): Promise<string> {
  return page({
    title: `Page not found | ${BRAND.name}`, description: "This page doesn't exist or the job has been removed.", path: "/jobs", index: false, footerLinks: await footerLinks(),
    body: `<div class="hero" style="margin-top:28px"><h1>We couldn't find that page</h1><p>The job may have been filled, or the link is wrong. Try a search instead.</p></div>
<form class="search" action="/jobs" method="get" role="search"><input name="q" placeholder="Job title, skill or company" aria-label="Job title, skill or company"><input name="city" placeholder="City" aria-label="City"><button class="btn">Search jobs</button></form>`,
  });
}

async function search(q: JobQuery): Promise<JobSearchResult> {
  return searchJobs(PUBLIC_UID, { ...q, pageSize: q.pageSize || PAGE_SIZE });
}

/** Two honest sentences about the listing, built from the live results (unique text for every page). */
function introFor(r: JobSearchResult, what: string, where: string): string {
  const w = what ? `${what} ` : "";
  if (!r.total) return `There are no live ${w}jobs${where} right now. New jobs arrive every hour — check back soon, or let ${BRAND.name} watch for you.`;
  const companies = [...new Set(r.hits.map((h) => h.job.company))].slice(0, 4);
  const flexible = (r.facets.workMode.remote || 0) + (r.facets.workMode.hybrid || 0);
  const pays = r.hits.flatMap((h) => [h.job.salaryMinLPA, h.job.salaryMaxLPA]).filter((x): x is number => typeof x === "number" && x > 0);
  const parts = [`${r.total.toLocaleString("en-IN")} live ${w}${r.total === 1 ? "job" : "jobs"}${where}, checked against employers' own careers pages.`];
  if (companies.length) parts.push(`Recent openings include ${companies.slice(0, -1).join(", ")}${companies.length > 1 ? " and " : ""}${companies.at(-1)}.`);
  if (flexible) parts.push(`${flexible.toLocaleString("en-IN")} offer remote or hybrid work.`);
  if (pays.length >= 3) parts.push(`Where pay is shown, recent listings range from ₹${Math.min(...pays)} to ₹${Math.max(...pays)} LPA.`);
  return parts.join(" ");
}

interface ListingSpec {
  h1: string;
  title: string;
  description: (r: JobSearchResult) => string;
  path: string;
  query: JobQuery;
  crumbs: Array<[string, string]>;
  what: string;
  where: string;
  blurb?: string;
  related?: (r: JobSearchResult) => Array<{ heading: string; links: Array<[string, string]> }>;
}

async function renderListing(req: Request, res: Response, spec: ListingSpec) {
  const n = pageNum(req);
  const html = await cached(`list:${spec.path}:${JSON.stringify(spec.query)}:${n}`, async () => {
    const r = await search({ ...spec.query, page: n });
    if (n > 1 && !r.hits.length) return null;
    const index = r.total >= MIN_INDEXABLE && !req.query.q;
    const pages = Math.min(MAX_PAGE, Math.ceil(r.total / PAGE_SIZE));
    const related = spec.related?.(r).filter((g) => g.links.length) || [];
    const body = `${breadcrumbHtml(spec.crumbs)}
<div class="hero">
  <span class="count">${r.total.toLocaleString("en-IN")} live ${r.total === 1 ? "job" : "jobs"} · updated ${esc(monthYear())}</span>
  <h1>${esc(spec.h1)}</h1>
  <p>${esc(introFor(r, spec.what, spec.where))}${spec.blurb ? ` ${esc(spec.blurb)}` : ""}</p>
</div>
<form class="search" action="/jobs" method="get" role="search">
  <input name="q" placeholder="Job title, skill or company" aria-label="Job title, skill or company" value="${esc(spec.query.q || "")}">
  <input name="city" placeholder="City" aria-label="City" value="${esc(spec.query.cities?.[0] || "")}">
  <button class="btn">Search</button>
</form>
${r.hits.length ? `<div class="grid">${r.hits.map((h) => jobCardHtml(h.job)).join("\n")}</div>` : `<div class="empty"><p>No live jobs here right now.</p><p><a class="btn" href="/">Let ${BRAND.name} watch for you</a></p></div>`}
${pages > 1 ? `<nav class="pager" aria-label="Pages">${n > 1 ? `<a href="${esc(withPage(spec.path, n - 1))}" rel="prev">← Newer</a>` : "<span></span>"}<span>Page ${n} of ${pages}</span>${n < pages ? `<a href="${esc(withPage(spec.path, n + 1))}" rel="next">More jobs →</a>` : "<span></span>"}</nav>` : ""}
<div class="cta"><div><h2>Which of these fit you best?</h2><p>Upload your resume once — ${BRAND.name} scores every job for you, explains the match and tracks your applications. Free.</p></div><a class="btn big" href="/" data-track="sign_up_click">Get my matches</a></div>
${related.map((g) => `<section class="more"><h2>${esc(g.heading)}</h2><ul class="links">${g.links.map(([t, p]) => `<li><a href="${esc(p)}">${esc(t)}</a></li>`).join("")}</ul></section>`).join("\n")}`;
    return page({
      title: n > 1 ? `${spec.title} — page ${n}` : spec.title, description: spec.description(r), path: withPage(spec.path, n), index, body, footerLinks: await footerLinks(),
      jsonLd: [breadcrumbLd(spec.crumbs), { "@context": "https://schema.org", "@type": "ItemList", itemListElement: r.hits.map((h, i) => ({ "@type": "ListItem", position: (n - 1) * PAGE_SIZE + i + 1, url: abs(jobPath(h.job)) })) }],
    });
  });
  if (html === null) return send(res, await notFoundHtml(), 404);
  send(res, html);
}

const topCities = (r: JobSearchResult, limit = 10) =>
  Object.entries(r.facets.city).filter(([, n]) => n >= MIN_INDEXABLE).sort((a, b) => b[1] - a[1]).map(([c]) => resolveCity(citySlug(c))).filter((c): c is { name: string; slug: string } => Boolean(c)).slice(0, limit);

function roleListing(role: RolePage, city: { name: string; slug: string } | null): ListingSpec {
  const special = SPECIAL_PAGES.includes(role);
  const label = `${role.name} Jobs`;
  const where = city ? ` in ${city.name}` : " in India";
  const path = city ? `/${role.slug}-jobs-in-${city.slug}` : `/${role.slug}-jobs`;
  return {
    h1: `${label}${where}`,
    title: `${label}${where} (${monthYear()}) | ${BRAND.name}`,
    description: (r) => `${r.total.toLocaleString("en-IN")} live ${role.name.toLowerCase()} jobs${where}. ${role.blurb} See salary, experience and how well you match — free on ${BRAND.name}.`.slice(0, 300),
    path,
    query: { ...role.query, ...(city ? { cities: [city.name], strictCity: true } : {}), sort: special ? "newest" : "relevance" },
    crumbs: [["Home", "/"], ["Jobs", "/jobs"], ...(city ? [[`${role.name} jobs`, `/${role.slug}-jobs`] as [string, string]] : []), [`${label}${city ? ` in ${city.name}` : ""}`, path]],
    what: special ? role.name.toLowerCase() : role.name,
    where,
    related: (r) => [
      ...(city ? [] : [{ heading: `${role.name} jobs by city`, links: topCities(r).map((c) => [`${role.name} jobs in ${c.name}`, `/${role.slug}-jobs-in-${c.slug}`] as [string, string]) }]),
      ...(city ? [{ heading: `More jobs in ${city.name}`, links: [[`All jobs in ${city.name}`, `/jobs-in-${city.slug}`], [`Fresher jobs in ${city.name}`, `/fresher-jobs-in-${city.slug}`], ...ROLE_PAGES.filter((x) => x !== role).slice(0, 10).map((x) => [`${x.name} jobs in ${city.name}`, `/${x.slug}-jobs-in-${city.slug}`])] as Array<[string, string]> }] : []),
    ],
  };
}

function cityListing(city: { name: string; slug: string }): ListingSpec {
  const path = `/jobs-in-${city.slug}`;
  return {
    h1: `Jobs in ${city.name}`,
    title: `Jobs in ${city.name} (${monthYear()}) — latest openings | ${BRAND.name}`,
    description: (r) => `${r.total.toLocaleString("en-IN")} live jobs in ${city.name} from company careers sites: tech, sales, support, operations, delivery and more. Filter by salary and experience, free on ${BRAND.name}.`,
    path,
    query: { cities: [city.name], strictCity: true, sort: "newest" },
    crumbs: [["Home", "/"], ["Jobs", "/jobs"], [`Jobs in ${city.name}`, path]],
    what: "", where: ` in ${city.name}`,
    related: () => [{ heading: `Popular jobs in ${city.name}`, links: [...SPECIAL_PAGES.filter((s) => ["fresher", "part-time", "internship"].includes(s.slug)), ...ROLE_PAGES.slice(0, 20)].map((x) => [`${x.name} jobs in ${city.name}`, `/${x.slug}-jobs-in-${city.slug}`] as [string, string]) }],
  };
}

// ---------------- job page ----------------

async function renderJob(req: Request, res: Response) {
  const id = /(job_[a-z0-9]+)$/.exec(req.params.slug)?.[1];
  const job = id ? await (await getStore()).get<Job>("jobs", id) : null;
  if (!isPublic(job)) return send(res, await notFoundHtml(), 404);
  const canonical = jobPath(job);
  if (req.path !== canonical) return res.redirect(301, canonical);

  const html = await cached(`job:${job.id}:${job.lastVerifiedAt}:${job.status}`, async () => {
    const open = RECOMMENDABLE.includes(job.status);
    const city = job.cities?.[0] || job.city;
    const cityRef = city ? resolveCity(citySlug(city)) : null;
    const role = ROLE_PAGES.find((r) => r.query.q && r.query.q.split(" ").every((w) => job.title.toLowerCase().includes(w)));
    const similar = (await search({ q: job.title, cities: city ? [city] : undefined, sort: "relevance", pageSize: 7 })).hits.map((h) => h.job).filter((j) => j.id !== job.id).slice(0, 6);
    const src = job.sources[0];
    const apply = src?.applyUrl || src?.sourceUrl;
    const facts: Array<[string, string]> = ([
      ["Location", placeText(job)], ["Work mode", WORK_MODE[job.workMode] || ""], ["Job type", EMPLOYMENT[job.employmentType] || ""],
      ["Experience", expText(job)], ["Salary", payText(job) || "Not disclosed"], ["Posted", ago(job.postedAt || job.firstSeenAt)],
    ] as Array<[string, string]>).filter(([, v]) => v);
    const crumbs: Array<[string, string]> = [["Home", "/"], ["Jobs", "/jobs"], ...(cityRef ? [[`Jobs in ${cityRef.name}`, `/jobs-in-${cityRef.slug}`] as [string, string]] : []), [job.title, canonical]];
    const body = `${breadcrumbHtml(crumbs)}
${open ? "" : `<p class="closed">This job is no longer accepting applications. Similar live jobs are listed below.</p>`}
<div class="jobpage">
  <article class="panel">
    <div class="jobhead"><h1>${esc(job.title)}</h1><p class="co">${esc(job.company)}</p></div>
    <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    ${job.skills.length ? `<h2 style="font-size:16px;margin:22px 0 4px">Skills mentioned</h2><div class="chips">${job.skills.slice(0, 18).map((s) => `<span>${esc(s.replace(/_/g, " "))}</span>`).join("")}</div>` : ""}
    <h2 style="font-size:19px;margin:24px 0 6px">About the job</h2>
    <div class="desc">${descriptionHtml(job.description)}</div>
    ${src ? `<p class="source">Source: ${esc(src.sourceName)}${src.sourceUrl ? ` · <a href="${esc(src.sourceUrl)}" rel="nofollow noopener" target="_blank">View the original listing</a>` : ""}. Last checked ${esc(ago(job.lastVerifiedAt))}.</p>` : ""}
  </article>
  <aside class="side">
    <div class="panel">
      <h2 style="font-size:18px;margin:0 0 6px">How well do you match?</h2>
      <p>Get your match score, the skills you're missing and a tailored resume for this job — free.</p>
      <p><a class="btn big" href="/#job/${esc(job.id)}" data-track="sign_up_click">Check my match</a></p>
    </div>
    ${open && apply ? `<div class="panel"><h2 style="font-size:16px;margin:0 0 6px">Apply</h2><p>You apply on ${esc(job.company)}'s own page. ${BRAND.name} never charges you or asks for fees.</p><p><a class="btn ghost" href="${esc(apply)}" rel="nofollow noopener" target="_blank" data-track="apply_click">Apply on company site ↗</a></p></div>` : ""}
    <div class="panel"><h2 style="font-size:16px;margin:0 0 6px">Explore</h2><ul class="links">
      ${cityRef ? `<li><a href="/jobs-in-${cityRef.slug}">Jobs in ${esc(cityRef.name)}</a></li>` : ""}
      ${role ? `<li><a href="/${role.slug}-jobs">${esc(role.name)} jobs</a></li>` : ""}
      ${role && cityRef ? `<li><a href="/${role.slug}-jobs-in-${cityRef.slug}">${esc(role.name)} jobs in ${esc(cityRef.name)}</a></li>` : ""}
      ${job.freshersWelcome ? `<li><a href="/fresher-jobs">Fresher jobs</a></li>` : ""}
      ${job.workMode === "remote" ? `<li><a href="/remote-jobs">Remote jobs</a></li>` : ""}
    </ul></div>
  </aside>
</div>
${similar.length ? `<section class="more"><h2>Similar jobs</h2><div class="grid">${similar.map(jobCardHtml).join("\n")}</div></section>` : ""}`;
    const where = placeText(job);
    return page({
      title: `${job.title} at ${job.company}${where ? `, ${where}` : ""} | ${BRAND.name}`,
      description: `${job.company} is hiring a ${job.title}${where ? ` in ${where}` : ""}. ${[expText(job), payText(job), WORK_MODE[job.workMode]].filter(Boolean).join(" · ")}. See the full description and check your match — free.`.slice(0, 300),
      path: canonical, index: open, ogType: "article", body, footerLinks: await footerLinks(),
      jsonLd: [breadcrumbLd(crumbs), ...(open ? [jobPostingLd(job)] : [])],
    });
  });
  send(res, html);
}

// ---------------- hub ----------------

async function renderHub(req: Request, res: Response) {
  const q = String(req.query.q || "").trim().slice(0, 80);
  const cityRaw = String(req.query.city || "").trim().slice(0, 40);
  const city = cityRaw ? resolveCity(slugify(cityRaw)) : null;
  // "Jobs in Pune" has its own page; send people (and search engines) there.
  if (!q && city) return res.redirect(301, `/jobs-in-${city.slug}`);
  if (!q && req.query.city !== undefined) return res.redirect(301, "/jobs");
  const stats = await publicStats();
  const spec: ListingSpec = {
    h1: q ? `${q} jobs${city ? ` in ${city.name}` : ""}` : "Jobs in India",
    title: q ? `${q} jobs${city ? ` in ${city.name}` : ""} | ${BRAND.name}` : `Jobs in India (${monthYear()}) — ${stats.liveJobs.toLocaleString("en-IN")} live openings | ${BRAND.name}`,
    description: () => `Search ${stats.liveJobs.toLocaleString("en-IN")} live jobs from ${stats.companies.toLocaleString("en-IN")} companies across India — straight from employers' careers sites, scam-checked and free.`,
    path: q ? `/jobs?q=${encodeURIComponent(q)}${city ? `&city=${city.slug}` : ""}` : "/jobs",
    query: { q: q || undefined, cities: city ? [city.name] : undefined, sort: q ? "relevance" : "newest" },
    crumbs: [["Home", "/"], ["Jobs", "/jobs"]],
    what: q ? `"${q}"` : "", where: city ? ` in ${city.name}` : " in India",
    related: () => [
      { heading: "Jobs by city", links: stats.topCities.map((c) => [`Jobs in ${c.city}`, `/jobs-in-${citySlug(c.city)}`] as [string, string]) },
      { heading: "Popular searches", links: [...SPECIAL_PAGES.filter((s) => s.slug !== "work-from-home"), ...ROLE_PAGES].map((r) => [`${r.name} jobs`, `/${r.slug}-jobs`] as [string, string]) },
    ],
  };
  return renderListing(req, res, spec);
}

// ---------------- sitemaps ----------------

async function publicJobs(): Promise<Job[]> {
  return (await (await getStore()).query<Job>("jobs")).filter((j) => isPublic(j) && RECOMMENDABLE.includes(j.status));
}

const xmlEsc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
const urlset = (urls: Array<{ loc: string; lastmod?: string }>) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${xmlEsc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod.slice(0, 10)}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;

/** Every listing page worth indexing: roles, specials, cities and role × city combinations with enough live jobs. */
export async function listingPaths(): Promise<string[]> {
  return cached("sitemap:listings", async () => {
    const paths = new Set<string>(["/", "/jobs"]);
    for (const role of [...SPECIAL_PAGES.filter((s) => !CANONICAL_SPECIAL[s.slug]), ...ROLE_PAGES]) {
      const r = await search({ ...role.query, pageSize: 1 });
      if (r.total < MIN_INDEXABLE) continue;
      paths.add(`/${role.slug}-jobs`);
      if (role.slug !== "remote") for (const c of topCities(r, 40)) paths.add(`/${role.slug}-jobs-in-${c.slug}`);
    }
    const all = await search({ pageSize: 1 });
    for (const c of topCities(all, 200)) paths.add(`/jobs-in-${c.slug}`);
    return [...paths];
  });
}

export function seoPages(): Router {
  const r = Router();

  r.get("/seo.css", (_req, res) => res.type("text/css").set("Cache-Control", "public, max-age=86400").send(SEO_CSS));

  r.get("/sitemap.xml", async (_req, res, next) => {
    try {
      const jobs = await publicJobs();
      const files = ["/sitemaps/pages.xml", ...Array.from({ length: Math.max(1, Math.ceil(jobs.length / SITEMAP_CHUNK)) }, (_, i) => `/sitemaps/jobs-${i + 1}.xml`)];
      const now = new Date().toISOString().slice(0, 10);
      res.type("application/xml").set("Cache-Control", "public, max-age=3600").send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${files.map((f) => `<sitemap><loc>${xmlEsc(abs(f))}</loc><lastmod>${now}</lastmod></sitemap>`).join("\n")}\n</sitemapindex>\n`,
      );
    } catch (e) { next(e); }
  });

  r.get("/sitemaps/pages.xml", async (_req, res, next) => {
    try {
      res.type("application/xml").set("Cache-Control", "public, max-age=3600").send(urlset((await listingPaths()).map((p) => ({ loc: abs(p) }))));
    } catch (e) { next(e); }
  });

  r.get("/sitemaps/jobs-:n.xml", async (req, res, next) => {
    try {
      const n = Number.parseInt(req.params.n, 10);
      const jobs = (await publicJobs()).sort((a, b) => a.id.localeCompare(b.id)).slice((n - 1) * SITEMAP_CHUNK, n * SITEMAP_CHUNK);
      if (!Number.isFinite(n) || n < 1 || (!jobs.length && n > 1)) return res.status(404).type("text/plain").send("Not found");
      res.type("application/xml").set("Cache-Control", "public, max-age=3600").send(urlset(jobs.map((j) => ({ loc: abs(jobPath(j)), lastmod: j.lastVerifiedAt }))));
    } catch (e) { next(e); }
  });

  r.get("/jobs", (req, res, next) => { renderHub(req, res).catch(next); });
  r.get("/jobs/:slug", (req, res, next) => { renderJob(req, res).catch(next); });

  // /<role>-jobs, /<role>-jobs-in-<city>, /jobs-in-<city>
  r.get("/:slug", (req, res, next) => {
    const slug = req.params.slug;
    const cityOnly = /^jobs-in-([a-z0-9-]+)$/.exec(slug);
    const roleCity = /^([a-z0-9-]+?)-jobs(?:-in-([a-z0-9-]+))?$/.exec(slug);
    if (!cityOnly && !roleCity) return next();
    (async () => {
      if (cityOnly) {
        const city = resolveCity(cityOnly[1]);
        if (!city) return send(res, await notFoundHtml(), 404);
        if (city.slug !== cityOnly[1]) return res.redirect(301, `/jobs-in-${city.slug}`);
        return renderListing(req, res, cityListing(city));
      }
      const [, roleSlug, citySlugIn] = roleCity!;
      const canonicalRole = CANONICAL_SPECIAL[roleSlug] || roleSlug;
      const role = rolePage(canonicalRole);
      if (!role) return send(res, await notFoundHtml(), 404);
      const city = citySlugIn ? resolveCity(citySlugIn) : null;
      if (citySlugIn && !city) return send(res, await notFoundHtml(), 404);
      const want = city ? `/${canonicalRole}-jobs-in-${city.slug}` : `/${canonicalRole}-jobs`;
      if (req.path !== want) return res.redirect(301, want);
      return renderListing(req, res, roleListing(role, city));
    })().catch(next);
  });

  return r;
}
