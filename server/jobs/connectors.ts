import * as cheerio from "cheerio";
import { config } from "../config.js";
import { parseLocation } from "../nlp/location.js";
import { stripHtml } from "../nlp/text.js";
import { DEFAULT_KEYWORDS, fetchCareerjet, fetchHimalayas, fetchJobicy, fetchJooble, fetchRemoteOk } from "./aggregators.js";
import { jobPostingsFromHtml } from "./ats.js";
import { fetchJson, safeFetchText } from "./http.js";
import type { RawJob } from "./normalize.js";
import { REGISTRY_ATS, registryConnector } from "./registry.js";

export interface DiscoveryContext {
  keywords: string[]; // union of active users' target roles
}

export interface JobConnector {
  id: string;
  name: string;
  kind: "ats" | "public_feed" | "official_api" | "company_pages";
  access: string; // how we access it
  terms: string; // permission / terms status
  /** Overrides the default per-connector timeout (registry connectors fetch many boards per run). */
  timeoutMs?: number;
  isConfigured(): boolean;
  fetch(ctx: DiscoveryContext): Promise<RawJob[]>;
}

/** Companies with India hiring that publish a public ATS board. Verified live on 2026-09-19 with scripts/probe-boards.ts — re-run it to refresh. */
export const DEFAULT_BOARDS = {
  greenhouse: ["inmobi", "glance", "druva", "groww", "databricks", "stripe", "twilio", "okta", "mongodb", "cloudflare", "dropbox", "airbnb", "elastic", "datadog", "gitlab"],
  lever: ["paytm", "meesho", "mindtickle", "zeta", "cred"],
  ashby: ["snowflake", "notion", "ramp", "cohere", "zapier"],
  smartrecruiters: ["Freshworks", "BoschGroup", "Experian"],
};

const prettify = (slug: string) => slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ------------------------------------------------------------------ Greenhouse
export async function fetchGreenhouseBoard(board: string): Promise<RawJob[]> {
  const base = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}`;
  const data = await fetchJson<any>(`${base}/jobs?content=true`);
  let company = prettify(board);
  try {
    company = (await fetchJson<any>(base))?.name || company;
  } catch {
    /* name is cosmetic */
  }
  return (Array.isArray(data?.jobs) ? data.jobs : []).map((j: any): RawJob => ({
    connector: "greenhouse", sourceName: `Greenhouse · ${company}`, sourceJobId: String(j.id), title: j.title, company,
    location: j.location?.name || "", description: stripHtml(j.content || ""), url: j.absolute_url, applyUrl: j.absolute_url,
    postedAt: j.first_published || j.updated_at, updatedAt: j.updated_at,
  }));
}

// ------------------------------------------------------------------ Lever
export async function fetchLeverSite(site: string): Promise<RawJob[]> {
  const data = await fetchJson<any[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json&limit=200`);
  const company = prettify(site);
  return (Array.isArray(data) ? data : []).map((j: any): RawJob => ({
    connector: "lever", sourceName: `Lever · ${company}`, sourceJobId: String(j.id), title: j.text, company,
    location: j.categories?.location || (j.categories?.allLocations || []).join(", ") || "", workplace: j.workplaceType,
    employmentType: j.categories?.commitment, description: j.descriptionPlain || stripHtml(j.description || ""),
    url: j.hostedUrl, applyUrl: j.applyUrl || j.hostedUrl, postedAt: j.createdAt,
    salary: j.salaryRange ? { min: j.salaryRange.min, max: j.salaryRange.max, currency: j.salaryRange.currency } : undefined,
  }));
}

// ------------------------------------------------------------------ Ashby
export async function fetchAshbyBoard(board: string): Promise<RawJob[]> {
  const data = await fetchJson<any>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`);
  const company = prettify(board);
  return (Array.isArray(data?.jobs) ? data.jobs : []).filter((j: any) => j.isListed !== false).map((j: any): RawJob => ({
    connector: "ashby", sourceName: `Ashby · ${company}`, sourceJobId: String(j.id), title: j.title, company,
    location: j.location || (j.address?.postalAddress?.addressLocality ?? ""), remote: j.isRemote, workplace: j.workplaceType, employmentType: j.employmentType,
    description: j.descriptionPlain || stripHtml(j.descriptionHtml || ""), url: j.jobUrl, applyUrl: j.applyUrl || j.jobUrl, postedAt: j.publishedAt,
  }));
}

// ------------------------------------------------------------------ SmartRecruiters
export async function fetchSmartRecruiters(companyId: string): Promise<RawJob[]> {
  const list = await fetchJson<any>(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}/postings?limit=100&country=in`);
  const company = prettify(companyId);
  const out: RawJob[] = [];
  for (const p of (list?.content || []).slice(0, 40)) {
    try {
      const d = await fetchJson<any>(p.ref);
      const sections = d?.jobAd?.sections || {};
      const desc = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"].map((k) => stripHtml(sections[k]?.text || "")).join("\n");
      out.push({
        connector: "smartrecruiters", sourceName: `SmartRecruiters · ${p.company?.name || company}`, sourceJobId: String(p.id), title: p.name, company: p.company?.name || company,
        location: [p.location?.city, p.location?.country?.toUpperCase()].filter(Boolean).join(", "), remote: p.location?.remote, employmentType: p.typeOfEmployment?.label,
        description: desc, url: d?.postingUrl || p.ref, applyUrl: d?.applyUrl || d?.postingUrl, postedAt: p.releasedDate,
      });
    } catch {
      /* skip individual posting failures */
    }
  }
  return out;
}

/** Route a full public feed URL to the right ATS fetcher. */
export async function fetchFeedUrl(url: string): Promise<RawJob[]> {
  const gh = url.match(/boards-api\.greenhouse\.io\/v1\/boards\/([^/?]+)/);
  if (gh) return fetchGreenhouseBoard(gh[1]);
  const lv = url.match(/api\.lever\.co\/v0\/postings\/([^/?]+)/);
  if (lv) return fetchLeverSite(lv[1]);
  const ab = url.match(/api\.ashbyhq\.com\/posting-api\/job-board\/([^/?]+)/);
  if (ab) return fetchAshbyBoard(ab[1]);
  const sr = url.match(/api\.smartrecruiters\.com\/v1\/companies\/([^/?]+)/);
  if (sr) return fetchSmartRecruiters(sr[1]);
  throw new Error(`Unsupported feed URL: ${url}`);
}

// ------------------------------------------------------------------ Public feeds
async function fetchRemotive(keywords: string[]): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const kw of keywords.slice(0, 3)) {
    const data = await fetchJson<any>(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(kw)}&limit=40`);
    for (const j of data?.jobs || [])
      out.push({
        connector: "remotive", sourceName: "Remotive", sourceJobId: String(j.id), title: j.title, company: j.company_name, companyUrl: undefined,
        location: j.candidate_required_location || "Remote", remote: true, employmentType: j.job_type, description: stripHtml(j.description || ""),
        url: j.url, applyUrl: j.url, postedAt: j.publication_date, salaryText: j.salary || undefined, industry: j.category,
      });
  }
  return out;
}

async function fetchArbeitnow(): Promise<RawJob[]> {
  const data = await fetchJson<any>("https://www.arbeitnow.com/api/job-board-api");
  return (data?.data || []).map((j: any): RawJob => ({
    connector: "arbeitnow", sourceName: "Arbeitnow", sourceJobId: String(j.slug), title: j.title, company: j.company_name, location: j.location || "",
    remote: j.remote, description: stripHtml(j.description || ""), url: j.url, applyUrl: j.url, postedAt: j.created_at, employmentType: (j.job_types || []).join(" "),
  }));
}

// ------------------------------------------------------------------ Adzuna (official API, free key)
async function fetchAdzuna(keywords: string[]): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const kw of keywords.slice(0, 4)) {
    const url = `https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=${config.adzuna.appId}&app_key=${config.adzuna.appKey}&results_per_page=40&what=${encodeURIComponent(kw)}&content-type=application/json`;
    const data = await fetchJson<any>(url);
    for (const j of data?.results || [])
      out.push({
        connector: "adzuna", sourceName: "Adzuna", sourceJobId: String(j.id), title: stripHtml(j.title), company: j.company?.display_name || "", location: j.location?.display_name || "",
        description: stripHtml(j.description || ""), url: j.redirect_url, applyUrl: j.redirect_url, postedAt: j.created, employmentType: j.contract_time,
        salary: j.salary_min ? { min: j.salary_min, max: j.salary_max, currency: "INR" } : undefined,
      });
  }
  return out;
}

const settled = async (tasks: Array<Promise<RawJob[]>>): Promise<RawJob[]> => {
  const res = await Promise.allSettled(tasks);
  const ok = res.filter((r): r is PromiseFulfilledResult<RawJob[]> => r.status === "fulfilled").flatMap((r) => r.value);
  if (!ok.length && res.length && res.every((r) => r.status === "rejected")) throw (res[0] as PromiseRejectedResult).reason;
  return ok;
};

export function buildConnectors(): JobConnector[] {
  const extraFeeds = config.publicAtsFeeds;
  const kw = (ctx: DiscoveryContext) => (ctx.keywords.length ? ctx.keywords : DEFAULT_KEYWORDS);
  const all: JobConnector[] = [
    // Company careers systems, driven by the company registry (server/jobs/registry.ts).
    ...REGISTRY_ATS.map(registryConnector),
    { id: "custom_feeds", name: "Configured company feeds", kind: "ats", access: "Operator-supplied public feed URLs", terms: "Operator responsibility", isConfigured: () => extraFeeds.length > 0,
      fetch: () => settled(extraFeeds.map(fetchFeedUrl)) },
    // Aggregators and public feeds.
    { id: "adzuna", name: "Adzuna India", kind: "official_api", access: "Official API (free key)", terms: "Requires developer key; see developer.adzuna.com", isConfigured: () => Boolean(config.adzuna.appId && config.adzuna.appKey),
      fetch: (ctx) => fetchAdzuna(kw(ctx)) },
    { id: "careerjet", name: "Careerjet India", kind: "official_api", access: "Partner API v4 (free key)", terms: "Requires partner key; see careerjet.com/partners", isConfigured: () => Boolean(config.careerjet.apiKey && config.careerjet.referer),
      fetch: (ctx) => fetchCareerjet(kw(ctx)) },
    { id: "jooble", name: "Jooble India", kind: "official_api", access: "REST API (free key)", terms: "Requires API key; see jooble.org/api/about", isConfigured: () => Boolean(config.jooble.apiKey),
      fetch: (ctx) => fetchJooble(kw(ctx)) },
    { id: "remotive", name: "Remotive", kind: "public_feed", access: "Public JSON API", terms: "Free public API; attribution required, low request rate", isConfigured: () => true,
      fetch: (ctx) => fetchRemotive(kw(ctx)) },
    { id: "arbeitnow", name: "Arbeitnow", kind: "public_feed", access: "Public JSON API", terms: "Free public API", isConfigured: () => true, fetch: () => fetchArbeitnow() },
    { id: "himalayas", name: "Himalayas (remote)", kind: "public_feed", access: "Public JSON API", terms: "Free public API; source named and linked", isConfigured: () => true, fetch: () => fetchHimalayas() },
    { id: "remoteok", name: "Remote OK", kind: "public_feed", access: "Public JSON API", terms: "Free API; must name Remote OK and link back to it", isConfigured: () => true, fetch: () => fetchRemoteOk() },
    { id: "jobicy", name: "Jobicy (remote)", kind: "public_feed", access: "Public JSON API", terms: "Free public API; source named and linked", isConfigured: () => true, fetch: () => fetchJobicy() },
  ];
  return all.filter((c) => !config.sources.disabled.includes(c.id));
}

// ------------------------------------------------------------------ User-provided job (URL / description)
export async function rawJobFromUrl(url: string): Promise<{ raw?: RawJob; needsAi?: { title: string; text: string; url: string } }> {
  const page = await safeFetchText(url);
  // 1) schema.org JobPosting JSON-LD (used by most career pages and aggregators)
  const posting = jobPostingsFromHtml(page.text, page.url, "user_url")[0];
  if (posting) return { raw: { ...posting, url: page.url, applyUrl: posting.applyUrl || page.url } };
  // 2) No structured data: hand the visible text to the AI extractor (caller decides), or heuristics.
  const $ = cheerio.load(page.text);
  $("script,style,nav,footer,header,noscript,svg").remove();
  const title = ($("h1").first().text() || $("title").first().text() || "").trim();
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 12000);
  return { needsAi: { title, text, url: page.url } };
}

export function rawJobFromDescription(input: { title?: string; company?: string; location?: string; description: string; url?: string }): RawJob {
  const loc = parseLocation(input.location || "");
  return {
    connector: "user_manual", sourceName: "Added by you", sourceJobId: `manual_${Date.now()}`, title: input.title || "", company: input.company || "",
    location: input.location || "", remote: loc.remote, description: input.description, url: input.url || "", applyUrl: input.url || "",
  };
}
