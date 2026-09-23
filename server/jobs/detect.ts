// Works out which careers system a company uses from its careers URL (or the page's HTML), and the board id to fetch.
import { jobLinksFromHtml, jobPostingsFromHtml } from "./ats.js";
import { safeFetchText } from "./http.js";

export type AtsType = "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workday" | "oracle" | "recruitee" | "workable" | "teamtailor" | "careers_page";

export interface Detection {
  ats: AtsType | null;
  board: string;
  /** Set when we recognise the system but won't read it (e.g. it blocks automated access). */
  unsupported?: string;
  evidence: string;
}

type Rule = { re: RegExp; ats: AtsType; board: (m: RegExpMatchArray) => string };

const RULES: Rule[] = [
  { re: /boards-api\.greenhouse\.io\/v1\/boards\/([\w-]+)/i, ats: "greenhouse", board: (m) => m[1] },
  { re: /(?:job-)?boards(?:\.eu)?\.greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([\w-]+)/i, ats: "greenhouse", board: (m) => m[1] },
  { re: /(?:job-)?boards(?:\.eu)?\.greenhouse\.io\/([\w-]+)/i, ats: "greenhouse", board: (m) => m[1] },
  { re: /api\.lever\.co\/v0\/postings\/([\w-]+)/i, ats: "lever", board: (m) => m[1] },
  { re: /jobs\.lever\.co\/([\w-]+)/i, ats: "lever", board: (m) => m[1] },
  { re: /api\.ashbyhq\.com\/posting-api\/job-board\/([\w.-]+)/i, ats: "ashby", board: (m) => m[1] },
  { re: /jobs\.ashbyhq\.com\/([\w.-]+)/i, ats: "ashby", board: (m) => m[1] },
  { re: /api\.smartrecruiters\.com\/v1\/companies\/([\w-]+)/i, ats: "smartrecruiters", board: (m) => m[1] },
  { re: /(?:jobs|careers)\.smartrecruiters\.com\/([\w-]+)/i, ats: "smartrecruiters", board: (m) => m[1] },
  { re: /([\w-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:wday\/cxs\/[\w-]+\/)?(?:[a-z]{2}-[A-Z]{2}\/)?([\w-]+)/, ats: "workday", board: (m) => `${m[1].toLowerCase()}|${m[2]}|${m[3]}` },
  { re: /([\w.-]+\.oraclecloud\.com)\/hcmUI\/CandidateExperience\/[a-z]{2}(?:-[A-Z]{2})?\/sites\/([\w-]+)/, ats: "oracle", board: (m) => `${m[1]}|${m[2]}` },
  { re: /([\w-]+)\.recruitee\.com/i, ats: "recruitee", board: (m) => m[1].toLowerCase() },
  { re: /([\w-]+\.teamtailor\.com)/i, ats: "teamtailor", board: (m) => m[1].toLowerCase() },
  { re: /apply\.workable\.com\/(?:api\/v\d\/widget\/accounts\/)?([\w-]+)/i, ats: "workable", board: (m) => m[1] },
];

// Known systems we deliberately don't read automatically.
const UNSUPPORTED: Array<[RegExp, string]> = [
  [/\.darwinbox\.(in|com)/i, "Darwinbox blocks automated access; users can still add these jobs by link"],
  [/linkedin\.com\/jobs|naukri\.com|indeed\.(com|co\.in)|foundit\.in|shine\.com|glassdoor\./i, "Job portals don't permit automated collection; users can add these jobs by link"],
];

const IGNORED_SLUGS = new Set(["embed", "api", "v0", "v1", "jobs", "job", "careers", "en", "wday", "static"]);

/** Pure URL/text pattern detection — no network. */
export function detectFromText(text: string): Detection | null {
  for (const [re, why] of UNSUPPORTED) if (re.test(text)) return { ats: null, board: "", unsupported: why, evidence: text.match(re)![0] };
  for (const r of RULES) {
    const m = text.match(r.re);
    if (m && !IGNORED_SLUGS.has(m[1].toLowerCase())) return { ats: r.ats, board: r.board(m), evidence: m[0] };
  }
  return null;
}

/** Full detection: URL patterns → embedded ATS links/iframes in the page → schema.org JobPosting data → nothing. */
export async function detectAts(careersUrl: string): Promise<Detection> {
  const direct = detectFromText(careersUrl);
  if (direct) return direct;
  const page = await safeFetchText(careersUrl);
  const fromFinal = detectFromText(page.url);
  if (fromFinal) return { ...fromFinal, evidence: `redirected to ${page.url}` };
  const embedded = detectFromText(page.text);
  if (embedded) return { ...embedded, evidence: `page embeds ${embedded.evidence}` };
  if (jobPostingsFromHtml(page.text, page.url).length) return { ats: "careers_page", board: page.url, evidence: "page publishes schema.org JobPosting data" };
  // Follow a few job-looking links: they often lead to the real ATS, or to pages carrying JobPosting data.
  for (const link of jobLinksFromHtml(page.text, page.url, 3)) {
    const byUrl = detectFromText(link);
    if (byUrl?.ats) return { ...byUrl, evidence: `linked job page ${link}` };
    try {
      const sub = await safeFetchText(link);
      const inner = detectFromText(sub.url) || detectFromText(sub.text);
      if (inner?.ats) return { ...inner, evidence: `linked page embeds ${inner.evidence}` };
      if (jobPostingsFromHtml(sub.text, sub.url).length) return { ats: "careers_page", board: page.url, evidence: "linked job pages publish schema.org JobPosting data" };
    } catch {
      /* try the next link */
    }
  }
  return { ats: null, board: "", evidence: "no known careers system or job data found on the page" };
}
