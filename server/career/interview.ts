// No resume? Build the profile from a short conversation (typed or spoken, English/Hindi/Hinglish).
// Every fact comes from what the person said (source "user"); the AI only structures and translates it.
import crypto from "node:crypto";
import { z } from "zod";
import type { CandidateProfile, EducationEntry, ExperienceEntry, SkillEntry } from "../../shared/types.js";
import { generateJSON } from "../ai/gateway.js";
import { AppError } from "../applications/service.js";
import { audit } from "../audit.js";
import { findIndianCities } from "../nlp/location.js";
import { categoryOf, displayName, extractSkillKeys, normalizeSkillKey } from "../nlp/skills.js";
import { fenceUntrusted } from "../nlp/text.js";
import { getProfile, saveProfile } from "../profile/service.js";
import { deriveInsights } from "../resume/parse.js";
import type { Lang } from "./understanding.js";

export type InterviewStep = "about" | "skills" | "education" | "work";

const PROMPTS: Record<Lang, Record<InterviewStep, { text: string; hint: string; choices?: string[] }>> = {
  en: {
    about: { text: "Tell me about yourself: what work do you do (or what did you study), and for how long?", hint: "e.g. \"I'm an electrician, 4 years, working in Pune\" or \"Fresher, finished B.Com this year\"" },
    skills: { text: "What are you good at? List your skills, tools, machines or languages.", hint: "e.g. \"wiring, panel repair, reading drawings, Hindi and English\"" },
    education: { text: "What's your highest education?", hint: "Pick one or type it", choices: ["10th", "12th", "ITI", "Diploma", "Graduate", "Post-graduate"] },
    work: { text: "Where have you worked? Company and your role — or say \"fresher\".", hint: "e.g. \"Tata Motors, maintenance technician, 2 years\"" },
  },
  hi: {
    about: { text: "अपने बारे में बताइए: आप क्या काम करते हैं (या क्या पढ़ाई की है), और कितने समय से?", hint: "जैसे \"मैं इलेक्ट्रीशियन हूँ, 4 साल से, पुणे में\" या \"फ्रेशर, इस साल B.Com किया\"" },
    skills: { text: "आप किसमें अच्छे हैं? अपने कौशल, टूल, मशीनें या भाषाएँ बताइए।", hint: "जैसे \"वायरिंग, पैनल रिपेयर, ड्रॉइंग पढ़ना, हिंदी और अंग्रेज़ी\"" },
    education: { text: "आपकी सबसे ऊँची पढ़ाई क्या है?", hint: "एक चुनें या लिखें", choices: ["10th", "12th", "ITI", "Diploma", "Graduate", "Post-graduate"] },
    work: { text: "आपने कहाँ काम किया है? कंपनी और आपका पद — या \"फ्रेशर\" लिखें।", hint: "जैसे \"टाटा मोटर्स, मेंटेनेंस टेक्नीशियन, 2 साल\"" },
  },
};

const ORDER: InterviewStep[] = ["about", "skills", "education", "work"];

/** Which step still needs an answer (null when the conversation has what it needs). */
export function nextStep(p: CandidateProfile, skipped: InterviewStep[] = []): InterviewStep | null {
  const need: Record<InterviewStep, boolean> = {
    about: !p.currentRole && !p.totalExperienceYears && p.insights.careerLevel !== "fresher" && !p.education.length,
    skills: p.skills.filter((s) => s.source !== "ai_derived").length < 3,
    education: !p.education.length,
    work: !p.experience.length && p.totalExperienceYears > 0,
  };
  return ORDER.find((s) => need[s] && !skipped.includes(s)) || null;
}

export function promptFor(step: InterviewStep, lang: Lang = "en") {
  const q = PROMPTS[lang][step];
  return { step, text: q.text, hint: q.hint, choices: q.choices || [] };
}

// ---------------- extraction ----------------
const str = z.string().catch("");
const Facts = z.object({
  fullName: str,
  currentRole: str,
  totalExperienceYears: z.number().min(0).max(60).nullable().catch(null),
  fresher: z.boolean().catch(false),
  city: str,
  skills: z.array(z.string()).catch([]),
  experience: z.array(z.object({ company: str, designation: str, years: z.number().min(0).max(60).nullable().catch(null), current: z.boolean().catch(false) })).catch([]),
  education: z.array(z.object({ degree: str, institution: str, gradYear: str })).catch([]),
  targetRoles: z.array(z.string()).catch([]),
});
type FactsT = z.infer<typeof Facts>;

const SYSTEM = `You turn what a job seeker says about themselves into structured profile facts.
Rules: use ONLY what they actually said; never guess or add anything. They may write or speak in Hindi, Hinglish or English — always output English (translate job titles, skills and degrees into standard English terms, e.g. "बिजली मिस्त्री" → "Electrician"). Leave fields empty ("" / [] / null) when not mentioned.`;

async function aiFacts(uid: string, step: InterviewStep, text: string): Promise<FactsT> {
  const prompt = `The job seeker was asked: "${PROMPTS.en[step].text}"
Return JSON: {"fullName","currentRole","totalExperienceYears":number|null,"fresher":bool,"city","skills":[],"experience":[{"company","designation","years":number|null,"current":bool}],"education":[{"degree","institution","gradYear"}],"targetRoles":[]}
"targetRoles" only if they said which job they want.

${fenceUntrusted("answer", text, 2000)}`;
  return generateJSON({ task: "classify", uid, system: SYSTEM, prompt, schema: Facts, maxTokens: 700, cache: false });
}

const EDU_WORDS: Array<[RegExp, string]> = [
  [/\b(ph\.?\s?d|doctorate)\b/i, "PhD"],
  [/\b(m\.?\s?tech|m\.?\s?e\b|mba|pgdm|m\.?\s?c\.?\s?a|m\.?\s?sc|m\.?\s?com|m\.?\s?a\b|post[- ]?graduat|masters?)\b/i, "Post-graduate"],
  [/\b(b\.?\s?tech|b\.?\s?e\b|b\.?\s?sc|b\.?\s?com|b\.?\s?a\b|b\.?\s?c\.?\s?a|bba|graduat|bachelor|degree)\b/i, "Graduate"],
  [/\bdiploma|polytechnic\b/i, "Diploma"],
  [/\biti\b/i, "ITI"],
  [/\b(12th|hsc|intermediate|plus two|\+2|बारहवीं)\b/i, "12th"],
  [/\b(10th|ssc|matric|दसवीं)\b/i, "10th"],
];

const titleCase = (s: string) => s.replace(/\s+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());

/** Rules-only reading, used when no AI is available (English/Hinglish; Hindi script needs the AI). */
export function ruleFacts(step: InterviewStep, text: string): FactsT {
  const t = text.trim();
  const facts: FactsT = { fullName: "", currentRole: "", totalExperienceYears: null, fresher: false, city: "", skills: [], experience: [], education: [], targetRoles: [] };
  const yrs = /(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?|saal|साल)/i.exec(t);
  if (yrs) facts.totalExperienceYears = Number(yrs[1]);
  if (/\bfresher|no experience|फ्रेशर\b/i.test(t)) { facts.fresher = true; facts.totalExperienceYears = 0; }
  facts.city = findIndianCities(t)[0] || "";
  const role = /\b(?:i am|i'm|im|working as|work as|worked as|job as|main)\s+(?:an?\s+)?([a-z][a-z .&/-]{2,40}?)(?=\s+(?:at|in|for|with|from|since|,|\.|and|\d)|[,.]|$)/i.exec(t);
  if (role && !/fresher|student|looking/i.test(role[1])) facts.currentRole = titleCase(role[1]);
  const company = /\b(?:at|in|with)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4})/.exec(t);
  if (step === "work" && !facts.fresher) {
    const parts = t.split(/,|\n| - | – /).map((s) => s.trim()).filter(Boolean);
    const comp = company?.[1] || parts[0] || "";
    const des = facts.currentRole || parts.find((s) => s !== comp && !/\d/.test(s)) || "";
    if (comp) facts.experience.push({ company: titleCase(comp), designation: titleCase(des), years: facts.totalExperienceYears, current: /current|now|present|abhi|अभी/i.test(t) });
  }
  const skillKeys = extractSkillKeys(t);
  const listed = step === "skills" ? t.split(/,|;|\n|\band\b|और/i).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 40) : [];
  facts.skills = [...new Set([...skillKeys.map((k) => displayName(k)), ...listed])];
  for (const [re, label] of EDU_WORDS) if (re.test(t)) { facts.education.push({ degree: label, institution: "", gradYear: /\b(19|20)\d{2}\b/.exec(t)?.[0] || "" }); break; }
  return facts;
}

const id = (p: string) => `${p}_${crypto.randomBytes(4).toString("hex")}`;

function merge(p: CandidateProfile, f: FactsT): { next: CandidateProfile; changed: string[] } {
  const next: CandidateProfile = { ...p, provenance: { ...p.provenance }, skills: [...p.skills], experience: [...p.experience], education: [...p.education], preferences: { ...p.preferences } };
  const changed: string[] = [];
  const set = <K extends "fullName" | "currentRole" | "city">(k: K, v: string) => {
    if (!v || (next[k] && next.provenance[k] === "user")) return;
    next[k] = v.slice(0, 120);
    next.provenance[k] = "user";
    changed.push(k === "currentRole" ? `Role: ${v}` : k === "city" ? `City: ${v}` : `Name: ${v}`);
  };
  set("fullName", f.fullName);
  set("currentRole", f.currentRole);
  set("city", f.city);
  if (f.fresher || f.totalExperienceYears !== null) {
    next.totalExperienceYears = f.fresher ? 0 : f.totalExperienceYears!;
    next.provenance.totalExperienceYears = "user";
    changed.push(next.totalExperienceYears ? `Experience: ${next.totalExperienceYears} years` : "Fresher");
  }
  const have = new Set(next.skills.map((s) => s.key));
  let added = 0;
  for (const raw of f.skills.slice(0, 25)) {
    const name = raw.trim();
    if (name.length < 2 || name.length > 60) continue;
    const key = normalizeSkillKey(name);
    if (have.has(key)) continue;
    have.add(key);
    next.skills.push({ name: displayName(key, name), key, category: categoryOf(key), source: "user", confidence: 1 } as SkillEntry);
    added++;
  }
  if (added) changed.push(`${added} skill${added === 1 ? "" : "s"}`);
  for (const e of f.experience.slice(0, 6)) {
    if (!e.company && !e.designation) continue;
    if (next.experience.some((x) => x.company.toLowerCase() === e.company.toLowerCase() && x.designation.toLowerCase() === e.designation.toLowerCase())) continue;
    next.experience.push({ id: id("exp"), company: e.company, designation: e.designation, current: e.current, responsibilities: [], achievements: [], tools: [] } as ExperienceEntry);
    changed.push(`Worked at ${e.company || e.designation}`);
    if (!next.currentRole && e.designation) { next.currentRole = e.designation; next.provenance.currentRole = "user"; }
  }
  for (const e of f.education.slice(0, 3)) {
    if (!e.degree || next.education.some((x) => x.degree.toLowerCase() === e.degree.toLowerCase())) continue;
    next.education.push({ id: id("edu"), degree: e.degree, institution: e.institution, gradYear: e.gradYear || undefined } as EducationEntry);
    changed.push(`Education: ${e.degree}`);
  }
  if (f.targetRoles.length && !next.preferences.targetRoles.length) {
    next.preferences.targetRoles = f.targetRoles.slice(0, 4);
    next.provenance["preferences.targetRoles"] = "user";
    changed.push(`Wants: ${f.targetRoles.slice(0, 2).join(", ")}`);
  }
  const years = next.totalExperienceYears;
  const derived = deriveInsights(next.currentRole, years, next.experience);
  next.insights = { ...next.insights, careerLevel: years === 0 && next.provenance.totalExperienceYears === "user" ? "fresher" : derived.careerLevel, jobFamilies: next.insights.jobFamilies.length ? next.insights.jobFamilies : derived.jobFamilies, targetRoleSuggestions: next.insights.targetRoleSuggestions.length ? next.insights.targetRoleSuggestions : derived.targetRoleSuggestions };
  return { next, changed };
}

export async function answerInterview(uid: string, step: InterviewStep, textIn: string, choices: string[] = [], lang: Lang = "en") {
  const text = [...choices, textIn].map((s) => s.trim()).filter(Boolean).join(", ").slice(0, 2000);
  if (!text) throw new AppError(400, "Say or type something first.");
  const p = await getProfile(uid);
  if (!p) throw new AppError(404, "Profile not found");
  let facts: FactsT;
  let by: "ai" | "rules" = "ai";
  try { facts = await aiFacts(uid, step, text); } catch { facts = ruleFacts(step, text); by = "rules"; }
  // Education chips are exact; don't rely on either reader for them.
  if (step === "education" && choices.length) facts.education = [{ degree: choices[0], institution: "", gradYear: "" }];
  // A "skills" answer should always add what was listed, even when the reader recognised nothing.
  if (step === "skills" && !facts.skills.length) facts.skills = ruleFacts("skills", text).skills;
  const { next, changed } = merge(p, facts);
  const saved = await saveProfile(next);
  await audit(uid, "interview.answered", { step, by, facts: changed.length });
  const upcoming = nextStep(saved, [step]);
  return { profile: saved, changed, by, next: upcoming ? promptFor(upcoming, lang) : null };
}
