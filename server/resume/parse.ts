import { z } from "zod";
import crypto from "node:crypto";
import type { CandidateProfile, CertificationEntry, EducationEntry, ExperienceEntry, ProjectEntry, SkillEntry, Source } from "../../shared/types.js";
import { generateJSON } from "../ai/gateway.js";
import { categoryOf, displayName, extractSkillKeys, keyOf, normalizeSkillKey, roleFamily, detectSeniority, seniorityRank } from "../nlp/skills.js";
import { UNTRUSTED_NOTICE, fenceUntrusted } from "../nlp/text.js";
import { MONTH_WORDS, isPresent, totalExperienceYears } from "./dates.js";

export type ParsedResume = Pick<
  CandidateProfile,
  | "fullName" | "email" | "phone" | "city" | "state" | "country" | "links" | "currentRole" | "summary"
  | "experience" | "skills" | "education" | "certifications" | "projects" | "insights" | "totalExperienceYears"
> & { provenance: Record<string, Source>; parsedBy: "ai" | "deterministic" };

const uid8 = () => crypto.randomBytes(4).toString("hex");

const SECTION_HEADINGS: Record<string, RegExp> = {
  summary: /^(professional\s+)?(summary|profile|objective|about( me)?|career objective)$/i,
  experience: /^(work|professional|employment|relevant)?\s*(experience|history)|^career (history|summary)$|^employment( details)?$/i,
  education: /^(education|academic|qualifications?|academics)( details| background)?$/i,
  skills: /^(technical |key |core |professional )?(skills|competencies|expertise|technologies|tools)( & tools| summary)?$/i,
  projects: /^(academic |key |personal )?projects?( experience)?$/i,
  certifications: /^(certifications?|licenses?|courses|training)( & certifications?)?$/i,
  other: /^(achievements?|awards?|honou?rs|interests|hobbies|languages|references|declaration|personal (details|information)|publications)$/i,
};

function splitSections(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = { header: [] };
  let cur = "header";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const plain = line.replace(/[:\-–_=*#]+$/g, "").replace(/^[*#\-–=_\s]+/, "").trim();
    let matched: string | null = null;
    if (plain && plain.length <= 40) for (const [name, re] of Object.entries(SECTION_HEADINGS)) if (re.test(plain)) { matched = name; break; }
    if (matched) {
      cur = matched;
      out[cur] ||= [];
      continue;
    }
    (out[cur] ||= []).push(line);
  }
  return out;
}

const DATE_TOKEN = `(?:(?:${MONTH_WORDS})\\.?\\s*['’]?\\s*\\d{2,4}|\\d{1,2}[/-]\\d{4}|\\d{4}[/-]\\d{1,2}|\\d{4})`;
const RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(?:-|–|—|to|until|till)\\s*(${DATE_TOKEN}|present|current|till date|to date|now|ongoing)`, "i");
const TITLE_WORDS = /\b(manager|engineer|developer|lead|analyst|architect|consultant|director|head|specialist|executive|officer|administrator|designer|scientist|associate|intern|trainee|coordinator|programmer|tester|owner|scrum master|president|supervisor|assistant|founder)\b/i;
const BULLET = /^[\s•●▪■◦○\-–*·►➢✓✔]+/;

function parseExperienceDeterministic(lines: string[]): ExperienceEntry[] {
  const out: ExperienceEntry[] = [];
  const idxs: number[] = [];
  lines.forEach((l, i) => RANGE_RE.test(l) && !BULLET.test(l) && idxs.push(i));
  idxs.forEach((lineIdx, n) => {
    const line = lines[lineIdx];
    const range = RANGE_RE.exec(line)!;
    const nextIdx = idxs[n + 1] ?? lines.length;
    const prevIdx = n === 0 ? -1 : idxs[n - 1];
    // header text: the range line minus dates, plus up to two non-empty non-bullet lines directly above it (after previous entry's body)
    const inline = line.replace(RANGE_RE, " ").replace(/[()|,]+\s*$/g, "").replace(/^[\s|,\-–()]+|[\s|,\-–()]+$/g, "").trim();
    const above: string[] = [];
    for (let k = lineIdx - 1; k > prevIdx && above.length < 2; k--) {
      const t = lines[k].trim();
      if (!t) { if (above.length) break; else continue; }
      if (BULLET.test(lines[k]) || t.length > 90) break;
      above.unshift(t);
    }
    const headerParts = [...above, ...(inline ? [inline] : [])].flatMap((p) => p.split(/\s+\|\s+|\s+@\s+|\s+at\s+|\s+[-–—]\s+|,\s+(?=[A-Z])/)).map((p) => p.trim()).filter(Boolean);
    let designation = headerParts.find((p) => TITLE_WORDS.test(p)) || "";
    let company = headerParts.find((p) => p !== designation && !TITLE_WORDS.test(p)) || headerParts.find((p) => p !== designation) || "";
    if (!designation && headerParts.length) designation = headerParts[0];
    if (company === designation) company = "";
    // body: until next entry's header lines
    const bodyEnd = n + 1 < idxs.length ? Math.max(lineIdx + 1, nextIdx - 2) : nextIdx;
    const bullets = lines
      .slice(lineIdx + 1, bodyEnd)
      .map((l) => l.replace(BULLET, "").trim())
      .filter((l) => l.length > 15);
    const end = range[2];
    const current = isPresent(end);
    const achievements = bullets.filter((b) => /\d+\s*%|\d+\+?\s*(x|users|clients|projects|members|people|crore|lakh|k\b|m\b)|₹|\$|increased|reduced|saved|improved|achieved|delivered|won|awarded|grew|boosted/i.test(b));
    const responsibilities = bullets.filter((b) => !achievements.includes(b));
    const bodyText = bullets.join(" ");
    out.push({
      id: `exp_${uid8()}`,
      company,
      designation,
      startDate: range[1].trim(),
      endDate: current ? "present" : end.trim(),
      current,
      responsibilities: responsibilities.slice(0, 12),
      achievements: achievements.slice(0, 8),
      tools: extractSkillKeys(bodyText).map((k) => displayName(k)).slice(0, 15),
    });
  });
  return out.filter((e) => e.company || e.designation);
}

const EDU_RE = /\b(b\.?\s?tech|b\.?\s?e\b|b\.?\s?sc|b\.?\s?com|b\.?\s?a\b|b\.?\s?c\.?\s?a|bba|m\.?\s?tech|m\.?\s?e\b|m\.?\s?sc|m\.?\s?com|mba|m\.?\s?c\.?\s?a|pgdm|ph\.?\s?d|diploma|bachelor|master|doctorate|10th|12th|hsc|ssc)\b/i;

function parseEducationDeterministic(lines: string[]): EducationEntry[] {
  const out: EducationEntry[] = [];
  const clean = lines.map((l) => l.replace(BULLET, "").trim()).filter(Boolean);
  for (let i = 0; i < clean.length; i++) {
    const l = clean[i];
    if (!EDU_RE.test(l)) continue;
    const year = l.match(/\b(19|20)\d{2}\b/g)?.pop() || clean[i + 1]?.match(/\b(19|20)\d{2}\b/)?.[0] || clean[i - 1]?.match(/\b(19|20)\d{2}\b/)?.[0];
    const inst = [clean[i + 1], clean[i - 1], l].find((x) => x && /(university|institute|college|school|iit|nit|academy|polytechnic)/i.test(x)) || "";
    const degree = l.replace(/\b(19|20)\d{2}\b/g, "").replace(inst, "").replace(/[|,–-]+\s*$/g, "").trim();
    if (degree && degree.length < 120 && !out.some((e) => e.degree === degree))
      out.push({ id: `edu_${uid8()}`, degree, institution: inst.replace(/\b(19|20)\d{2}\b/g, "").trim(), gradYear: year });
  }
  return out.slice(0, 6);
}

const CITIES = [
  "Bengaluru", "Bangalore", "Hyderabad", "Chennai", "Mumbai", "Pune", "Delhi", "New Delhi", "Gurgaon", "Gurugram", "Noida", "Kolkata",
  "Ahmedabad", "Jaipur", "Kochi", "Coimbatore", "Chandigarh", "Indore", "Trivandrum", "Thiruvananthapuram", "Nagpur", "Lucknow", "Mysore", "Mysuru", "Bhubaneswar", "Vadodara", "Surat", "Visakhapatnam", "Madurai",
];

function parseHeader(text: string) {
  const head = text.split("\n").slice(0, 25).join("\n");
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const phone = head.match(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/)?.[0]?.replace(/\s+/g, " ").trim() || head.match(/\+\d{1,3}[\s-]?\d{6,12}/)?.[0] || "";
  const linkedin = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+/i)?.[0];
  const github = text.match(/(?:https?:\/\/)?github\.com\/[A-Za-z0-9_-]+/i)?.[0];
  const portfolio = text.match(/https?:\/\/(?!(?:www\.)?(?:linkedin|github)\.)[^\s)]+/i)?.[0];
  const city = CITIES.find((c) => new RegExp(`\\b${c}\\b`, "i").test(head)) || "";
  let fullName = "";
  for (const line of head.split("\n").slice(0, 8)) {
    const t = line.trim();
    if (!t || t.length > 50 || /@|http|\d{5}|resume|curriculum|vitae|profile|contact/i.test(t)) continue;
    const words = t.split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Za-z.'-]+$/.test(w)) && words.some((w) => /^[A-Z]/.test(w))) {
      fullName = t.replace(/\b([A-Z]{2,})\b/g, (m) => m[0] + m.slice(1).toLowerCase());
      break;
    }
  }
  return { email, phone, linkedin, github, portfolio, city, fullName };
}

function deterministicParse(text: string): ParsedResume {
  const sections = splitSections(text);
  const hdr = parseHeader(text);
  const experience = parseExperienceDeterministic(sections.experience || []);
  const education = parseEducationDeterministic(sections.education || []);
  const skillKeys = extractSkillKeys(text);
  const skills: SkillEntry[] = skillKeys.map((k) => ({ name: displayName(k), key: k, category: categoryOf(k), source: "resume", confidence: 0.85 }));
  const currentRole = experience.find((e) => e.current)?.designation || experience[0]?.designation || "";
  const certifications: CertificationEntry[] = (sections.certifications || [])
    .map((l) => l.replace(BULLET, "").trim())
    .filter((l) => l.length > 3 && l.length < 120)
    .slice(0, 10)
    .map((name) => ({ id: `cert_${uid8()}`, name, year: name.match(/\b(19|20)\d{2}\b/)?.[0] }));
  const summary = (sections.summary || []).join(" ").trim().slice(0, 800);
  const total = totalExperienceYears(experience);
  const provenance: Record<string, Source> = {};
  for (const [k, v] of Object.entries({ fullName: hdr.fullName, email: hdr.email, phone: hdr.phone, city: hdr.city, currentRole, summary }))
    if (v) provenance[k] = "resume";
  return {
    fullName: hdr.fullName, email: hdr.email, phone: hdr.phone, city: hdr.city, state: "", country: hdr.city ? "India" : "",
    links: { linkedin: hdr.linkedin, github: hdr.github, portfolio: hdr.portfolio },
    currentRole, summary, totalExperienceYears: total, experience, skills, education, certifications, projects: [],
    insights: deriveInsights(currentRole, total, experience),
    provenance, parsedBy: "deterministic",
  };
}

export function deriveInsights(currentRole: string, years: number, experience: ExperienceEntry[]): ParsedResume["insights"] {
  const level: ParsedResume["insights"]["careerLevel"] =
    years < 1 ? "fresher" : years < 3 ? "junior" : years < 7 ? "mid" : seniorityRank(detectSeniority(currentRole)) >= 4 ? "lead" : "senior";
  const families = [...new Set([currentRole, ...experience.map((e) => e.designation)].filter(Boolean).map(roleFamily).filter((f) => f !== "other"))];
  return { careerLevel: level, jobFamilies: families.slice(0, 4), targetRoleSuggestions: currentRole ? [currentRole] : [] };
}

// ---------------- AI extraction ----------------

const str = z.string().catch("");
const strArr = z.array(z.string()).catch([]);
const AiResume = z.object({
  fullName: str, email: str, phone: str, city: str, state: str, country: str,
  links: z.object({ linkedin: str, github: str, portfolio: str }).partial().catch({}),
  currentRole: str, summary: str,
  experience: z.array(z.object({
    company: str, designation: str, location: str, startDate: str, endDate: str,
    current: z.boolean().catch(false), responsibilities: strArr, achievements: strArr, tools: strArr,
  })).catch([]),
  skills: z.array(z.union([z.string(), z.object({ name: z.string() })])).catch([]),
  education: z.array(z.object({ degree: str, specialization: str, institution: str, gradYear: str })).catch([]),
  certifications: z.array(z.object({ name: str, provider: str, year: str })).catch([]),
  projects: z.array(z.object({ title: str, description: str, tools: strArr })).catch([]),
  derived: z.object({
    careerLevel: z.enum(["fresher", "junior", "mid", "senior", "lead", "executive"]).catch("mid"),
    jobFamilies: strArr,
    targetRoleSuggestions: strArr,
  }).partial().catch({}),
});

const SYSTEM = `You are a precise resume parser. Extract ONLY what is explicitly written in the resume. Never guess, infer, or invent. Use "" or [] when something is absent. Copy dates exactly as written (e.g. "Jan 2020", "2019", "Present"). Keep bullet text faithful to the resume. ${UNTRUSTED_NOTICE}`;

async function aiParse(uid: string, text: string): Promise<z.infer<typeof AiResume>> {
  const prompt = `Parse the resume below into JSON with this shape:
{"fullName","email","phone","city","state","country","links":{"linkedin","github","portfolio"},"currentRole","summary",
"experience":[{"company","designation","location","startDate","endDate","current":bool,"responsibilities":[],"achievements":[],"tools":[]}],
"skills":["..."],"education":[{"degree","specialization","institution","gradYear"}],"certifications":[{"name","provider","year"}],
"projects":[{"title","description","tools":[]}],
"derived":{"careerLevel":"fresher|junior|mid|senior|lead|executive","jobFamilies":[],"targetRoleSuggestions":[]}}
"derived" is your inference and is the only place you may infer. Everything else must be present in the text.

${fenceUntrusted("resume", text, 14000)}`;
  return generateJSON({ task: "resume_extract", uid, system: SYSTEM, prompt, schema: AiResume, maxTokens: 6000 });
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function parseResume(uid: string, text: string): Promise<ParsedResume> {
  const det = deterministicParse(text);
  let ai: z.infer<typeof AiResume> | null = null;
  try {
    ai = await aiParse(uid, text);
  } catch (err: any) {
    console.warn(`[resume] AI parse unavailable, using deterministic parse: ${String(err?.message).slice(0, 120)}`);
  }
  if (!ai) return det;

  const textNorm = norm(text);
  const grounded = (v: string) => !v || textNorm.includes(norm(v));
  const provenance: Record<string, Source> = { ...det.provenance };
  const pick = (field: string, aiVal: string, detVal: string) => {
    const v = aiVal && grounded(aiVal) ? aiVal : detVal || "";
    if (v) provenance[field] = "resume";
    return v;
  };

  // Experience: AI structure, but every company must appear in the resume text; otherwise fall back to deterministic.
  const aiExp: ExperienceEntry[] = ai.experience
    .filter((e) => (e.company || e.designation) && grounded(e.company))
    .map((e) => ({
      id: `exp_${uid8()}`, company: e.company, designation: e.designation, location: e.location || undefined,
      startDate: e.startDate || undefined, endDate: isPresent(e.endDate) || e.current ? "present" : e.endDate || undefined,
      current: e.current || isPresent(e.endDate), responsibilities: e.responsibilities.slice(0, 15), achievements: e.achievements.slice(0, 10), tools: e.tools.slice(0, 20),
    }));
  const experience = aiExp.length >= det.experience.length || !det.experience.length ? aiExp : det.experience;

  // Skills: resume-grounded => source "resume"; otherwise "ai_derived" (never used on generated resumes).
  const skillMap = new Map<string, SkillEntry>();
  for (const s of det.skills) skillMap.set(s.key, s);
  for (const raw of ai.skills) {
    const name = (typeof raw === "string" ? raw : raw.name).trim();
    if (!name || name.length > 60) continue;
    const key = normalizeSkillKey(name);
    if (skillMap.has(key)) continue;
    const isGrounded = textNorm.includes(norm(name));
    skillMap.set(key, { name: displayName(key, name), key, category: categoryOf(key), source: isGrounded ? "resume" : "ai_derived", confidence: isGrounded ? 0.8 : 0.4 });
  }

  const education: EducationEntry[] = (ai.education.length ? ai.education : []).filter((e) => e.degree || e.institution).map((e) => ({
    id: `edu_${uid8()}`, degree: e.degree, specialization: e.specialization || undefined, institution: e.institution, gradYear: e.gradYear || undefined,
  }));
  const certifications: CertificationEntry[] = ai.certifications.filter((c) => c.name && grounded(c.name)).map((c) => ({ id: `cert_${uid8()}`, name: c.name, provider: c.provider || undefined, year: c.year || undefined }));
  const projects: ProjectEntry[] = ai.projects.filter((p) => p.title).map((p) => ({ id: `proj_${uid8()}`, title: p.title, description: p.description, tools: p.tools }));

  const total = totalExperienceYears(experience);
  const currentRole = pick("currentRole", ai.currentRole, det.currentRole) || experience.find((e) => e.current)?.designation || experience[0]?.designation || "";
  const derived = deriveInsights(currentRole, total, experience);
  const insights = {
    careerLevel: derived.careerLevel, // computed from verified years, not the model's opinion
    jobFamilies: [...new Set([...derived.jobFamilies, ...(ai.derived.jobFamilies || []).map(keyOf)])].slice(0, 5),
    targetRoleSuggestions: [...new Set([...(ai.derived.targetRoleSuggestions || []), ...derived.targetRoleSuggestions])].slice(0, 5),
  };
  provenance.insights = "ai_derived";

  return {
    fullName: pick("fullName", ai.fullName, det.fullName),
    email: pick("email", ai.email, det.email),
    phone: pick("phone", ai.phone, det.phone),
    city: pick("city", ai.city, det.city),
    state: ai.state || "",
    country: ai.country || det.country,
    links: { linkedin: ai.links.linkedin || det.links.linkedin, github: ai.links.github || det.links.github, portfolio: ai.links.portfolio || det.links.portfolio },
    currentRole,
    summary: pick("summary", ai.summary, det.summary),
    totalExperienceYears: total,
    experience, skills: [...skillMap.values()], education: education.length ? education : det.education,
    certifications: certifications.length ? certifications : det.certifications, projects, insights, provenance, parsedBy: "ai",
  };
}

export { deterministicParse };
