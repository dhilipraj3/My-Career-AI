import { journeyFor } from "../companion/service.js";
import { experienceText, wholeYears } from "../../shared/format.js";
import crypto from "node:crypto";
import { z } from "zod";
import type { CandidateProfile, ChatMessage, ChatStep, PendingAction } from "../../shared/types.js";
import { AiQuotaError, AiUnavailableError, aiAvailable, aiStatus, generateJSON } from "../ai/gateway.js";
import { getUserKey } from "../ai/keys.js";
import { AppError, getJobForUser } from "../applications/service.js";
import { audit } from "../audit.js";
import { getStore } from "../db/store.js";
import { feedSummary } from "../matching/feed.js";
import { findIndianCities } from "../nlp/location.js";
import { UNTRUSTED_NOTICE } from "../nlp/text.js";
import { parsePreferenceText } from "../profile/preferences.js";
import { getProfile, restorePreferences } from "../profile/service.js";
import { matchCandidate } from "../matching/service.js";
import { TOOL_MAP, toolCatalog, type AppPage, type ToolContext, type ToolResult } from "./tools.js";

const MAX_STEPS = 5;
const MAX_MODIFY_PER_TURN = 3;
const PENDING_TTL_MS = 15 * 60 * 1000;

export interface AgentReply {
  id: string;
  reply: string;
  suggestions: string[];
  cards: NonNullable<ChatMessage["cards"]>;
  /** What the assistant actually did this turn, in order (shown as a compact activity line). */
  steps: ChatStep[];
  /** Changes made this turn that the user can undo. */
  changes: NonNullable<ChatMessage["changes"]>;
  pendingAction?: PendingAction;
  openUrl?: string;
  navigate?: AppPage;
  mode: "ai" | "basic";
  /** Why the assistant is in basic mode, so the UI can say it plainly. */
  basicReason?: BasicReason;
}

export type BasicReason = "no_ai" | "busy" | "quota";

/** Live progress for streaming clients. */
export type AgentEvent =
  | { type: "step"; step: ChatStep }
  | { type: "delta"; text: string }
  | { type: "reset" };

export interface ChatContext {
  page?: string;
  jobId?: string;
}

export interface RunOptions {
  context?: ChatContext;
  onEvent?: (e: AgentEvent) => void;
  /** Set when the client disconnected or pressed Stop: no further steps are taken. */
  signal?: AbortSignal;
}

const BASIC_REASON_TEXT: Record<BasicReason, string> = {
  no_ai: "I can't chat freely yet, but I can help with a lot:",
  busy: "My smart chat is busy for a moment, but I can still help with:",
  quota: "Today's free AI credits are used up (they reset tomorrow), but I can still help with:",
};
const CAN_DO = "\n- **Find jobs**, e.g. *\"find remote jobs above 15 LPA\"*\n- **Your best matches today**\n- **What to do next** in your search\n- On a job: **why you match**, **what's missing**, a **cover letter**, or **prepare the application**\n- **Update preferences**, e.g. *\"Chennai, hybrid, 15 LPA\"*";
const GREETING = /^\s*(hi+|hey+|hello+|hola|namaste|namaskar|vanakkam|good (morning|afternoon|evening)|yo)\b[\s!.,👋🙏]*$/i;
// Closing/decline messages that need a friendly word, not a round-trip to the model. "yes", "ok" and "sure" are NOT
// here: they usually accept something the assistant just offered, so they need the conversation context.
const DECLINE = /^\s*(no|nope|nah|no thanks?|no thank you|not now|maybe later|later|nothing|nothing else|that'?s all|that'?s it)[\s!.,🙏]*$/i;
const THANKS = /^\s*(thanks?|thank you|thank u|thx|ty|tysm|thanks a lot|great,? thanks?|ok,? thanks?|okay,? thanks?|cool,? thanks?|dhanyavaad|shukriya)[\s!.,🙏👍]*$/i;
const BYE = /^\s*(bye|goodbye|see you|see ya|good night|gn|tata)[\s!.,👋]*$/i;

/** "K. Priya" → "Priya"; skips initials so greetings sound natural. */
export function firstName(fullName: string): string {
  const parts = fullName.split(/\s+/).filter(Boolean);
  return parts.find((p) => p.replace(/\./g, "").length > 2) || parts[0] || "";
}

const Step = z.object({
  action: z.enum(["tool", "reply"]).catch("reply"),
  tool: z.string().optional(),
  args: z.record(z.any()).optional(),
  reply: z.string().optional(),
  suggestions: z.array(z.string()).max(4).optional(),
});

const PAGE_NAMES: Record<string, string> = {
  home: "their dashboard", matches: "the 'For you' list of matched jobs", search: "the job search page", applications: "their applications board",
  resume: "their resumes", profile: "their profile and preferences", settings: "settings", admin: "the admin console",
};

function systemPrompt(p: CandidateProfile | null, contextLine: string): string {
  const brief = p
    ? `User: ${firstName(p.fullName) || "Job seeker"}; current role: ${p.currentRole || "n/a"}; ${experienceText(p.totalExperienceYears)} experience; target roles: ${p.preferences.targetRoles.join(", ") || "not set"}; cities: ${p.preferences.locations.join(", ") || "not set"}; profile status: ${p.status}; discovery ${p.discoveryPaused ? "paused" : "active"}.`
    : "User has no profile yet.";
  return `You are the MyCareer.AI assistant: a sharp, warm placement coach for a job seeker in India. You act through the tools below.
${brief}
${contextLine}
Today is ${new Date().toISOString().slice(0, 10)}.

TOOLS:
${toolCatalog()}

Respond with ONE JSON object per step, keys in this order:
  {"action":"tool","tool":"<name>","args":{...}}   to call a tool, or
  {"action":"reply","reply":"<markdown answer>","suggestions":["...","..."]}   to answer.
After a tool call you get its result and can call another tool or reply.

HOW TO ANSWER:
- Lead with the answer. Keep it short: 1–3 sentences, or a short numbered list for steps/options. No filler ("Great question", "Certainly").
- Be specific: use the real numbers, job titles, companies and skills from tool results. Bold the key facts.
- "How do I improve my profile / get better matches / why so few good matches": call get_profile_advice first, then give the top 2–3 actions ranked by impact, each with its number (e.g. "**Kanban** is missing in 38 of your good matches — add it if you've used it"). Don't talk about profile completeness percentages.
- End with at most ONE question or next step. Never ask about something that barely matters.
- suggestions: 2–3 short follow-ups the user would tap next, written as the user speaking ("Add Kanban to my skills", "Show jobs in Pune"). Make them specific to this answer.
- Reply in the user's language: Hindi → Hindi (Devanagari); Hinglish → Hinglish; otherwise English.

RULES:
- Never invent jobs, companies, scores or facts; only report what tool results contain. If a tool returns nothing, say so.
- Only change things the user clearly asked for, using values they stated. After a change, say exactly what changed (the app shows an Undo button).
- Sensitive tools need the user's confirmation; call them normally and the app will ask.
- Never say you submitted an application — you can only prepare it or open the employer's page.
- Use ₹ and LPA (or ₹/month for hourly/daily roles). Refer to jobs by title and company, never by id.
- ${UNTRUSTED_NOTICE}`;
}

function transcript(history: ChatMessage[]): string {
  return history.slice(-8).map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.text.slice(0, 600)}`).join("\n");
}

// ---------------- streaming the "reply" field out of the model's JSON ----------------

const JSON_ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "", b: "", f: "", '"': '"', "\\": "\\", "/": "/" };

/**
 * The model answers in JSON ({"action":"reply","reply":"..."}). This pulls the reply text out while the JSON is still
 * arriving, so the user sees the answer being written. Tool steps are never streamed.
 */
export class ReplyStreamer {
  private buf = "";
  private pos = -1;
  private done = false;
  emitted = false;
  constructor(private emit: (text: string) => void) {}

  push(chunk: string) {
    this.buf += chunk;
    if (this.done) return;
    if (this.pos < 0) {
      if (/"action"\s*:\s*"tool"/.test(this.buf)) { this.done = true; return; }
      const start = /"action"\s*:\s*"reply"[\s\S]*?"reply"\s*:\s*"/.exec(this.buf);
      if (!start) return;
      this.pos = start.index + start[0].length;
    }
    let out = "";
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos];
      if (c === "\\") {
        if (this.pos + 1 >= this.buf.length) break; // wait for the rest of the escape
        const n = this.buf[this.pos + 1];
        if (n === "u") {
          if (this.pos + 6 > this.buf.length) break;
          out += String.fromCharCode(parseInt(this.buf.slice(this.pos + 2, this.pos + 6), 16));
          this.pos += 6;
          continue;
        }
        out += JSON_ESCAPES[n] ?? n;
        this.pos += 2;
        continue;
      }
      if (c === '"') { this.done = true; break; }
      out += c;
      this.pos++;
    }
    if (out) { this.emitted = true; this.emit(out); }
  }
}

// ---------------- tool progress labels ----------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const STEP_LABELS: Record<string, { running: string; done: (d: any) => string }> = {
  get_candidate_profile: { running: "Reading your profile", done: () => "Read your profile" },
  get_profile_advice: { running: "Checking what's holding your matches back", done: (d) => (d?.matches ? `Analysed ${plural(d.matches.total, "match", "matches")}` : "Checked your matches") },
  update_preferences: { running: "Updating your preferences", done: (d) => d?.changed || "Updated your preferences" },
  search_jobs: { running: "Searching your matches", done: (d) => (d?.count ? `Found ${plural(d.count, "job")}` : "No matching jobs yet") },
  get_job_details: { running: "Reading the job posting", done: () => "Read the job posting" },
  analyze_job_match: { running: "Comparing you with this job", done: (d) => (d?.score !== undefined ? `Match score ${d.score}%` : "Compared the job") },
  save_job: { running: "Saving the job", done: (d) => (d?.saved === false ? "Removed from saved" : "Saved the job") },
  hide_job: { running: "Hiding the job", done: () => "Hid the job" },
  generate_tailored_resume: { running: "Tailoring your resume", done: () => "Tailored resume ready for review" },
  generate_cover_letter: { running: "Writing a cover letter", done: () => "Cover letter written" },
  prepare_application: { running: "Preparing your application", done: () => "Application prepared" },
  get_applications: { running: "Checking your applications", done: (d) => `Found ${plural(d?.count ?? 0, "application")}` },
  get_application_summary: { running: "Summarising your applications", done: () => "Summarised your applications" },
  update_application_status: { running: "Updating the application", done: (d) => (d?.status ? `Marked as ${String(d.status).replace(/_/g, " ")}` : "Updated the application") },
  set_discovery_paused: { running: "Updating job alerts", done: (d) => (d?.discoveryPaused ? "Paused job discovery" : "Resumed job discovery") },
  run_job_search: { running: "Starting a fresh search", done: (d) => (d?.started ? "Fresh search started" : "Searched recently") },
  get_todays_summary: { running: "Checking today's jobs", done: (d) => `${plural(d?.newInLast24h ?? 0, "new job")} today` },
  open_page: { running: "Opening the page", done: () => "Opened the page" },
};

// ---------------- pending confirmations ----------------

async function savePending(uid: string, tool: string, args: Record<string, unknown>, summary: string): Promise<PendingAction> {
  const now = Date.now();
  const p: PendingAction = { id: `pa_${now}_${crypto.randomBytes(4).toString("hex")}`, tool, args, summary, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + PENDING_TTL_MS).toISOString() };
  await (await getStore()).put("pendingActions", p.id, { ...p, uid });
  await audit(uid, "agent.confirmation_requested", { tool, pendingId: p.id }, "agent");
  return p;
}

/** Run a tool as the agent. Sensitive (or taint-downgraded) tools become pending confirmations. */
export async function invoke(ctx: { uid: string }, name: string, rawArgs: unknown, state: { tainted: boolean; modifies: number }): Promise<{ result?: ToolResult; pending?: PendingAction; error?: string }> {
  const tool = TOOL_MAP.get(name);
  if (!tool) return { error: `Unknown tool "${name}". Use only the listed tools.` };
  const parsed = tool.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) return { error: `Invalid arguments: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  const needsConfirm = tool.permission === "sensitive" || (tool.taintSensitive && state.tainted);
  if (needsConfirm) {
    const pending = await savePending(ctx.uid, name, parsed.data, tool.summarize(parsed.data));
    return { pending };
  }
  if (tool.permission === "modify" && ++state.modifies > MAX_MODIFY_PER_TURN) return { error: "Too many changes in one request. Ask the user before doing more." };
  try {
    const result = await tool.run({ uid: ctx.uid, confirmed: false }, parsed.data);
    if (result.untrusted) state.tainted = true;
    await audit(ctx.uid, `agent.tool.${name}`, { permission: tool.permission }, "agent");
    return { result };
  } catch (err: any) {
    if (err instanceof AppError) return { error: err.message };
    if (err instanceof AiQuotaError || err instanceof AiUnavailableError) return { error: "AI features are unavailable right now." };
    console.warn(`[agent] tool ${name} failed`, err);
    return { error: "That action failed unexpectedly." };
  }
}

/** Execute a previously-approved pending action. Only reachable through the authenticated confirm endpoint. */
export async function confirmPending(uid: string, id: string, approve: boolean): Promise<{ ok: boolean; message: string; openUrl?: string; data?: unknown }> {
  const store = await getStore();
  const rec = await store.get<PendingAction & { uid: string }>("pendingActions", id);
  if (!rec || rec.uid !== uid) throw new AppError(404, "That request no longer exists.");
  await store.del("pendingActions", id);
  if (new Date(rec.expiresAt).getTime() < Date.now()) throw new AppError(410, "That confirmation expired. Please ask again.");
  if (!approve) {
    await audit(uid, "agent.confirmation_declined", { tool: rec.tool, pendingId: id });
    return { ok: false, message: "Okay, I won't do that." };
  }
  const tool = TOOL_MAP.get(rec.tool);
  if (!tool) throw new AppError(400, "Unknown action.");
  const args = tool.schema.parse(rec.args);
  const ctx: ToolContext = { uid, confirmed: true };
  const result = await tool.run(ctx, args);
  await audit(uid, `agent.confirmed.${rec.tool}`, { pendingId: id }, "user");
  return { ok: true, message: `Done: ${tool.summarize(args)}.`, openUrl: result.openUrl, data: result.data };
}

/** Undo a change the assistant made (currently: preference updates). */
export async function undoChange(uid: string, changeId: string): Promise<{ message: string }> {
  const store = await getStore();
  const rec = await store.get<{ uid: string; keys: string[]; previous: Record<string, unknown>; summary: string; expiresAt: string }>("agentUndo", changeId);
  if (!rec || rec.uid !== uid) throw new AppError(404, "That change can no longer be undone.");
  await store.del("agentUndo", changeId);
  if (new Date(rec.expiresAt).getTime() < Date.now()) throw new AppError(410, "That change is too old to undo. Edit it in your profile instead.");
  await restorePreferences(uid, rec.previous as any, rec.keys);
  await matchCandidate(uid).catch(() => undefined);
  // Mark it undone in the saved conversation so the button doesn't come back.
  const convo = await loadConversation(uid);
  await saveConversation(uid, convo.map((m) => (m.changes?.some((c) => c.id === changeId) ? { ...m, changes: m.changes.map((c) => (c.id === changeId ? { ...c, undone: true } : c)) } : m)));
  await audit(uid, "agent.change_undone", { changeId });
  return { message: `Undone: ${rec.summary}.` };
}

// ---------------- deterministic fallback (AI down / quota exhausted) ----------------

interface Intent {
  tool: string;
  args: Record<string, unknown>;
  /** How to word the answer, e.g. "missing" leads with gaps, "why" with what fits. */
  flavor?: "missing" | "why";
}

const PAGE_WORDS: Array<[AppPage, RegExp]> = [
  ["settings", /\b(settings?|ai key|api key|account)\b/],
  ["profile", /\b(profile|preferences?|my skills)\b/],
  ["resume", /\b(resumes?|cv)\b/],
  ["matches", /\b(saved jobs?|my matches|for you|recommended)\b/],
  ["search", /\bsearch page\b/],
  ["home", /\b(home|dashboard)\b/],
];

export function routeIntent(message: string, ctx?: ChatContext): Intent | null {
  const t = message.toLowerCase();
  if (ctx?.jobId) {
    const jobId = ctx.jobId;
    if (/cover letter/.test(t)) return { tool: "generate_cover_letter", args: { jobId } };
    if (/(tailor|prepare|apply|application|resume for)/.test(t) && !/(why|what|how)\b.*\b(match|fit)/.test(t)) return { tool: "prepare_application", args: { jobId } };
    if (/\bsave\b/.test(t)) return { tool: "save_job", args: { jobId, saved: true } };
    if (/(miss|lack|gap|don'?t have|do not have|need to learn|what.*(learn|add)|short of)/.test(t)) return { tool: "analyze_job_match", args: { jobId }, flavor: "missing" };
    if (/(why|match|fit|suit|good for|right for|eligible|chance|score|this job)/.test(t)) return { tool: "analyze_job_match", args: { jobId }, flavor: "why" };
  }
  if (/(what should i do|what do i do|next step|what next|where (do|should) i start|how (do|should) i start|what now|guide me|help me get (a )?job)/.test(t)) return { tool: "__next_steps", args: {} };
  if (/(how (do|does|to) (i )?use|what can you do|help$|^help|how does (this|the app) work)/.test(t)) return { tool: "__how_to", args: {} };
  if (/^\s*(open|go to|goto|take me to|show me|show)\b/.test(t)) {
    const hit = PAGE_WORDS.find(([, re]) => re.test(t));
    if (hit) return { tool: "open_page", args: { page: hit[0] } };
  }
  if (/\b(pause)\b.*(search|discovery|jobs|alerts)/.test(t)) return { tool: "set_discovery_paused", args: { paused: true } };
  if (/\b(resume|restart|start)\b.*(search|discovery|alerts)/.test(t)) return { tool: "set_discovery_paused", args: { paused: false } };
  if (/(improve|better|more).*(profile|match)|why.*(few|no|low).*(match|job)/.test(t)) return { tool: "get_profile_advice", args: {} };
  if (/(what|which).*(apply|applied)|my applications|show.*applications|pending applications/.test(t)) return { tool: "get_application_summary", args: { days: /week/.test(t) ? 7 : /month/.test(t) ? 30 : 7 } };
  if (/today|summary|best opportunit|top jobs|new jobs|what's new/.test(t)) return { tool: "get_todays_summary", args: {} };
  if (/(refresh|fresh|new search|search again|run.*search|look for new)/.test(t)) return { tool: "run_job_search", args: {} };
  if (/\b(find|search|show|get|list)\b.*\b(jobs?|roles?|openings?|positions?|opportunit)/.test(t) || /\bjobs? (for|in|at)\b/.test(t)) {
    const cities = findIndianCities(message);
    const remote = /\bremote\b/.test(t);
    const lpa = t.match(/(?:above|over|at least|min(?:imum)?|>=?)\s*₹?\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|l\b)/);
    const q = message.replace(/\b(find|search|show|get|list|me|for|jobs?|roles?|openings?|positions?|opportunit\w*|in|the|only|above|over|at least|minimum|remote|lpa|lakhs?|please|some|all|any)\b/gi, " ")
      .replace(cities.length ? new RegExp(cities.join("|"), "gi") : /$^/, " ").replace(/[₹\d.,]+/g, " ").replace(/\s+/g, " ").trim();
    return { tool: "search_jobs", args: { ...(q ? { query: q } : {}), ...(cities[0] ? { location: cities[0] } : remote ? { location: "remote" } : {}), ...(lpa ? { minSalaryLPA: Number(lpa[1]) } : {}), limit: 6 } };
  }
  const prefs = parsePreferenceText(message);
  if (Object.keys(prefs).length && /\b(prefer|want|only|salary|notice|relocat|location|remote|hybrid|lpa|looking)\b/.test(t)) return { tool: "update_preferences", args: prefs };
  return null;
}

function basicReply(intent: Intent | null, out: { result?: ToolResult; pending?: PendingAction; error?: string } | null, why: BasicReason, message: string, name: string): string {
  if (!intent) {
    const hello = GREETING.test(message) ? `Hi${name ? ` ${name}` : ""}! ` : "";
    return `${hello}${BASIC_REASON_TEXT[why]}${CAN_DO}`;
  }
  // Answering from rules is fine, but people should know why the reply is simpler than usual.
  if (why === "quota" && !intent.tool.startsWith("__")) return `${basicReply(intent, out, "busy", message, name)}\n\n*Today's free AI credits are used up, so this answer is a simple one.*`;
  if (!out || out.error) return out?.error || "Something went wrong.";
  if (out.pending) return `I need your confirmation: ${out.pending.summary}`;
  const d: any = out.result?.data;
  switch (intent.tool) {
    case "analyze_job_match": return matchText(d, intent.flavor);
    case "generate_cover_letter": return `Here's a cover letter for **${d.jobTitle || "this job"}**, written only from what's in your profile. Edit the parts in your own words before sending:\n\n${d.coverLetter}`;
    case "prepare_application": return `Your application is ready to review: a resume tailored to this job and a cover letter, both built only from your real experience. ${d.nextStep || ""}`.trim();
    case "save_job": return "Saved. You'll find it under **For you → Saved**.";
    case "search_jobs": return d.count ? `I found **${d.count}** matching job${d.count === 1 ? "" : "s"}. Here are the best ones:` : (d.note || "No matching jobs right now.");
    case "get_todays_summary": return `In the last 24 hours I found **${d.newInLast24h}** new jobs for you. **${d.strong}** are strong matches (80%+) and **${d.potential}** are potential matches.`;
    case "get_application_summary": return `You have **${d.total}** application${d.total === 1 ? "" : "s"}; **${d.appliedInPeriod.length}** applied recently and **${d.pending}** pending.`;
    case "set_discovery_paused": return d.discoveryPaused ? "Job discovery is paused. Say *\"resume job search\"* when you want it back." : "Job discovery is back on.";
    case "update_preferences": return `Done — ${d.changed}.${d.stillMissing?.length ? ` Still need: ${d.stillMissing[0]}` : ""}`;
    case "get_profile_advice": return adviceText(d);
    case "open_page": return `Opening ${d.opened === "matches" ? "your matches" : d.opened === "home" ? "your dashboard" : `your ${d.opened}`}…`;
    case "run_job_search": return d.started ? "Started a fresh search across all sources. I'll notify you when it's done." : `A search ran recently — try again in about ${Math.ceil((d.retryInSeconds || 60) / 60)} min.`;
    case "__next_steps": case "__how_to": return d.text;
    default: return "Done.";
  }
}

/** "Why do I match?" / "What am I missing?" from the match itself (no AI needed). */
function matchText(d: any, flavor?: Intent["flavor"]): string {
  if (!d || d.error) return d?.error || "I couldn't read this job.";
  const title = d.job?.title ? `**${d.job.title}**${d.job.company ? ` at ${d.job.company}` : ""}` : "this job";
  const band = d.score >= 80 ? "an excellent" : d.score >= 65 ? "a good" : d.score >= 50 ? "a fair" : "a weak";
  const fits = (d.why || []).slice(0, 3).map((x: string) => `- ${x}`).join("\n");
  const missing: string[] = d.missingSkills || [];
  const gaps = (d.gaps || []).filter((g: string) => !/skills not found/i.test(g)).slice(0, 2);
  if (flavor === "missing") {
    if (!missing.length && !gaps.length) return `Good news: for ${title} your profile already covers what the job asks for. You're ${band} match (**${d.score}%**).`;
    const lines = [`For ${title}, here's what your profile doesn't show yet:`];
    if (missing.length) lines.push(`- **Skills:** ${missing.slice(0, 6).join(", ")}`);
    for (const g of gaps) lines.push(`- ${g}`);
    lines.push("", missing.length ? "If you've really used any of these, add them in **Profile → Skills** and your score will go up. If not, mention the closest thing you've done in your cover letter." : "Mention how your experience covers these in your cover letter.");
    return lines.join("\n");
  }
  const lines = [`You're ${band} match for ${title} (**${d.score}%**).`];
  if (fits) lines.push("", "**What fits:**", fits);
  if (missing.length || gaps.length) lines.push("", "**What's missing:**", ...(missing.length ? [`- ${missing.slice(0, 5).join(", ")}`] : []), ...gaps.map((g: string) => `- ${g}`));
  return lines.join("\n");
}

/** Rules-only version of the profile advice, used when the AI is unavailable. */
function adviceText(d: any): string {
  if (d?.error) return d.error;
  const lines: string[] = [];
  const m = d.matches;
  lines.push(`You have **${m.excellent} excellent**, **${m.good} good** and **${m.fair} fair** matches. The biggest levers:`);
  let n = 1;
  for (const g of (d.skillGaps || []).slice(0, 2)) lines.push(`${n++}. **${g.skill}** is missing in ${g.missingInJobs} of your good/fair matches — add it if you've used it.`);
  for (const x of (d.diagnosis || []).filter((x: any) => x.kind !== "skills").slice(0, 1)) lines.push(`${n++}. ${x.title}. ${x.detail}`);
  return lines.join("\n");
}

const SUGGESTIONS_DEFAULT = ["Show today's best opportunities", "How can I get better matches?", "What did I apply for this week?"];

/** Context-aware starters for the empty chat and quick replies. */
export function contextSuggestions(ctx?: ChatContext): string[] {
  if (ctx?.jobId) return ["Why do I match this job?", "What am I missing for this job?", "Write a cover letter for this job"];
  switch (ctx?.page) {
    case "matches": return ["Why so few excellent matches?", "Show remote jobs only", "Find jobs above 20 LPA"];
    case "applications": return ["What should I follow up on?", "What did I apply for this week?", "Prepare my next application"];
    case "profile": return ["How can I get better matches?", "Which skills should I add?", "Which cities have the most jobs for me?"];
    case "search": return ["Find remote jobs for me", "Jobs for freshers near me", "Jobs above 15 LPA"];
    default: return SUGGESTIONS_DEFAULT;
  }
}

/** Instant, friendly replies for greetings, thanks and "no thanks" — no model call, but still useful. */
async function quickReply(uid: string, message: string, profile: CandidateProfile | null, ctx?: ChatContext): Promise<{ reply: string; suggestions: string[] } | null> {
  const kind = GREETING.test(message) ? "hello" : DECLINE.test(message) ? "decline" : THANKS.test(message) ? "thanks" : BYE.test(message) ? "bye" : null;
  if (!kind) return null;
  const name = firstName(profile?.fullName || "");
  let nudge = "";
  if (profile?.status === "ready") {
    const s = await feedSummary(uid).catch(() => null);
    if (s) nudge = s.newSinceLastVisit > 0 ? `**${s.newSinceLastVisit} new matches** came in since your last visit.` : s.bands.excellent > 0 ? `You have **${s.bands.excellent} excellent** ${s.bands.excellent === 1 ? "match" : "matches"} waiting.` : s.total > 0 ? `You have **${s.total}** matches — I can show you how to turn more of them into excellent ones.` : "";
  }
  const suggestions = contextSuggestions(ctx);
  switch (kind) {
    case "hello": return { reply: `Hi${name ? ` ${name}` : ""}! ${nudge || "I'm here to help you find the right job."} What would you like to do?`, suggestions };
    case "decline": return { reply: `No problem.${nudge ? ` ${nudge}` : ""} Just ask whenever you need me.`, suggestions };
    case "thanks": return { reply: "You're welcome! Anything else I can help with?", suggestions };
    case "bye": return { reply: `Good luck${name ? `, ${name}` : ""}! I'll keep looking and let you know when strong matches come in.`, suggestions: [] };
  }
}

async function contextLineFor(uid: string, ctx?: ChatContext): Promise<string> {
  if (!ctx) return "";
  if (ctx.jobId) {
    try {
      const j = await getJobForUser(uid, ctx.jobId);
      return `The user is looking at the job "${j.title.slice(0, 120)}" at ${j.company.slice(0, 80)} (jobId ${j.id}). "This job" means this one.`;
    } catch { /* not visible to this user: ignore */ }
  }
  return ctx.page && PAGE_NAMES[ctx.page] ? `The user is currently on ${PAGE_NAMES[ctx.page]}.` : "";
}

// ---------------- main entry ----------------

export async function runAgent(uid: string, message: string, history: ChatMessage[], opts: RunOptions = {}): Promise<AgentReply> {
  const profile = await getProfile(uid);
  const id = `msg_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const cards: AgentReply["cards"] = [];
  const steps: ChatStep[] = [];
  const changes: AgentReply["changes"] = [];
  const state = { tainted: false, modifies: 0 };
  const emit = opts.onEvent || (() => undefined);
  let openUrl: string | undefined;
  let navigate: AppPage | undefined;
  await audit(uid, "agent.message", { chars: message.length });

  const collect = (r?: ToolResult) => {
    if (r?.cards) for (const c of r.cards) if (!cards.some((x) => x.jobId === c.jobId)) cards.push(c);
    if (r?.openUrl) openUrl = r.openUrl;
    if (r?.navigate) navigate = r.navigate;
    if (r?.change) changes.push(r.change);
  };
  const runStep = async (tool: string, args: unknown, st: typeof state) => {
    const labels = STEP_LABELS[tool] || { running: "Working on it", done: () => "Done" };
    const step: ChatStep = { id: `s${steps.length + 1}`, tool, label: labels.running, state: "running" };
    emit({ type: "step", step: { ...step } });
    const out = await invoke({ uid }, tool, args, st);
    Object.assign(step, out.error ? { state: "error", label: labels.running, detail: out.error } : out.pending ? { state: "done", label: "Needs your OK" } : { state: "done", label: labels.done(out.result?.data) });
    steps.push(step);
    emit({ type: "step", step: { ...step } });
    return out;
  };
  const aiMode = async (): Promise<Pick<AgentReply, "mode" | "basicReason">> => ((await aiAvailable(uid)) ? { mode: "ai" } : { mode: "basic", basicReason: (await aiStatus()).some((p) => p.configured) || (await getUserKey(uid)) ? "busy" : "no_ai" });

  // 1) Small talk: answer instantly.
  const quick = await quickReply(uid, message, profile, opts.context);
  if (quick) {
    emit({ type: "delta", text: quick.reply });
    return { id, reply: quick.reply, suggestions: quick.suggestions, cards, steps, changes, ...(await aiMode()) };
  }

  // 2) The model plans with tools, then writes the answer (streamed).
  let scratch = `${transcript(history)}\nUSER: ${message.slice(0, 1500)}`;
  const system = systemPrompt(profile, await contextLineFor(uid, opts.context));
  let streamedAny = false; // did the client receive model text that a fallback answer must replace?
  const streamDelta = (t: string) => { streamedAny = true; emit({ type: "delta", text: t }); };
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (opts.signal?.aborted) break;
      let streamer = new ReplyStreamer(streamDelta);
      const s = await generateJSON({
        task: "chat", uid, cache: false, system, prompt: `${scratch}\n\nNext JSON step:`, schema: Step, maxTokens: 900,
        onText: (t) => streamer.push(t),
        onReset: () => { if (streamer.emitted) emit({ type: "reset" }); streamer = new ReplyStreamer(streamDelta); },
      });
      if (s.action === "reply" || !s.tool) {
        const reply = s.reply?.trim() || "How can I help with your job search?";
        if (!streamer.emitted) emit({ type: "delta", text: reply });
        return { id, reply, suggestions: s.suggestions?.length ? s.suggestions.slice(0, 3) : contextSuggestions(opts.context), cards, steps, changes, openUrl, navigate, mode: "ai" };
      }
      if (streamer.emitted) emit({ type: "reset" }); // model wrote text, then chose a tool after all
      const out = await runStep(s.tool, s.args, state);
      if (out.pending) {
        const reply = `I can do that, but I need your OK first: **${out.pending.summary}**`;
        emit({ type: "delta", text: reply });
        return { id, reply, suggestions: [], cards, steps, changes, pendingAction: out.pending, mode: "ai" };
      }
      collect(out.result);
      const payload = out.error ? { error: out.error } : out.result?.data;
      scratch += `\nASSISTANT_TOOL_CALL: ${JSON.stringify({ tool: s.tool, args: s.args })}\nTOOL_RESULT${out.result?.untrusted ? " (contains untrusted external text)" : ""}: ${JSON.stringify(payload).slice(0, 3500)}`;
    }
    const reply = opts.signal?.aborted ? "Stopped." : "I did what I could — let me know what you'd like next.";
    emit({ type: "delta", text: reply });
    return { id, reply, suggestions: contextSuggestions(opts.context), cards, steps, changes, openUrl, navigate, mode: "ai" };
  } catch (err: any) {
    if (!(err instanceof AiUnavailableError || err instanceof AiQuotaError)) console.warn("[agent] error", err);
    // Degrade gracefully: deterministic intent routing keeps core functions usable without AI.
    if (streamedAny) emit({ type: "reset" });
    const intent = routeIntent(message, opts.context);
    const out = intent && intent.tool.startsWith("__") ? await basicLocal(uid, intent.tool) : intent ? await runStep(intent.tool, intent.args, { tainted: false, modifies: 0 }) : null;
    collect(out?.result);
    const why: BasicReason = err instanceof AiQuotaError ? "quota" : (await aiStatus()).some((p) => p.configured) || (await getUserKey(uid)) ? "busy" : "no_ai";
    const reply = basicReply(intent, out, why, message, firstName(profile?.fullName || ""));
    emit({ type: "delta", text: reply });
    return { id, reply, suggestions: contextSuggestions(opts.context), cards, steps, changes, pendingAction: out?.pending, openUrl, navigate, mode: "basic", basicReason: why };
  }
}

export async function loadConversation(uid: string): Promise<ChatMessage[]> {
  const rec = await (await getStore()).get<{ messages: ChatMessage[] }>("conversations", uid);
  return rec?.messages || [];
}

export async function saveConversation(uid: string, messages: ChatMessage[]): Promise<void> {
  await (await getStore()).put("conversations", uid, { uid, messages: messages.slice(-40) });
}

export async function clearConversation(uid: string): Promise<void> {
  await (await getStore()).del("conversations", uid);
}

/** 👍/👎 on an answer: kept for quality review (no message text is stored with it). */
export async function saveFeedback(uid: string, messageId: string, rating: "up" | "down", reason?: string): Promise<void> {
  const convo = await loadConversation(uid);
  if (!convo.some((m) => m.id === messageId)) throw new AppError(404, "Message not found.");
  await (await getStore()).put("agentFeedback", `${uid}_${messageId}`, { uid, messageId, rating, reason: reason?.slice(0, 200), at: new Date().toISOString() });
  await saveConversation(uid, convo.map((m) => (m.id === messageId ? { ...m, rating } : m)));
  await audit(uid, "agent.feedback", { rating });
}

/** Basic-mode answers that are not tools: the next steps from the placement companion, and how to use the app. */
async function basicLocal(uid: string, tool: string): Promise<{ result?: ToolResult; pending?: PendingAction; error?: string }> {
  if (tool === "__next_steps") {
    const j = await journeyFor(uid).catch(() => null);
    const actions = (j?.actions || []).slice(0, 3);
    const text = actions.length
      ? ["Here's what I'd do next:", ...actions.map((a, i) => `${i + 1}. **${a.title}**. ${a.detail}`)].join("\n")
      : "You're all caught up. I'll tell you as soon as a strong new match appears.";
    return { result: { data: { text } } };
  }
  return { result: { data: { text: [
    "Here's how to get the most out of MyCareer.AI:",
    "1. **Home** shows what to do today, your weekly plan and your progress.",
    "2. **For you** lists jobs ranked by how well they fit. Open one to see why, then **Prepare my application**.",
    "3. **Applications** tracks everything you've applied for. Drag cards as things move.",
    "4. **Interview prep** gives likely questions and a mock interview you can speak.",
    "5. **Resumes** has your resume, a check with fixes, and a PDF download.",
    "You can also just ask me, or tap the microphone and talk.",
  ].join("\n") } } };
}
