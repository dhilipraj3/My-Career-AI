import crypto from "node:crypto";
import type { EmploymentType, Job, JobFreshness, WorkMode } from "../../shared/types.js";
import type { JobCategory } from "../../shared/types.js";
import { detectSeniority, extractSkillKeys, normalizeTitle } from "../nlp/skills.js";
import { FRONTLINE, classifyCategory, freshersWelcome, minimumEducation } from "./classify.js";
import { parseLocation } from "../nlp/location.js";
import { stripHtml } from "../nlp/text.js";

export interface RawJob {
  connector: string;
  sourceName: string;
  sourceJobId: string;
  title: string;
  company: string;
  companyUrl?: string;
  location?: string;
  remote?: boolean;
  workplace?: string;
  employmentType?: string;
  description: string; // HTML or text
  url: string;
  applyUrl?: string;
  postedAt?: string | number;
  updatedAt?: string | number;
  deadline?: string | number;
  salaryText?: string;
  salary?: { min?: number; max?: number; currency?: string; period?: "year" | "month" | "day" | "hour" };
  industry?: string;
}

const LEGAL_SUFFIX = /\b(pvt|private|ltd|limited|llp|llc|inc|incorporated|corp|corporation|co|gmbh|plc|technologies|technology|india|software|services|solutions)\b\.?/g;

export function companyKey(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").replace(LEGAL_SUFFIX, " ").replace(/\s+/g, " ").trim();
}

export const sha = (s: string, n = 16) => crypto.createHash("sha1").update(s).digest("hex").slice(0, n);

export function dedupeKeyFor(company: string, title: string, city: string, remote: boolean): string {
  return `${companyKey(company)}|${normalizeTitle(title)}|${remote ? "remote" : city.toLowerCase()}`;
}

function toIso(v: string | number | undefined): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function workMode(loc: { remote: boolean }, raw: RawJob, text: string): WorkMode {
  const hint = `${raw.workplace || ""} ${raw.location || ""}`.toLowerCase();
  // Structured fields (workplace type, location, remote flag) outrank a passing mention in the description:
  // a remote role whose text says "we also have hybrid teams" is still remote.
  if (/hybrid/.test(hint)) return "hybrid";
  if (loc.remote || raw.remote || /remote|work from home|anywhere/.test(hint)) return "remote";
  if (/\bhybrid\b/.test(text.slice(0, 1500).toLowerCase())) return "hybrid";
  // A city alone doesn't say the role is on-site (ATS boards rarely state it), so only say "onsite" when the posting does.
  if (/on-?site|in-?office|work from office|office[- ]based/.test(`${hint} ${text.slice(0, 2500).toLowerCase()}`)) return "onsite";
  return "unknown";
}

function employmentType(raw: RawJob, title: string): EmploymentType {
  const t = `${raw.employmentType || ""} ${title}`.toLowerCase();
  if (/intern/.test(t)) return "internship";
  if (/contract|freelance|temporary|c2h/.test(t)) return "contract";
  if (/part[- ]?time/.test(t)) return "part_time";
  if (/full[- ]?time|permanent|regular/.test(t) || raw.employmentType) return "full_time";
  return "full_time";
}

export function parseExperienceRange(text: string): { min?: number; max?: number } {
  const t = text.toLowerCase();
  const range = t.match(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/);
  if (range) return { min: +range[1], max: +range[2] };
  const plus = t.match(/(?:minimum|min\.?|at least|over)?\s*(\d{1,2})\s*\+\s*(?:years?|yrs?)/) || t.match(/(?:minimum|min\.?|at least)\s*(?:of\s*)?(\d{1,2})\s*(?:years?|yrs?)/);
  if (plus) return { min: +plus[1] };
  const plain = t.match(/(\d{1,2})\s*(?:years?|yrs?)\s*(?:of\s*)?(?:relevant\s*|professional\s*|work\s*)?experience/);
  if (plain) return { min: +plain[1] };
  return {};
}

export type SalaryPeriod = "year" | "month" | "day" | "hour";

export interface ParsedSalary {
  minLpa?: number; // annualised, lakhs per annum — the one unit matching compares on
  maxLpa?: number;
  currency: string;
  period?: SalaryPeriod; // how the posting quoted it
  display?: string; // in the posting's own terms
}

const WORK_DAYS_PER_MONTH = 26;
const round1 = (n: number) => Math.round(n * 10) / 10;
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

/** Rupees per `period` → lakhs per annum. */
export function annualLpa(rupees: number, period: SalaryPeriod): number {
  const perYear = period === "year" ? rupees : period === "month" ? rupees * 12 : period === "day" ? rupees * WORK_DAYS_PER_MONTH * 12 : rupees * 8 * WORK_DAYS_PER_MONTH * 12;
  return round1(perYear / 100000);
}

/** A bare INR number with no stated period: tell LPA / monthly / annual apart by magnitude. */
function inferInr(v: number): { rupees: number; period: SalaryPeriod } | { lpa: number } | null {
  if (v > 0 && v < 200) return { lpa: v }; // "12" in a salary field is LPA
  if (v >= 5000 && v < 100000) return { rupees: v, period: "month" }; // no full-time job pays under ₹1 lakh a year
  if (v >= 100000) return { rupees: v, period: "year" };
  return null;
}

function displayFor(min: number | undefined, max: number | undefined, period: SalaryPeriod | undefined, lpa: boolean, inHand: boolean): string | undefined {
  if (min === undefined && max === undefined) return undefined;
  const range = min !== undefined && max !== undefined && min !== max ? `${lpa ? min : inr(min)}–${lpa ? max : inr(max)}` : `${lpa ? (min ?? max) : inr((min ?? max)!)}`;
  const suffix = lpa ? " LPA" : period === "month" ? "/month" : period === "day" ? "/day" : period === "hour" ? "/hour" : "/year";
  return `₹${range}${suffix}${inHand ? " (in-hand)" : ""}`;
}

const NUM = String.raw`(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)\s*(k)?`;
const PERIOD_WORDS: Array<[SalaryPeriod, string]> = [
  ["month", String.raw`(?:\/|per|a|p\.?)\s*(?:month|mon|mo\b|m\b)|\s*pm\b|\s*monthly|\s*per month`],
  ["day", String.raw`(?:\/|per|a)\s*day|\s*daily|\s*per day`],
  ["hour", String.raw`(?:\/|per|an?)\s*(?:hour|hr)\b`],
];
const toNum = (s: string, k?: string) => Number(s.replace(/,/g, "")) * (k ? 1000 : 1);

export function parseSalary(raw: RawJob, text: string): ParsedSalary {
  const src = `${raw.salaryText || ""} ${text.slice(0, 4000)}`;
  const inHand = /\b(in[- ]?hand|take[- ]?home)\b/i.test(src);
  if (raw.salary && (raw.salary.min || raw.salary.max)) {
    const cur = (raw.salary.currency || "INR").toUpperCase();
    if (cur !== "INR") return { currency: cur };
    const vals = [raw.salary.min, raw.salary.max].map((v) => (v ? Number(v) : undefined));
    if (raw.salary.period) {
      const [lo, hi] = vals;
      return { minLpa: lo ? annualLpa(lo, raw.salary.period) : undefined, maxLpa: hi ? annualLpa(hi, raw.salary.period) : lo ? annualLpa(lo, raw.salary.period) : undefined, currency: "INR", period: raw.salary.period, display: displayFor(lo, hi, raw.salary.period, false, inHand) };
    }
    const inferred = vals.map((v) => (v === undefined ? null : inferInr(v)));
    const lpaOf = (x: ReturnType<typeof inferInr>) => (!x ? undefined : "lpa" in x ? x.lpa : annualLpa(x.rupees, x.period));
    const lo = lpaOf(inferred[0]);
    const hi = lpaOf(inferred[1]) ?? lo;
    const first = inferred.find(Boolean);
    const period = first && "period" in first ? first.period : "year";
    const asLpa = !first || "lpa" in first || period === "year";
    return { minLpa: lo, maxLpa: hi, currency: "INR", period, display: asLpa ? displayFor(lo, hi === lo ? undefined : hi, "year", true, inHand) : displayFor(vals[0], vals[1], period, false, inHand) };
  }

  // 1) Lakhs: "12-18 LPA", "₹8 lakhs per annum", "10 to 14 L"
  const lpa = src.match(/(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:\.\d+)?)\s*(?:-|–|to)\s*(\d{1,3}(?:\.\d+)?)\s*(?:lpa|lakhs?|lacs?|l\b)/i) || src.match(/(\d{1,3}(?:\.\d+)?)\s*()(?:lpa|lakhs? per annum)/i);
  if (lpa) {
    const lo = +lpa[1], hi = lpa[2] ? +lpa[2] : +lpa[1];
    return { minLpa: lo, maxLpa: hi, currency: "INR", period: "year", display: displayFor(lo, hi, "year", true, inHand) };
  }
  // 2) Per month / day / hour: "₹15,000 - ₹20,000 per month", "18k-22k/month", "₹650 per day"
  for (const [period, words] of PERIOD_WORDS) {
    const range = new RegExp(String.raw`(?:₹|rs\.?|inr)\s*${NUM}\s*(?:-|–|to)\s*(?:₹|rs\.?|inr)?\s*${NUM}\s*(?:${words})`, "i").exec(src)
      || new RegExp(String.raw`${NUM}\s*(?:-|–|to)\s*${NUM}\s*(?:${words})`, "i").exec(src);
    if (range) {
      const lo = toNum(range[1], range[2]), hi = toNum(range[3], range[4]);
      if (lo >= 100 && hi >= lo) return { minLpa: annualLpa(lo, period), maxLpa: annualLpa(hi, period), currency: "INR", period, display: displayFor(lo, hi, period, false, inHand) };
    }
    const single = new RegExp(String.raw`(?:₹|rs\.?|inr)\s*${NUM}\s*(?:${words})`, "i").exec(src);
    if (single) {
      const v = toNum(single[1], single[2]);
      if (v >= 100) return { minLpa: annualLpa(v, period), maxLpa: annualLpa(v, period), currency: "INR", period, display: displayFor(v, v, period, false, inHand) };
    }
  }
  // 3) Annual rupees: "₹6,00,000 - ₹9,00,000"
  const ann = src.match(/(?:₹|inr|rs\.?)\s*([\d,]{6,9})\s*(?:-|–|to)\s*(?:₹|inr|rs\.?)?\s*([\d,]{6,9})/i);
  if (ann) {
    const lo = +ann[1].replace(/,/g, ""), hi = +ann[2].replace(/,/g, "");
    if (lo >= 100000) return { minLpa: annualLpa(lo, "year"), maxLpa: annualLpa(hi, "year"), currency: "INR", period: "year", display: displayFor(annualLpa(lo, "year"), annualLpa(hi, "year"), "year", true, inHand) };
  }
  // 4) Labelled but period-less: "Salary: 15,000 - 20,000", "Stipend ₹10,000"
  const labelled = new RegExp(String.raw`\b(?:salary|stipend|ctc|pay)\b[^\d₹\n]{0,20}(?:₹|rs\.?|inr)?\s*${NUM}(?:\s*(?:-|–|to)\s*(?:₹|rs\.?|inr)?\s*${NUM})?`, "i").exec(src);
  if (labelled) {
    const lo = toNum(labelled[1], labelled[2]);
    const hi = labelled[3] ? toNum(labelled[3], labelled[4]) : lo;
    const x = inferInr(lo);
    if (x && "rupees" in x && hi >= lo) return { minLpa: annualLpa(lo, x.period), maxLpa: annualLpa(hi, x.period), currency: "INR", period: x.period, display: displayFor(lo, hi, x.period, false, inHand) };
  }
  return { currency: /\$|usd/i.test(src) ? "USD" : "INR" };
}

// These describe the CANDIDATE being asked to pay, or WhatsApp/Telegram being the way to apply. Job duties that mention
// a "processing fee" (lending roles) or "reach out on WhatsApp" (marketing roles) are normal work, not scams.
const FEE_KIND = String.raw`(registration|processing|training|joining|kit|uniform|id card|documentation|onboarding|verification|interview)`;
const MONEY = String.raw`(₹|rs\.?|inr)\s*\d`;
const SPAM_PHRASES = [
  new RegExp(String.raw`\b${FEE_KIND}\s+(fee|fees|charges?|amount)\b[^.\n]{0,40}(${MONEY}|refundable)`
    + String.raw`|\b(pay|deposit|submit)\b[^.\n]{0,25}\b(${FEE_KIND}|security)\s+(fee|fees|charges?|deposit|amount)\b`
    + String.raw`|\b(refundable|security) deposit\b[^.\n]{0,40}${MONEY}`
    + String.raw`|\bpay (for|to get) (the )?(training|job|offer|joining)\b`, "i"),
  /\b(apply|send|share|whatsapp|forward)\b[^.\n]{0,20}\b(your )?(cv|resume|bio ?data)\b[^.\n]{0,30}\b(whatsapp|telegram)\b|\b(whatsapp|telegram)\b[^.\n]{0,25}(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b|\b(contact|call|message|msg|dm|ping)\s+(us\s+|hr\s+|me\s+)?(on|via|at)\s+(whatsapp|telegram)\b/i,
  /earn (up to )?₹?\s*\d+[\d,]*\s*(per|a|\/)\s*(day|week)/i,
  /no interview|guaranteed (job|placement)|100% placement/i,
  /work from home.*(typing|data entry).*(₹|rs)/i,
  /(earn|income|salary) (of )?₹?\s*\d[\d,]*\s*(per|a|\/)\s*week|daily payment|instant payment|part[- ]time.*(₹|rs)\s*\d[\d,]*\s*(per|\/)\s*(hour|day)/i,
];
const SHORTENERS = /(bit\.ly|tinyurl|t\.co|goo\.gl|cutt\.ly|rb\.gy|is\.gd)\b/i;
// Legitimate employers publish anti-fraud notices ("we will never ask you to pay a fee"); those are not spam.
const NEGATION_NEAR = /\b(never|not|n't|don'?t|won'?t|beware|scam|fraud|phishing|impersonat|do not|will not|no\s+fee)\b/i;

export function hasSpamLanguage(text: string): boolean {
  for (const re of SPAM_PHRASES) {
    const g = new RegExp(re.source, "gi");
    for (let m = g.exec(text); m; m = g.exec(text)) {
      const context = text.slice(Math.max(0, m.index - 90), m.index + m[0].length + 20);
      if (!NEGATION_NEAR.test(context)) return true;
    }
  }
  return false;
}

export function assessQuality(j: Pick<Job, "title" | "company" | "description" | "sources" | "salaryMinLPA" | "salaryMaxLPA" | "currency" | "employmentType"> & { category?: JobCategory }): Job["quality"] {
  const flags: string[] = [];
  let strong = 0;
  if (!j.title.trim()) flags.push("missing_title");
  if (!j.company.trim() || /^(confidential|unknown|hidden)/i.test(j.company)) flags.push("missing_company");
  if (j.description.length < 200) flags.push("short_description");
  if (!j.sources.some((s) => s.applyUrl || s.sourceUrl)) flags.push("no_apply_url");
  if (hasSpamLanguage(`${j.title}\n${j.description}`)) { flags.push("spam_language"); strong++; }
  if (j.sources.some((s) => SHORTENERS.test(s.applyUrl) || SHORTENERS.test(s.sourceUrl))) { flags.push("shortened_url"); strong++; }
  if (j.currency === "INR" && j.employmentType === "full_time" && ((j.salaryMaxLPA && j.salaryMaxLPA > 600) || (j.salaryMinLPA !== undefined && j.salaryMinLPA > 0 && j.salaryMinLPA < 0.5)
    // Frontline roles advertised far above market are classic bait ("₹80,000/month data entry").
    || (j.category && FRONTLINE.includes(j.category) && j.salaryMaxLPA !== undefined && j.salaryMaxLPA > 15)))
    flags.push("unrealistic_salary");
  const emails = j.description.match(/[a-z0-9._%+-]+@(gmail|yahoo|hotmail|outlook)\.[a-z]+/i);
  if (emails) flags.push("personal_email_contact");
  const score = Math.max(0, 100 - flags.length * 15 - strong * 25);
  return { score, flags, suspicious: strong > 0 || flags.length >= 3 };
}

export type Rejected = { reason: string };

/**
 * Careers systems often leak internal codes into titles: "IN_RBIN_ Senior Engineer", "Staff Engineer_Fusion Adapters".
 * Drop leading/trailing ALL-CAPS codes joined by underscores and turn the remaining underscores into " - ".
 */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/^(?:[A-Z0-9]{2,6}_\s*)+/, "")
    .replace(/(?:\s*_[A-Z0-9]{2,6})+$/, "")
    .replace(/\s*_\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Turns a raw connector record into the canonical shape. Returns a rejection reason if it must not enter the system. */
export function normalizeRaw(raw: RawJob, now = new Date()): { job: Job } | Rejected {
  const title = cleanTitle(stripHtml(raw.title)).slice(0, 160);
  const company = stripHtml(raw.company).replace(/\s+/g, " ").trim().slice(0, 120);
  const description = stripHtml(raw.description).slice(0, 20000);
  if (!title) return { reason: "missing_title" };
  if (!company) return { reason: "missing_company" };
  if (description.length < 60) return { reason: "missing_description" };
  const link = raw.applyUrl || raw.url;
  // A job the user pasted as text may legitimately have no URL; connector jobs must.
  if (raw.connector !== "user_manual" && (!link || !/^https?:\/\//i.test(link))) return { reason: "missing_url" };

  const loc = parseLocation(raw.location || "", raw.remote);
  const mode = workMode(loc, raw, description);
  const exp = parseExperienceRange(`${title} ${description}`);
  const sal = parseSalary(raw, description);
  const category = classifyCategory(title, description);
  const nowIso = now.toISOString();
  const skills = extractSkillKeys(`${title}\n${description}`);
  const key = dedupeKeyFor(company, title, loc.city, mode === "remote");
  const et = employmentType(raw, title);

  const partial = {
    title, company, description,
    sources: [{ connector: raw.connector, sourceName: raw.sourceName, sourceJobId: String(raw.sourceJobId), sourceUrl: raw.url, applyUrl: link, seenAt: nowIso }],
    salaryMinLPA: sal.minLpa, salaryMaxLPA: sal.maxLpa, currency: sal.currency, employmentType: et, category,
  };
  const job: Job = {
    // Stable id from the first source's own identifier; later duplicates merge into it (see ingest.sameOpportunity).
    id: `job_${sha(`${raw.connector}|${raw.sourceJobId}`, 18)}`,
    title, normalizedTitle: normalizeTitle(title), company, companyKey: companyKey(company), companyUrl: raw.companyUrl,
    location: (raw.location || (mode === "remote" ? "Remote" : "")).slice(0, 120), city: loc.city, country: loc.country || (mode === "remote" ? "" : ""),
    workMode: mode, employmentType: et, experienceMin: exp.min, experienceMax: exp.max,
    salaryMinLPA: sal.minLpa, salaryMaxLPA: sal.maxLpa, currency: sal.currency, salaryPeriod: sal.period, salaryDisplay: sal.display,
    cities: loc.cities.length ? loc.cities : undefined, state: loc.state || undefined, panIndia: loc.panIndia || undefined,
    category, education: minimumEducation(description), freshersWelcome: freshersWelcome(title, description, exp.min),
    skills, description, industry: raw.industry, seniority: detectSeniority(title),
    postedAt: toIso(raw.postedAt), updatedAtSource: toIso(raw.updatedAt), lastVerifiedAt: nowIso, firstSeenAt: nowIso, deadline: toIso(raw.deadline),
    status: "new", sources: partial.sources, dedupeKey: key, quality: assessQuality(partial),
  };
  return { job };
}

export function isRejected(x: { job: Job } | Rejected): x is Rejected {
  return "reason" in x;
}

const DAY = 24 * 3600 * 1000;

/** Freshness state machine (scope §20). `lastVerifiedAt` = last time a source still listed the job. */
export function computeFreshness(job: Pick<Job, "lastVerifiedAt" | "firstSeenAt" | "deadline" | "status" | "postedAt">, now = Date.now()): JobFreshness {
  if (job.status === "closed") return "closed";
  if (job.deadline && new Date(job.deadline).getTime() < now) return "expired";
  const since = now - new Date(job.lastVerifiedAt).getTime();
  const sinceFirst = now - new Date(job.firstSeenAt).getTime();
  let s: JobFreshness;
  if (since > 14 * DAY) s = "expired";
  else if (since > 7 * DAY) s = "potentially_expired";
  else if (since > 3 * DAY) s = "stale";
  else if (since <= DAY) s = sinceFirst <= 2 * DAY ? "new" : "recently_verified";
  else s = "active";
  const posted = job.postedAt ? now - new Date(job.postedAt).getTime() : 0;
  if (posted > 120 * DAY && (s === "new" || s === "active" || s === "recently_verified")) s = "stale";
  return s;
}

export const RECOMMENDABLE: JobFreshness[] = ["new", "active", "recently_verified", "stale"];
