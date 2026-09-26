// Reads forwarded job-alert emails (Naukri, LinkedIn, Indeed, Foundit, Instahyre and generic alerts) into job records.
// Rules first; an AI fallback only for alert-looking emails the rules couldn't read, and it can only return links that
// really appear in the email (so a crafted email can't make us open arbitrary addresses).
import * as cheerio from "cheerio";
import { z } from "zod";
import { generateJSON } from "../ai/gateway.js";
import { parseLocation } from "../nlp/location.js";
import { UNTRUSTED_NOTICE, fenceUntrusted } from "../nlp/text.js";

export interface ParsedAlertJob { title: string; company: string; location: string; url: string; snippet: string; portal: string }
export interface ParsedEmail {
  kind: "verification" | "alerts" | "empty";
  portal?: string;
  jobs: ParsedAlertJob[];
  verification?: { code?: string; link?: string };
}
export interface InboundMail { from: string; subject: string; text: string; html: string }

interface Portal { id: string; name: string; from: RegExp; host: RegExp }
export const PORTALS: Portal[] = [
  { id: "naukri", name: "Naukri", from: /naukri/i, host: /(^|\.)naukri\.com$/i },
  { id: "linkedin", name: "LinkedIn", from: /linkedin/i, host: /(^|\.)linkedin\.com$/i },
  { id: "indeed", name: "Indeed", from: /indeed/i, host: /(^|\.)indeed\.com$/i },
  { id: "foundit", name: "Foundit", from: /foundit|monster/i, host: /(^|\.)(foundit\.in|monsterindia\.com)$/i },
  { id: "instahyre", name: "Instahyre", from: /instahyre/i, host: /(^|\.)instahyre\.com$/i },
];

const JOB_PATH = /(job-listings|\/jobs?\/|\/job\/|viewjob|\/rc\/clk|jk=|\/opportunit|\/vacanc|\/careers?\/|\/apply)/i;
const NOT_A_JOB = /\b(unsubscribe|view all|see all|more jobs|manage|settings|preferences|privacy|terms|help|feedback|download|app store|google play|update (your )?(profile|resume)|create alert|edit alert|search jobs|browse|login|sign in|apply now|view job|see (job|details))\b/i;
const TITLE_WORDS = /\b(manager|engineer|developer|lead|analyst|architect|consultant|director|head|specialist|executive|officer|administrator|designer|scientist|associate|intern|trainee|coordinator|programmer|tester|owner|supervisor|assistant|technician|operator|driver|executive|representative|accountant|nurse|teacher|recruiter|sales|support|advisor|agent|clerk|cashier|delivery|manager)\b/i;
const META_LINE = /\b(yrs?|years?|lpa|lacs?|lakhs?|₹|rs\.?|ctc|ago|posted|apply|easy apply|be an early applicant|actively hiring|full[- ]?time|part[- ]?time|hours? ago|days? ago|new)\b/i;

const clean = (s: string) => s.replace(/[\s ]+/g, " ").trim();
const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ""; } };
const portalOfUrl = (u: string) => PORTALS.find((p) => p.host.test(hostOf(u)));
const validUrl = (u: string) => /^https?:\/\//i.test(u);

export function parseVerification(mail: InboundMail): ParsedEmail["verification"] | null {
  const body = `${mail.subject}\n${mail.text}\n${mail.html.replace(/<[^>]+>/g, " ")}`;
  const isGmail = /forwarding-noreply@google\.com/i.test(mail.from) || /gmail forwarding confirmation/i.test(mail.subject);
  const isOutlook = /forwarding|verify.*(email|address)/i.test(mail.subject) && /outlook|microsoft|yahoo|zoho/i.test(mail.from);
  if (!isGmail && !isOutlook) return null;
  const code = /\b(\d{6,9})\b/.exec(body)?.[1];
  const link = (mail.text.match(/https:\/\/mail-settings\.google\.com\/[^\s>"]+/) || mail.html.match(/https:\/\/mail-settings\.google\.com\/[^\s>"'<]+/) || [])[0];
  return { code, link: link?.replace(/&amp;/g, "&") };
}

/** All text nodes under an element, one per line, so "Title / Company / City / 3-5 yrs" comes out as separate lines. */
function linesOf($: cheerio.CheerioAPI, el: any): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n.type === "text") { const t = clean(n.data || ""); if (t) out.push(t); }
    else if (n.children) n.children.forEach(walk);
  };
  walk(el);
  return out;
}

/** The smallest surrounding element that holds only this one job (stop before it would swallow a neighbouring job). */
function blockFor($: cheerio.CheerioAPI, a: any) {
  const jobLinks = (el: cheerio.Cheerio<any>) => el.find("a[href]").filter((_, x) => {
    const h = ($(x).attr("href") || "").trim(), t = clean($(x).text());
    return t.length >= 4 && !NOT_A_JOB.test(t) && (Boolean(portalOfUrl(h)) || JOB_PATH.test(h));
  }).length;
  let block = $(a);
  for (let i = 0; i < 6; i++) {
    const parent = block.parent();
    if (!parent.length || clean(parent.text()).length > 420 || jobLinks(parent) > 1) break;
    block = parent;
  }
  return block;
}

const looksLikeLocation = (s: string) => { const l = parseLocation(s); return l.cities.length > 0 || l.remote || l.panIndia || l.india; };

function fromBlock(lines: string[], title: string): { company: string; location: string; snippet: string } {
  const rest = lines.filter((l) => l !== title && !NOT_A_JOB.test(l));
  const location = rest.find((l) => l.length <= 90 && looksLikeLocation(l)) || "";
  const company = rest.find((l) => l !== location && l.length >= 2 && l.length <= 80 && !META_LINE.test(l) && !looksLikeLocation(l)) || "";
  return { company, location, snippet: rest.filter((l) => l !== company && l !== location).join(" · ").slice(0, 400) };
}

function senderName(from: string): string {
  const name = /^"?([^"<]+?)"?\s*</.exec(from)?.[1]?.replace(/\b(careers?|jobs?|hiring|talent|recruit(ment|ing)?|alerts?|no-?reply|team|hr)\b/gi, "").replace(/\s+/g, " ").trim();
  return name && name.length > 1 && name.length < 60 ? name : "";
}

function fromHtml(mail: InboundMail): ParsedAlertJob[] {
  const $ = cheerio.load(mail.html);
  $("script,style").remove();
  const sender = PORTALS.find((p) => p.from.test(mail.from));
  const fallbackCompany = senderName(mail.from);
  const out: ParsedAlertJob[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, a) => {
    const href = ($(a).attr("href") || "").replace(/&amp;/g, "&").trim();
    const title = clean($(a).text());
    if (!validUrl(href) || title.length < 4 || title.length > 120 || NOT_A_JOB.test(title)) return;
    const portal = portalOfUrl(href) || (sender && /click|track|redirect|url\?|ls\/click|e\//i.test(href) ? sender : undefined);
    const generic = !portal && JOB_PATH.test(href) && TITLE_WORDS.test(title);
    if (!portal && !generic) return;
    if (portal && !JOB_PATH.test(href) && !TITLE_WORDS.test(title)) return;
    const key = `${title.toLowerCase()}|${href.split("?")[0]}`;
    if (seen.has(key)) return;
    const meta = fromBlock(linesOf($, blockFor($, a)[0]), title);
    const company = meta.company || fallbackCompany;
    if (!company) return;
    seen.add(key);
    out.push({ title, company, location: meta.location, url: href, snippet: meta.snippet, portal: portal?.name || "Job alert" });
  });
  return out;
}

function fromText(mail: InboundMail): ParsedAlertJob[] {
  const lines = mail.text.split(/\r?\n/).map(clean);
  const sender = PORTALS.find((p) => p.from.test(mail.from));
  const out: ParsedAlertJob[] = [];
  lines.forEach((line, i) => {
    const url = /https?:\/\/\S+/.exec(line)?.[0]?.replace(/[)>.,]+$/, "");
    if (!url || !(portalOfUrl(url) || sender) || !JOB_PATH.test(url)) return;
    const around = lines.slice(Math.max(0, i - 4), i).filter((l) => l && !/https?:\/\//.test(l) && !NOT_A_JOB.test(l));
    const title = [...around].reverse().find((l) => TITLE_WORDS.test(l) && l.length <= 120);
    if (!title) return;
    const meta = fromBlock(around, title);
    const company = meta.company || senderName(mail.from);
    if (company) out.push({ title, company, location: meta.location, url, snippet: meta.snippet, portal: (portalOfUrl(url) || sender)?.name || "Job alert" });
  });
  return out;
}

const AiJobs = z.object({ jobs: z.array(z.object({ title: z.string().min(3).max(120), company: z.string().min(2).max(80), location: z.string().max(80).catch(""), url: z.string().max(600) })).max(15) });

/** Only for emails that look like job alerts but had no readable structure. URLs must already exist in the email. */
async function aiFallback(uid: string, mail: InboundMail): Promise<ParsedAlertJob[]> {
  if (!/\b(jobs?|openings?|vacanc|hiring|alert|recommended)\b/i.test(mail.subject)) return [];
  const known = new Set((`${mail.text} ${mail.html}`.match(/https?:\/\/[^\s"'<>)]+/g) || []).map((u) => u.replace(/&amp;/g, "&")));
  try {
    const r = await generateJSON({
      task: "job_analyze", uid, schema: AiJobs, maxTokens: 2500, cache: false,
      system: `You extract job listings from job-alert emails. ${UNTRUSTED_NOTICE}`,
      prompt: `List every job in this email as {"jobs":[{"title","company","location","url"}]}. The url MUST be copied exactly from the email. Do not invent jobs.\n${fenceUntrusted("email", `${mail.subject}\n${mail.text || mail.html.replace(/<[^>]+>/g, " ")}`, 9000)}`,
    });
    return r.jobs.filter((j) => known.has(j.url) && validUrl(j.url)).map((j) => ({ ...j, snippet: "", portal: portalOfUrl(j.url)?.name || "Job alert" }));
  } catch { return []; }
}

export async function parseAlertEmail(uid: string, mail: InboundMail): Promise<ParsedEmail> {
  const verification = parseVerification(mail);
  if (verification) return { kind: "verification", jobs: [], verification };
  let jobs = mail.html ? fromHtml(mail) : [];
  if (!jobs.length) jobs = fromText(mail);
  if (!jobs.length) jobs = await aiFallback(uid, mail);
  const seen = new Set<string>();
  jobs = jobs.filter((j) => (seen.has(j.url) ? false : (seen.add(j.url), true))).slice(0, 25);
  return { kind: jobs.length ? "alerts" : "empty", portal: jobs[0]?.portal, jobs };
}
