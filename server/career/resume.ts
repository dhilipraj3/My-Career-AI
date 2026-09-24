// Resume builder (facts from the profile only — nothing invented) and Resume Health (an ATS-style check out of 100
// with specific fixes).
import type { CandidateProfile, ExperienceEntry } from "../../shared/types.js";
import type { BuiltResume, ResumeCheck, ResumeHealth } from "../../shared/career.js";
import { displayName } from "../nlp/skills.js";
import { searchJobs } from "../search/index.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(d?: string): string {
  if (!d) return "";
  if (/^present$/i.test(d)) return "Present";
  const m = /^(\d{4})-(\d{1,2})$/.exec(d);
  return m ? `${MONTHS[Number(m[2]) - 1] || ""} ${m[1]}`.trim() : d;
}
const period = (e: ExperienceEntry) => [fmtDate(e.startDate), e.current ? "Present" : fmtDate(e.endDate)].filter(Boolean).join(" – ");
const years = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(1));

/** Skills the person can claim: from their resume or told us themselves (never AI guesses). */
const claimable = (p: CandidateProfile) => p.skills.filter((s) => s.source === "resume" || s.source === "user");

export function buildResume(p: CandidateProfile): BuiltResume {
  const skills = claimable(p);
  const hard = skills.filter((s) => s.category !== "soft").map((s) => s.name);
  const soft = skills.filter((s) => s.category === "soft").map((s) => s.name);
  const role = p.preferences.targetRoles[0] || p.currentRole;
  const recent = p.experience.find((e) => e.current) || p.experience[0];
  const fresher = p.insights.careerLevel === "fresher" || (!p.experience.length && !p.totalExperienceYears);
  let summary = p.summary?.trim() || "";
  if (!summary) {
    const bits: string[] = [];
    if (fresher) bits.push(`${p.education[0]?.degree ? `${p.education[0].degree} graduate` : "Motivated fresher"}${role ? ` looking for ${role} roles` : ""}.`);
    else bits.push(`${p.currentRole || role || "Professional"} with ${years(p.totalExperienceYears)} years of experience${recent?.company ? `, most recently at ${recent.company}` : ""}.`);
    if (hard.length) bits.push(`Skilled in ${hard.slice(0, 6).join(", ")}.`);
    summary = bits.join(" ");
  }
  return {
    name: p.fullName || "Your Name",
    headline: [role, p.totalExperienceYears ? `${years(p.totalExperienceYears)} years` : fresher ? "Fresher" : ""].filter(Boolean).join(" · "),
    contact: [p.email, p.phone, [p.city, p.state].filter(Boolean).join(", "), p.links.linkedin, p.links.github, p.links.portfolio].filter((x): x is string => Boolean(x)),
    summary,
    experience: p.experience.map((e) => ({
      title: e.designation, company: e.company, period: period(e), location: e.location,
      bullets: [...e.achievements, ...e.responsibilities].map((b) => b.trim()).filter(Boolean).slice(0, 6),
    })),
    skills: [...hard, ...soft].slice(0, 22),
    education: p.education.map((e) => ({ degree: [e.degree, e.specialization].filter(Boolean).join(", "), institution: e.institution, year: e.gradYear })),
    certifications: p.certifications.map((c) => [c.name, c.provider, c.year].filter(Boolean).join(" · ")),
    projects: p.projects.map((x) => ({ title: x.title, description: x.description })),
  };
}

const STRONG = /^(led|managed|built|delivered|reduced|increased|designed|developed|handled|trained|sold|resolved|implemented|created|improved|achieved|coordinated|launched|owned|analy[sz]ed|prepared|operated|maintained|repaired|installed|automated|negotiated|mentored|planned|streamlined|served|supervised|drove|grew|won|cut|saved|executed|organised|organized|established|introduced|migrated|optimi[sz]ed|audited|processed|supported|tested|wrote|taught|guided|closed|generated|scheduled|monitored|configured|deployed)\b/i;
const WEAK = /^(responsible for|worked on|involved in|duties included|helped|assisted in|handling of|part of)\b/i;
const NUMBER = /\d|₹|%|\blakh|\bcrore/i;

async function roleKeywords(role: string): Promise<string[]> {
  if (!role) return [];
  const r = await searchJobs("__public__", { q: role, pageSize: 50, sort: "relevance" });
  const counts = new Map<string, number>();
  for (const { job } of r.hits) for (const s of job.skills) counts.set(s, (counts.get(s) || 0) + 1);
  return [...counts.entries()].filter(([, n]) => n >= Math.max(2, r.hits.length * 0.15)).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k);
}

export async function resumeHealth(p: CandidateProfile): Promise<ResumeHealth> {
  const built = buildResume(p);
  const checks: ResumeCheck[] = [];
  const add = (id: string, label: string, max: number, ratio: number, fix?: string) => {
    const r = Math.max(0, Math.min(1, ratio));
    checks.push({ id, label, max, points: Math.round(max * r), ok: r >= 0.999, fix: r >= 0.999 ? undefined : fix });
  };
  const fresher = p.insights.careerLevel === "fresher" || (!p.experience.length && !p.totalExperienceYears);

  add("contact", "Email and phone number", 10, (p.email ? 0.5 : 0) + (p.phone ? 0.5 : 0), !p.phone ? "Add your phone number — recruiters in India call first." : "Add your email address.");
  add("summary", "A short summary about you", 10, (p.summary || "").trim().length >= 60 ? 1 : 0.5, "Write 2–3 lines on what you're great at and the role you want (I've drafted one from your profile).");
  if (fresher) add("history", "Education and projects", 15, (p.education.length ? 0.6 : 0) + (p.projects.length || claimable(p).length >= 5 ? 0.4 : 0), p.education.length ? "Add a project, internship or training — it shows what you can do." : "Add your education.");
  else add("history", "Work history with dates", 15, p.experience.length ? p.experience.filter((e) => e.startDate).length / p.experience.length : 0, p.experience.length ? "Add start and end dates to every job." : "Add your work history (company, role, dates).");

  const bullets = built.experience.flatMap((e) => e.bullets);
  if (!fresher) {
    const withEnough = built.experience.filter((e) => e.bullets.length >= 3).length;
    add("bullets", "At least 3 points per job", 10, built.experience.length ? withEnough / built.experience.length : 0, "Describe each job in 3–5 short points: what you did and what changed because of you.");
    const quantified = bullets.filter((b) => NUMBER.test(b)).length;
    add("numbers", "Results with numbers", 15, bullets.length ? quantified / Math.max(1, Math.ceil(bullets.length * 0.3)) : 0,
      `Add numbers to ${Math.max(1, Math.ceil(bullets.length * 0.3) - quantified)} more point${Math.ceil(bullets.length * 0.3) - quantified === 1 ? "" : "s"} — team size, %, ₹, customers, time saved.`);
    const strong = bullets.filter((b) => STRONG.test(b)).length;
    const weak = bullets.filter((b) => WEAK.test(b));
    add("verbs", "Points start with action words", 10, bullets.length ? strong / Math.max(1, Math.ceil(bullets.length * 0.6)) : 0,
      weak.length ? `Start points with a verb (Led, Built, Reduced…) instead of "${weak[0].split(" ").slice(0, 3).join(" ")}…".` : "Start each point with an action word: Led, Built, Reduced, Delivered…");
  } else {
    add("bullets", "Projects or training described", 10, p.projects.length ? 1 : 0, "Add one or two projects with a line on what you did.");
    add("numbers", "Achievements (marks, awards, results)", 15, /\d/.test(p.projects.map((x) => x.description).join(" ") + p.education.map((e) => e.degree).join(" ")) ? 1 : 0.4, "Add a result: a percentage, rank, award or something you completed.");
    add("verbs", "Clear, active wording", 10, 1);
  }
  const hard = claimable(p).filter((s) => s.category !== "soft");
  add("skills", "At least 8 relevant skills", 10, hard.length / 8, `Add ${Math.max(1, 8 - hard.length)} more skill${8 - hard.length === 1 ? "" : "s"} you really have.`);

  const role = p.preferences.targetRoles[0] || p.currentRole;
  const keywords = await roleKeywords(role).catch(() => []);
  const have = new Set(claimable(p).map((s) => s.key));
  const missing = keywords.filter((k) => !have.has(k));
  if (keywords.length) add("keywords", `Keywords employers ask for${role ? ` in ${role} jobs` : ""}`, 15, (keywords.length - missing.length) / Math.max(1, Math.ceil(keywords.length * 0.6)),
    `Employers often ask for: ${missing.slice(0, 5).map((k) => displayName(k)).join(", ")}. Add the ones you've actually used.`);
  else add("keywords", "Keywords employers ask for", 15, hard.length >= 8 ? 1 : hard.length / 8, "Pick a target role so I can check the keywords employers use.");

  const words = [built.summary, ...bullets, ...built.skills, ...built.education.map((e) => e.degree)].join(" ").split(/\s+/).filter(Boolean).length;
  const lengthOk = fresher ? words >= 120 : words >= 250 && words <= 900;
  add("length", "Right length (1–2 pages)", 5, lengthOk ? 1 : 0.4, words < (fresher ? 120 : 250) ? "It's a bit short — add more about your work or projects." : "It's long — keep the most relevant 10–15 years and 3–5 points per job.");

  const score = checks.reduce((s, c) => s + c.points, 0);
  return { score: Math.min(100, score), checks, keywordsMissing: missing.map((k) => displayName(k)).slice(0, 8), targetRole: role || undefined };
}
