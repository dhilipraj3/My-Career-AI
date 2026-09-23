import crypto from "node:crypto";
import { z } from "zod";
import type { CandidateProfile, ExperienceEntry, Job, JobMatch, ResumeVersion, TailoredResumeContent, ValidationIssue } from "../../shared/types.js";
import { generateJSON, generateText } from "../ai/gateway.js";
import { audit } from "../audit.js";
import { getStore } from "../db/store.js";
import { extractSkillKeys, normalizeSkillKey } from "../nlp/skills.js";
import { UNTRUSTED_NOTICE, fenceUntrusted, overlap, tokenize } from "../nlp/text.js";
import { notify } from "../notifications.js";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (s: string) => new Set(tokenize(s));

export function claimableSkillKeys(p: CandidateProfile): Set<string> {
  return new Set(p.skills.filter((s) => s.source !== "ai_derived").map((s) => s.key));
}

function periodOf(e: ExperienceEntry): string {
  const end = e.current || /present/i.test(e.endDate || "") ? "Present" : e.endDate || "";
  return [e.startDate, end].filter(Boolean).join(" – ");
}

const numbersIn = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/,/g, ""));

/** All source text a claim about experience `e` may legitimately draw from. */
function experienceFacts(e: ExperienceEntry): string[] {
  return [...e.responsibilities, ...e.achievements];
}

function isGroundedBullet(bullet: string, sources: string[], allProfileText: string): { ok: boolean; reason?: string } {
  const bt = tokens(bullet);
  if (!bt.size) return { ok: false, reason: "empty bullet" };
  let best = 0;
  let bestSrc = "";
  for (const src of sources) {
    const o = overlap(bt, tokens(src));
    if (o > best) { best = o; bestSrc = src; }
  }
  if (best < 0.6) return { ok: false, reason: "does not correspond to anything in your resume for this role" };
  const srcNums = new Set(numbersIn(bestSrc + " " + allProfileText));
  const invented = numbersIn(bullet).find((n) => !srcNums.has(n));
  if (invented) return { ok: false, reason: `contains the figure "${invented}", which isn't in your resume` };
  return { ok: true };
}

/** Everything a text may mention about the candidate, for claim checking (summary, cover letters). */
export function checkClaims(text: string, p: CandidateProfile, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const claimable = claimableSkillKeys(p);
  for (const k of extractSkillKeys(text)) {
    if (!claimable.has(k)) issues.push({ severity: "error", path, message: `Mentions "${k.replace(/_/g, " ")}", which isn't a verified skill in your profile` });
  }
  const yrs = [...text.matchAll(/(\d{1,2})\+?\s*(?:years?|yrs?)/gi)].map((m) => +m[1]);
  const maxOk = Math.ceil(p.totalExperienceYears);
  for (const y of yrs) {
    const allowed = y <= maxOk || numbersIn(profileText(p)).includes(String(y));
    if (!allowed) issues.push({ severity: "error", path, message: `Claims ${y} years of experience; your profile shows ${p.totalExperienceYears}` });
  }
  const knownOrgs = new Set([...p.experience.map((e) => norm(e.company)), ...p.education.map((e) => norm(e.institution))].filter(Boolean));
  const orgClaims = [...text.matchAll(/\b(?:at|with|@)\s+([A-Z][\w&.]+(?:\s+[A-Z][\w&.]+){0,3})/g)].map((m) => m[1]);
  for (const org of orgClaims) {
    const n = norm(org);
    if (n && ![...knownOrgs].some((k) => k.includes(n) || n.includes(k))) {
      // "at <target company>" is allowed in cover letters; only flag when it looks like an employer claim
      issues.push({ severity: "warning", path, message: `Mentions "${org}" — make sure it's an employer or institution from your resume` });
    }
  }
  return issues;
}

function profileText(p: CandidateProfile): string {
  return [p.summary, ...p.experience.flatMap((e) => [e.company, e.designation, ...experienceFacts(e)]), ...p.projects.map((x) => x.description), ...p.certifications.map((c) => c.name)].join(" ");
}

export function validateTailored(c: TailoredResumeContent, p: CandidateProfile): { ok: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const all = profileText(p);
  const claimable = claimableSkillKeys(p);

  issues.push(...checkClaims(`${c.headline}. ${c.summary}`, p, "summary"));

  c.experience.forEach((e, i) => {
    const src = p.experience.find((x) => x.id === e.experienceId);
    if (!src) return issues.push({ severity: "error", path: `experience[${i}]`, message: "References a role that isn't in your profile" });
    if (norm(e.company) !== norm(src.company)) issues.push({ severity: "error", path: `experience[${i}].company`, message: `Company was changed (expected "${src.company}")` });
    if (norm(e.designation) !== norm(src.designation)) issues.push({ severity: "error", path: `experience[${i}].designation`, message: `Job title was changed (expected "${src.designation}")` });
    if (e.period !== periodOf(src)) issues.push({ severity: "error", path: `experience[${i}].period`, message: `Dates were changed (expected "${periodOf(src)}")` });
    e.bullets.forEach((b, j) => {
      const g = isGroundedBullet(b, experienceFacts(src), all);
      if (!g.ok) issues.push({ severity: "error", path: `experience[${i}].bullets[${j}]`, message: `Bullet ${g.reason}` });
    });
  });

  c.skills.forEach((s, i) => {
    if (!claimable.has(normalizeSkillKey(s))) issues.push({ severity: "error", path: `skills[${i}]`, message: `"${s}" is not a verified skill in your profile` });
  });
  c.education.forEach((e, i) => {
    if (!p.education.some((x) => norm(x.institution) === norm(e.institution) && norm(x.degree) === norm(e.degree)))
      issues.push({ severity: "error", path: `education[${i}]`, message: "Education entry doesn't match your profile" });
  });
  c.certifications.forEach((name, i) => {
    if (!p.certifications.some((x) => norm(x.name) === norm(name))) issues.push({ severity: "error", path: `certifications[${i}]`, message: `"${name}" is not a certification in your profile` });
  });
  c.projects.forEach((pr, i) => {
    const src = p.projects.find((x) => norm(x.title) === norm(pr.title));
    if (!src) issues.push({ severity: "error", path: `projects[${i}]`, message: `Project "${pr.title}" is not in your profile` });
    else if (overlap(tokens(pr.description), tokens(src.description)) < 0.6) issues.push({ severity: "error", path: `projects[${i}].description`, message: "Project description differs from your profile" });
  });
  if (!c.experience.length && p.experience.length) issues.push({ severity: "warning", path: "experience", message: "No work experience included" });
  return { ok: !issues.some((i) => i.severity === "error"), issues };
}

/** Drop anything that failed validation instead of shipping it. */
export function repairTailored(c: TailoredResumeContent, p: CandidateProfile): TailoredResumeContent {
  const all = profileText(p);
  const claimable = claimableSkillKeys(p);
  const experience = c.experience
    .map((e) => {
      const src = p.experience.find((x) => x.id === e.experienceId);
      if (!src) return null;
      return {
        experienceId: src.id, company: src.company, designation: src.designation, period: periodOf(src),
        bullets: e.bullets.filter((b) => isGroundedBullet(b, experienceFacts(src), all).ok),
      };
    })
    .filter((e): e is NonNullable<typeof e> => Boolean(e));
  const summaryIssues = checkClaims(`${c.headline}. ${c.summary}`, p, "summary").filter((i) => i.severity === "error");
  return {
    headline: c.headline,
    summary: summaryIssues.length ? p.summary || "" : c.summary,
    experience,
    skills: c.skills.filter((s) => claimable.has(normalizeSkillKey(s))),
    education: c.education.filter((e) => p.education.some((x) => norm(x.institution) === norm(e.institution) && norm(x.degree) === norm(e.degree))),
    certifications: c.certifications.filter((n) => p.certifications.some((x) => norm(x.name) === norm(n))),
    projects: c.projects.filter((pr) => p.projects.some((x) => norm(x.title) === norm(pr.title) && overlap(tokens(pr.description), tokens(x.description)) >= 0.6)),
  };
}

// ---------------- deterministic tailoring (works with no AI) ----------------

export function deterministicTailoring(p: CandidateProfile, job: Job): TailoredResumeContent {
  const jobTerms = new Set([...tokenize(job.title), ...job.skills.flatMap((k) => tokenize(k.replace(/_/g, " ")))]);
  const jobSkills = new Set(job.skills);
  const relevance = (text: string) => {
    const t = tokens(text);
    let hit = 0;
    for (const w of jobTerms) if (t.has(w)) hit++;
    const skillHit = extractSkillKeys(text).filter((k) => jobSkills.has(k)).length;
    return hit + skillHit * 2;
  };
  const recentFirst = [...p.experience].sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0) || (b.startDate || "").localeCompare(a.startDate || ""));
  const experience = recentFirst.map((e, idx) => {
    const facts = experienceFacts(e).sort((a, b) => relevance(b) - relevance(a));
    return { experienceId: e.id, company: e.company, designation: e.designation, period: periodOf(e), bullets: facts.slice(0, idx < 3 ? 5 : 2) };
  });
  const claimable = [...p.skills].filter((s) => s.source !== "ai_derived").sort((a, b) => Number(jobSkills.has(b.key)) - Number(jobSkills.has(a.key)) || b.confidence - a.confidence);
  const skills = claimable.slice(0, 20).map((s) => s.name);
  const companies = [...new Set(p.experience.map((e) => e.company).filter(Boolean))].slice(0, 3);
  const topSkills = claimable.filter((s) => jobSkills.has(s.key)).slice(0, 5).map((s) => s.name);
  const summary = p.summary && p.provenance.summary !== "ai_derived"
    ? p.summary
    : [
        `${p.currentRole || "Professional"}${p.totalExperienceYears ? ` with ${Math.floor(p.totalExperienceYears)} years of experience` : ""}${companies.length ? ` at ${companies.join(", ")}` : ""}.`,
        topSkills.length ? `Skilled in ${topSkills.join(", ")}.` : "",
      ].filter(Boolean).join(" ");
  return {
    headline: p.currentRole || job.title, summary,
    experience,
    skills,
    education: p.education.map((e) => ({ degree: e.degree, institution: e.institution, gradYear: e.gradYear })),
    certifications: p.certifications.map((c) => c.name),
    projects: [...p.projects].sort((a, b) => relevance(b.description) - relevance(a.description)).slice(0, 2).map((x) => ({ title: x.title, description: x.description })),
  };
}

// ---------------- AI tailoring ----------------

const AiTailored = z.object({
  headline: z.string().catch(""),
  summary: z.string().catch(""),
  experience: z.array(z.object({ experienceId: z.string(), bullets: z.array(z.string()).catch([]) })).catch([]),
  skills: z.array(z.string()).catch([]),
  projects: z.array(z.object({ title: z.string(), description: z.string() })).catch([]),
});

async function aiTailoring(uid: string, p: CandidateProfile, job: Job, match: JobMatch | null): Promise<TailoredResumeContent> {
  const facts = {
    currentRole: p.currentRole, totalExperienceYears: p.totalExperienceYears, summary: p.summary,
    experience: p.experience.map((e) => ({ experienceId: e.id, company: e.company, designation: e.designation, period: periodOf(e), facts: experienceFacts(e) })),
    verifiedSkills: p.skills.filter((s) => s.source !== "ai_derived").map((s) => s.name),
    projects: p.projects.map((x) => ({ title: x.title, description: x.description })),
  };
  const prompt = `Tailor this candidate's resume for the job. You may ONLY reorder, select and lightly rephrase the candidate's verified facts.
STRICT RULES:
- Never add skills, tools, employers, titles, dates, numbers, certifications, projects or responsibilities that are not in CANDIDATE FACTS.
- Every bullet must restate a fact from the same role's "facts" list (keep any numbers exactly). Choose the 3-5 most relevant per role; put the most relevant first.
- "skills" must be chosen only from verifiedSkills, most relevant to the job first.
- Summary: 2-3 sentences using only verified facts; do not claim more years than ${Math.ceil(p.totalExperienceYears)}.
Return JSON: {"headline":"","summary":"","experience":[{"experienceId":"","bullets":[""]}],"skills":[""],"projects":[{"title":"","description":""}]}

CANDIDATE FACTS:
${JSON.stringify(facts)}

JOB (${match ? `current match ${match.score}%, gaps: ${match.gaps.slice(0, 3).join("; ")}` : "no match info"}):
${fenceUntrusted("job_posting", `${job.title} at ${job.company}\n${job.description}`, 5000)}`;
  const r = await generateJSON({ task: "resume_tailor", uid, system: `You are a careful resume editor who never fabricates. ${UNTRUSTED_NOTICE}`, prompt, schema: AiTailored, cache: false, maxTokens: 4000 });
  const bullets = new Map(r.experience.map((e) => [e.experienceId, e.bullets]));
  return {
    headline: r.headline || p.currentRole,
    summary: r.summary,
    experience: [...p.experience]
      .sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0) || (b.startDate || "").localeCompare(a.startDate || ""))
      .map((e) => ({ experienceId: e.id, company: e.company, designation: e.designation, period: periodOf(e), bullets: bullets.get(e.id) || [] })),
    skills: r.skills,
    education: p.education.map((e) => ({ degree: e.degree, institution: e.institution, gradYear: e.gradYear })),
    certifications: p.certifications.map((c) => c.name),
    projects: r.projects,
  };
}

export function renderResumeText(p: CandidateProfile, c: TailoredResumeContent): string {
  const contact = [p.email, p.phone, [p.city, p.state].filter(Boolean).join(", "), p.links.linkedin, p.links.github].filter(Boolean).join(" | ");
  const lines = [p.fullName.toUpperCase(), c.headline, contact, "", "SUMMARY", c.summary, ""];
  if (c.skills.length) lines.push("SKILLS", c.skills.join(", "), "");
  if (c.experience.length) {
    lines.push("EXPERIENCE");
    for (const e of c.experience) lines.push(`${e.designation} — ${e.company} (${e.period})`, ...e.bullets.map((b) => `• ${b}`), "");
  }
  if (c.projects.length) lines.push("PROJECTS", ...c.projects.map((x) => `${x.title}: ${x.description}`), "");
  if (c.education.length) lines.push("EDUCATION", ...c.education.map((e) => `${e.degree}, ${e.institution}${e.gradYear ? ` (${e.gradYear})` : ""}`), "");
  if (c.certifications.length) lines.push("CERTIFICATIONS", ...c.certifications, "");
  return lines.join("\n").trim();
}

export async function generateTailoredResume(uid: string, profile: CandidateProfile, job: Job, match: JobMatch | null): Promise<ResumeVersion> {
  let content: TailoredResumeContent;
  let by: ResumeVersion["generatedBy"] = "deterministic";
  let validation = { ok: false, issues: [] as ValidationIssue[] };

  try {
    const draft = await aiTailoring(uid, profile, job, match);
    let v = validateTailored(draft, profile);
    let candidate = draft;
    if (!v.ok) {
      candidate = repairTailored(draft, profile);
      v = validateTailored(candidate, profile);
      v.issues = [...v.issues, { severity: "warning", path: "generation", message: "Some AI-generated content was removed because it couldn't be verified against your profile" }];
    }
    if (v.ok && candidate.experience.some((e) => e.bullets.length) || (!profile.experience.length && v.ok)) {
      content = candidate; validation = v; by = "ai";
    } else throw new Error("AI output unusable after validation");
  } catch (err: any) {
    if (err?.name !== "AiUnavailableError" && err?.name !== "AiQuotaError") console.warn("[tailor] falling back to deterministic:", String(err?.message).slice(0, 120));
    content = deterministicTailoring(profile, job);
    validation = validateTailored(content, profile);
    by = "deterministic";
  }

  const version: ResumeVersion = {
    id: `rv_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`, uid, jobId: job.id, type: "tailored", content, text: renderResumeText(profile, content),
    validation, approved: false, generatedBy: by, createdAt: new Date().toISOString(),
  };
  await (await getStore()).put("resumeVersions", version.id, version);
  await audit(uid, "resume.tailored", { jobId: job.id, versionId: version.id, generatedBy: by, ok: validation.ok, issues: validation.issues.length }, "system");
  await notify(uid, { kind: "resume_ready", title: "Tailored resume ready", body: `Review and approve your resume for ${job.title} at ${job.company}.`, jobId: job.id });
  return version;
}

export async function approveResumeVersion(uid: string, id: string, edited?: TailoredResumeContent): Promise<ResumeVersion | null> {
  const store = await getStore();
  const v = await store.get<ResumeVersion>("resumeVersions", id);
  if (!v || v.uid !== uid) return null;
  const profile = (await store.get<CandidateProfile>("profiles", uid))!;
  let next = { ...v };
  if (edited) {
    const validation = validateTailored(edited, profile);
    if (!validation.ok) return { ...v, validation, approved: false }; // never approve invalid content
    next = { ...v, content: edited, text: renderResumeText(profile, edited), validation, type: "user_edited", generatedBy: "user" };
  }
  if (!next.validation.ok) return { ...next, approved: false };
  next.approved = true;
  await store.put("resumeVersions", id, next);
  await audit(uid, "resume.approved", { versionId: id });
  return next;
}

const CoverSchema = z.object({ coverLetter: z.string().min(50).max(3000) });

export async function generateCoverLetter(uid: string, p: CandidateProfile, job: Job): Promise<{ text: string; validation: { ok: boolean; issues: ValidationIssue[] }; generatedBy: "ai" | "deterministic" }> {
  const top = [...p.skills].filter((s) => s.source !== "ai_derived" && job.skills.includes(s.key)).slice(0, 4).map((s) => s.name);
  const latest = p.experience.find((e) => e.current) || p.experience[0];
  const fallback = [
    `Dear Hiring Team at ${job.company},`, "",
    `I am writing to apply for the ${job.title} position. ${p.totalExperienceYears ? `I bring ${Math.floor(p.totalExperienceYears)} years of experience` : "I bring relevant experience"}${latest ? `, most recently as ${latest.designation} at ${latest.company}` : ""}.`,
    top.length ? `My background includes ${top.join(", ")}, which aligns with the requirements of this role.` : "", "",
    "I would welcome the opportunity to discuss how I can contribute to your team.", "", "Sincerely,", p.fullName,
  ].filter((l, i, arr) => l !== "" || arr[i - 1] !== "").join("\n");
  try {
    const facts = { name: p.fullName, currentRole: p.currentRole, years: p.totalExperienceYears, latest: latest && { company: latest.company, designation: latest.designation, facts: experienceFacts(latest).slice(0, 6) }, skills: p.skills.filter((s) => s.source !== "ai_derived").map((s) => s.name) };
    const r = await generateJSON({
      task: "cover_letter", uid, cache: false, schema: CoverSchema, maxTokens: 900,
      system: `You write concise, honest cover letters (150-220 words). Use ONLY the candidate facts provided. Never invent skills, employers, numbers or achievements. ${UNTRUSTED_NOTICE}`,
      prompt: `Candidate facts: ${JSON.stringify(facts)}\n\nJob:\n${fenceUntrusted("job_posting", `${job.title} at ${job.company}\n${job.description}`, 4000)}\n\nReturn {"coverLetter": "..."}`,
    });
    const issues = checkClaims(r.coverLetter, p, "coverLetter").filter((i) => i.message.indexOf(job.company) === -1);
    if (issues.some((i) => i.severity === "error")) throw new Error("cover letter failed validation");
    return { text: r.coverLetter, validation: { ok: true, issues }, generatedBy: "ai" };
  } catch {
    return { text: fallback, validation: { ok: true, issues: [] }, generatedBy: "deterministic" };
  }
}

export { generateText };
