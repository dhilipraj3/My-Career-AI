// Fetchers for company careers systems beyond the original four (see connectors.ts).
// Every endpoint here was verified live on 2026-09-23. Each fetcher takes a registry "board" id and returns RawJobs.
import * as cheerio from "cheerio";
import { config } from "../config.js";
import { parseLocation } from "../nlp/location.js";
import { stripHtml } from "../nlp/text.js";
import { fetchJson, safeFetchText } from "./http.js";
import type { RawJob } from "./normalize.js";

const prettify = (slug: string) => slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const isIndiaText = (s: string) => parseLocation(s).india;

/** Run `fn` over `items` with at most `n` in flight (the global HTTP limiter still applies on top). */
async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

// ------------------------------------------------------------------ Workday
// board = "tenant|wdN|site", e.g. "nvidia|wd5|NVIDIAExternalCareerSite"
export function parseWorkdayBoard(board: string) {
  const [tenant, dc, site] = board.split("|");
  if (!tenant || !/^wd\d+$/.test(dc || "") || !site) throw new Error(`Invalid Workday board "${board}"`);
  return { tenant, dc, site, base: `https://${tenant}.${dc}.myworkdayjobs.com` };
}

export async function fetchWorkday(board: string, companyName?: string): Promise<RawJob[]> {
  const { tenant, site, base } = parseWorkdayBoard(board);
  const api = `${base}/wday/cxs/${tenant}/${site}`;
  const max = config.sources.maxJobsPerBoard;
  const listed: Array<{ title: string; externalPath: string; locationsText?: string }> = [];
  for (let offset = 0; offset < max; offset += 20) {
    const page = await fetchJson<any>(`${api}/jobs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: "India" }),
    });
    const posts = Array.isArray(page?.jobPostings) ? page.jobPostings : [];
    listed.push(...posts);
    if (posts.length < 20 || offset + 20 >= (page?.total ?? 0)) break;
  }
  // "5 Locations" doesn't say where; keep it and let the detail decide.
  const wanted = listed.filter((p) => p.externalPath && (!p.locationsText || isIndiaText(p.locationsText) || /\d+\s+locations/i.test(p.locationsText))).slice(0, max);
  const details = await mapLimit(wanted, 4, async (p) => {
    try {
      return { p, d: (await fetchJson<any>(`${api}${p.externalPath}`))?.jobPostingInfo };
    } catch {
      return { p, d: null };
    }
  });
  const company = companyName || prettify(tenant);
  const out: RawJob[] = [];
  for (const { p, d } of details) {
    if (!d) continue;
    const locations = [d.location, ...(d.additionalLocations || [])].filter(Boolean).join("; ");
    if (!isIndiaText(locations || p.locationsText || "") && !/remote/i.test(`${locations} ${d.remoteType || ""}`)) continue;
    const url = d.externalUrl || `${base}/${site}${p.externalPath}`;
    out.push({
      connector: "workday", sourceName: `Workday · ${company}`, sourceJobId: String(d.jobReqId || d.id || p.externalPath), title: d.title || p.title, company,
      location: locations || p.locationsText || "", remote: /remote/i.test(`${d.remoteType || ""}`), employmentType: d.timeType,
      description: stripHtml(d.jobDescription || ""), url, applyUrl: url, postedAt: d.startDate,
    });
  }
  return out;
}

// ------------------------------------------------------------------ Oracle Recruiting Cloud
// board = "host|siteNumber", e.g. "jpmc.fa.oraclecloud.com|CX_1001"
export function parseOracleBoard(board: string) {
  const [host, siteNumber] = board.split("|");
  if (!host || !/oraclecloud\.com$/.test(host) || !siteNumber) throw new Error(`Invalid Oracle board "${board}"`);
  return { host, siteNumber };
}

export async function fetchOracle(board: string, companyName?: string): Promise<RawJob[]> {
  const { host, siteNumber } = parseOracleBoard(board);
  const api = `https://${host}/hcmRestApi/resources/latest`;
  const max = Math.min(config.sources.maxJobsPerBoard, 100);
  const reqs: any[] = [];
  for (let offset = 0; offset < max; offset += 25) {
    const data = await fetchJson<any>(`${api}/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=${encodeURIComponent(siteNumber)},limit=25,offset=${offset},keyword=India,sortBy=POSTING_DATES_DESC`);
    const list = data?.items?.[0]?.requisitionList || [];
    reqs.push(...list.filter((r: any) => r.PrimaryLocationCountry === "IN" || isIndiaText(r.PrimaryLocation || "")));
    if (list.length < 25) break;
  }
  const company = companyName || prettify(host.split(".")[0]);
  const details = await mapLimit(reqs.slice(0, max), 4, async (r) => {
    try {
      const d = await fetchJson<any>(`${api}/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${encodeURIComponent(r.Id)}%22,siteNumber=${encodeURIComponent(siteNumber)}`);
      return { r, d: d?.items?.[0] || null };
    } catch {
      return { r, d: null };
    }
  });
  return details.map(({ r, d }): RawJob => {
    const url = `https://${host}/hcmUI/CandidateExperience/en/sites/${siteNumber}/job/${r.Id}`;
    const desc = d ? [d.ExternalDescriptionStr, d.ExternalResponsibilitiesStr, d.ExternalQualificationsStr].filter(Boolean).map(stripHtml).join("\n") : r.ShortDescriptionStr || "";
    return {
      connector: "oracle", sourceName: `Oracle Recruiting · ${company}`, sourceJobId: String(r.Id), title: r.Title, company,
      location: r.PrimaryLocation || "", workplace: r.WorkplaceType || undefined, employmentType: d?.JobSchedule || r.JobSchedule || undefined,
      description: desc, url, applyUrl: url, postedAt: d?.ExternalPostedStartDate || r.PostedDate, deadline: d?.ExternalPostedEndDate || undefined,
    };
  });
}

// ------------------------------------------------------------------ Recruitee (public offers API)
export async function fetchRecruitee(sub: string, companyName?: string): Promise<RawJob[]> {
  const data = await fetchJson<any>(`https://${encodeURIComponent(sub)}.recruitee.com/api/offers/`);
  return (data?.offers || []).map((o: any): RawJob => ({
    connector: "recruitee", sourceName: `Recruitee · ${companyName || o.company_name || prettify(sub)}`, sourceJobId: String(o.id), title: o.title,
    company: companyName || o.company_name || prettify(sub), location: [o.city, o.state_name, o.country].filter(Boolean).join(", ") || o.location || "",
    remote: Boolean(o.remote), employmentType: o.employment_type_code, description: stripHtml(`${o.description || ""}\n${o.requirements || ""}`),
    url: o.careers_url, applyUrl: o.careers_apply_url || o.careers_url, postedAt: o.published_at || o.created_at,
    salary: o.salary && (o.salary.min || o.salary.max) ? { min: Number(o.salary.min) || undefined, max: Number(o.salary.max) || undefined, currency: o.salary.currency } : undefined,
  }));
}

// ------------------------------------------------------------------ Workable (public widget API)
export async function fetchWorkable(sub: string, companyName?: string): Promise<RawJob[]> {
  const data = await fetchJson<any>(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(sub)}?details=true`);
  const company = companyName || data?.name || prettify(sub);
  return (data?.jobs || []).map((j: any): RawJob => {
    const locs = (j.locations?.length ? j.locations : [{ city: j.city, region: j.state, country: j.country }]).map((l: any) => [l.city, l.region, l.country].filter(Boolean).join(", "));
    return {
      connector: "workable", sourceName: `Workable · ${company}`, sourceJobId: String(j.shortcode || j.id), title: j.title, company,
      location: locs.join("; "), remote: Boolean(j.telecommuting), employmentType: j.employment_type, description: stripHtml(j.description || ""),
      url: j.url || j.shortlink, applyUrl: j.application_url || j.url, postedAt: j.published_on || j.created_at,
    };
  });
}

// ------------------------------------------------------------------ Teamtailor (public JSON feed per company)
// board = the careers host, e.g. "acme.teamtailor.com" or a custom domain like "careers.acme.com".
export async function fetchTeamtailor(host: string, companyName?: string): Promise<RawJob[]> {
  const data = await fetchJson<any>(`https://${host}/jobs.json`);
  const out: RawJob[] = [];
  for (const item of data?.items || []) {
    // Each item carries a schema.org JobPosting; reuse the same extraction as careers pages.
    const posting = item._jobposting ? jobPostingsFromHtml(`<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", ...item._jobposting })}</script>`, item.url, "teamtailor")[0] : undefined;
    out.push({
      ...(posting || { location: "", description: "" }),
      connector: "teamtailor", sourceName: `Teamtailor · ${companyName || host}`, sourceJobId: String(item.id), title: item.title,
      company: companyName || posting?.company || prettify(host.split(".")[0]), description: posting?.description || stripHtml(item.content_html || ""),
      url: item.url, applyUrl: item.url, postedAt: item.date_published,
    });
  }
  return out;
}

// ------------------------------------------------------------------ Generic careers page (schema.org JobPosting)

const salaryPeriod = (unit?: string) => {
  const u = String(unit || "").toUpperCase();
  return u === "MONTH" ? "month" : u === "DAY" ? "day" : u === "HOUR" ? "hour" : u === "YEAR" ? "year" : undefined;
};

/** Extract every schema.org JobPosting embedded as JSON-LD in a page. This is the data sites publish for Google for Jobs. */
export function jobPostingsFromHtml(html: string, pageUrl: string, connector = "careers_page"): RawJob[] {
  const $ = cheerio.load(html);
  const out: RawJob[] = [];
  const host = (() => { try { return new URL(pageUrl).hostname; } catch { return ""; } })();
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const type = node["@type"];
    if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) {
      const locs = (Array.isArray(node.jobLocation) ? node.jobLocation : [node.jobLocation]).filter(Boolean);
      const location = locs.map((l: any) => {
        const a = l?.address || {};
        return [a.addressLocality, a.addressRegion, a.addressCountry?.name || a.addressCountry].filter(Boolean).join(", ");
      }).filter(Boolean).join("; ");
      const sal = node.baseSalary?.value;
      const url = typeof node.url === "string" ? node.url : pageUrl;
      out.push({
        connector, sourceName: host, sourceJobId: node.identifier?.value ? String(node.identifier.value) : url,
        title: node.title || "", company: node.hiringOrganization?.name || "", companyUrl: typeof node.hiringOrganization?.sameAs === "string" ? node.hiringOrganization.sameAs : undefined,
        location, remote: node.jobLocationType === "TELECOMMUTE", employmentType: Array.isArray(node.employmentType) ? node.employmentType.join(" ") : node.employmentType,
        description: stripHtml(node.description || ""), url, applyUrl: url, postedAt: node.datePosted, deadline: node.validThrough,
        salary: sal?.minValue || sal?.maxValue || sal?.value ? { min: Number(sal.minValue ?? sal.value) || undefined, max: Number(sal.maxValue ?? sal.value) || undefined, currency: node.baseSalary?.currency, period: salaryPeriod(sal?.unitText || node.baseSalary?.unitText) } : undefined,
      });
      return;
    }
    if (node["@graph"]) visit(node["@graph"]);
    if (node.itemListElement) visit(node.itemListElement.map((i: any) => i?.item || i));
  };
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      visit(JSON.parse($(el).contents().text()));
    } catch {
      /* ignore malformed block */
    }
  }
  return out;
}

const JOB_LINK = /\/(jobs?|careers?|openings?|positions?|vacanc(y|ies)|requisitions?|opportunit(y|ies))\b[^#]*[-_/][^/#]{3,}/i;

/** Links on a careers listing page that look like individual job pages on the same site. */
export function jobLinksFromHtml(html: string, pageUrl: string, limit = 30): string[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const root = base.hostname.split(".").slice(-2).join(".");
  const seen = new Set<string>();
  for (const a of $("a[href]").toArray()) {
    try {
      const u = new URL($(a).attr("href")!, base);
      u.hash = "";
      if (!/^https?:$/.test(u.protocol) || !u.hostname.endsWith(root)) continue;
      const s = u.toString();
      if (s === base.toString() || !JOB_LINK.test(u.pathname)) continue;
      seen.add(s);
      if (seen.size >= limit) break;
    } catch {
      /* skip bad href */
    }
  }
  return [...seen];
}

const robotsCache = new Map<string, { at: number; disallow: string[] }>();

/** Minimal robots.txt check for the `*` user-agent group. Unreachable robots.txt = allowed (standard behaviour). */
export async function robotsAllows(url: string): Promise<boolean> {
  const u = new URL(url);
  let rules = robotsCache.get(u.origin);
  if (!rules || Date.now() - rules.at > 24 * 3600 * 1000) {
    const disallow: string[] = [];
    try {
      const txt = (await safeFetchText(`${u.origin}/robots.txt`, 200_000)).text;
      let applies = false;
      for (const line of txt.split(/\r?\n/)) {
        const [k, ...rest] = line.split(":");
        const key = k.trim().toLowerCase();
        const val = rest.join(":").trim();
        if (key === "user-agent") applies = val === "*";
        else if (applies && key === "disallow" && val) disallow.push(val);
      }
    } catch {
      /* no robots.txt */
    }
    rules = { at: Date.now(), disallow };
    robotsCache.set(u.origin, rules);
  }
  return !rules.disallow.some((d) => u.pathname.startsWith(d.replace(/\*.*$/, "")));
}

/** board = careers listing URL. Reads JSON-LD on the page itself, then on linked job pages (robots.txt respected). */
export async function fetchCareersPage(pageUrl: string, companyName?: string): Promise<RawJob[]> {
  if (!(await robotsAllows(pageUrl))) throw new Error("robots.txt disallows this careers page");
  const page = await safeFetchText(pageUrl);
  let jobs = jobPostingsFromHtml(page.text, page.url);
  if (jobs.length < 3) {
    const links = jobLinksFromHtml(page.text, page.url, Math.min(40, config.sources.maxJobsPerBoard));
    const pages = await mapLimit(links, 3, async (link) => {
      try {
        if (!(await robotsAllows(link))) return [];
        const p = await safeFetchText(link);
        return jobPostingsFromHtml(p.text, p.url);
      } catch {
        return [];
      }
    });
    jobs = [...jobs, ...pages.flat()];
  }
  const seen = new Set<string>();
  return jobs.filter((j) => (seen.has(j.sourceJobId) ? false : (seen.add(j.sourceJobId), true))).map((j) => ({ ...j, company: j.company || companyName || "", sourceName: `Careers page · ${companyName || j.company || j.sourceName}` }));
}
