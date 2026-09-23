// Free job-search APIs that aggregate many employers. Each needs a free key; the connector stays off until one is set.
import { config } from "../config.js";
import { stripHtml } from "../nlp/text.js";
import { fetchJson } from "./http.js";
import type { RawJob } from "./normalize.js";

/** Used when no candidate has target roles yet: a spread across white-collar, frontline and entry-level work. */
export const DEFAULT_KEYWORDS = [
  "software engineer", "sales executive", "customer support", "accountant", "delivery executive", "data analyst",
  "nurse", "teacher", "electrician", "project manager", "business development", "fresher",
];

const pick = (keywords: string[], n: number) => (keywords.length ? keywords : DEFAULT_KEYWORDS).slice(0, n);

// ------------------------------------------------------------------ Careerjet (partner API v4, free key)
// Auth: API key as the HTTP Basic username; a Referer naming the calling page is required.
export async function fetchCareerjet(keywords: string[]): Promise<RawJob[]> {
  const auth = Buffer.from(`${config.careerjet.apiKey}:`).toString("base64");
  const out: RawJob[] = [];
  for (const kw of pick(keywords, 6)) {
    const q = new URLSearchParams({ locale_code: "en_IN", keywords: kw, location: "India", page_size: "50", sort: "date", user_ip: "127.0.0.1", user_agent: config.userAgent });
    const data = await fetchJson<any>(`https://search.api.careerjet.net/v4/query?${q}`, { headers: { Authorization: `Basic ${auth}`, Referer: config.careerjet.referer } });
    for (const j of data?.jobs || []) {
      out.push({
        connector: "careerjet", sourceName: `Careerjet${j.site ? ` · ${j.site}` : ""}`, sourceJobId: String(j.id || j.url), title: stripHtml(j.title || ""), company: j.company || "",
        location: j.locations || "", description: stripHtml(j.description || ""), url: j.url, applyUrl: j.url, postedAt: j.date, salaryText: j.salary || undefined,
        salary: j.salary_min || j.salary_max ? { min: Number(j.salary_min) || undefined, max: Number(j.salary_max) || undefined, currency: j.salary_currency_code || "INR" } : undefined,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ Free remote-job feeds (no key; attribution via source label + link)

/** Himalayas: remote jobs with explicit country restrictions — we keep worldwide ones and those open to India/APAC. */
export async function fetchHimalayas(): Promise<RawJob[]> {
  const out: RawJob[] = [];
  let cursor = "";
  for (let page = 0; page < 12; page++) { // 20 per page
    const data = await fetchJson<any>(`https://himalayas.app/jobs/api?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    for (const j of data?.jobs || []) {
      const places: string[] = j.locationRestrictions || [];
      out.push({
        connector: "himalayas", sourceName: "Himalayas", sourceJobId: String(j.guid || j.applicationLink), title: j.title || "", company: j.companyName || "",
        location: places.length ? `Remote - ${places.join(", ")}` : "Remote - Worldwide", remote: true, employmentType: j.employmentType,
        description: stripHtml(j.description || j.excerpt || ""), url: j.guid || j.applicationLink, applyUrl: j.applicationLink || j.guid,
        postedAt: typeof j.pubDate === "number" ? j.pubDate * 1000 : j.pubDate, deadline: typeof j.expiryDate === "number" ? j.expiryDate * 1000 : j.expiryDate,
        salary: j.minSalary && j.currency === "INR" ? { min: j.minSalary, max: j.maxSalary, currency: "INR" } : undefined,
      });
    }
    cursor = data?.nextCursor || "";
    if (!cursor) break;
  }
  return out;
}

/** Remote OK (terms: link back and name the source — our source label and "original listing" link do both). */
export async function fetchRemoteOk(): Promise<RawJob[]> {
  const data = await fetchJson<any[]>("https://remoteok.com/api");
  return (Array.isArray(data) ? data.slice(1) : []).filter((j) => j?.id && j.position).map((j): RawJob => ({
    connector: "remoteok", sourceName: "Remote OK", sourceJobId: String(j.id), title: j.position, company: j.company || "",
    location: j.location ? `Remote - ${j.location}` : "Remote", remote: true, description: stripHtml(j.description || ""),
    url: j.url, applyUrl: j.apply_url || j.url, postedAt: j.date,
  }));
}

/** Jobicy has no India filter; APAC and "anywhere" roles are fetched and the region filter drops other countries. */
export async function fetchJobicy(): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const geo of ["apac", "anywhere"]) {
    const data = await fetchJson<any>(`https://jobicy.com/api/v2/remote-jobs?count=100&geo=${geo}`);
    for (const j of data?.jobs || []) out.push({
      connector: "jobicy", sourceName: "Jobicy", sourceJobId: String(j.id), title: stripHtml(j.jobTitle || ""), company: j.companyName || "",
      location: `Remote - ${j.jobGeo || "Anywhere"}`, remote: true, employmentType: Array.isArray(j.jobType) ? j.jobType.join(" ") : j.jobType,
      description: stripHtml(j.jobDescription || j.jobExcerpt || ""), url: j.url, applyUrl: j.url, postedAt: j.pubDate,
    });
  }
  return out;
}

// ------------------------------------------------------------------ Jooble (REST API, free key)
export async function fetchJooble(keywords: string[]): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const kw of pick(keywords, 6)) {
    const data = await fetchJson<any>(`https://jooble.org/api/${encodeURIComponent(config.jooble.apiKey)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keywords: kw, location: "India", page: "1" }),
    });
    for (const j of data?.jobs || []) {
      out.push({
        connector: "jooble", sourceName: `Jooble${j.source ? ` · ${j.source}` : ""}`, sourceJobId: String(j.id || j.link), title: stripHtml(j.title || ""), company: j.company || "",
        location: j.location || "", employmentType: j.type || undefined, description: stripHtml(j.snippet || ""), url: j.link, applyUrl: j.link, postedAt: j.updated, salaryText: j.salary || undefined,
      });
    }
  }
  return out;
}
