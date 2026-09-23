import type { CandidatePreferences, CandidateProfile, ProfileMissing, Source } from "../../shared/types.js";
import { getStore } from "../db/store.js";
import { audit } from "../audit.js";
import type { AuthedUser } from "../auth.js";
import { normalizeSkillKey, categoryOf, displayName } from "../nlp/skills.js";
import { emptyPreferences, PreferencePatch, parsePreferenceText, type PreferencePatchT } from "./preferences.js";
import type { ParsedResume } from "../resume/parse.js";
import { totalExperienceYears } from "../resume/dates.js";

export function newProfile(user: AuthedUser): CandidateProfile {
  const now = new Date().toISOString();
  return {
    uid: user.uid, fullName: user.name || "", email: user.email || "", phone: "", city: "", state: "", country: "India", links: {},
    currentRole: "", summary: "", totalExperienceYears: 0, experience: [], skills: [], education: [], certifications: [], projects: [],
    preferences: emptyPreferences(),
    insights: { careerLevel: "mid", jobFamilies: [], targetRoleSuggestions: [] },
    provenance: user.name ? { fullName: "imported", email: "imported" } : {},
    completeness: { score: 0, missing: [] }, status: "empty", discoveryPaused: false, automationLevel: 1, createdAt: now, updatedAt: now,
  };
}

export async function getProfile(uid: string): Promise<CandidateProfile | null> {
  return (await getStore()).get<CandidateProfile>("profiles", uid);
}

export async function getOrCreateProfile(user: AuthedUser): Promise<CandidateProfile> {
  const existing = await getProfile(user.uid);
  if (existing) return existing;
  const p = evaluate(newProfile(user));
  await (await getStore()).put("profiles", user.uid, p);
  await audit(user.uid, "profile.created");
  return p;
}

export async function saveProfile(p: CandidateProfile): Promise<CandidateProfile> {
  const next = evaluate({ ...p, updatedAt: new Date().toISOString() });
  await (await getStore()).put("profiles", p.uid, next);
  return next;
}

const answered = (p: CandidateProfile, key: string) => Boolean(p.provenance[`preferences.${key}`]);

/** Essential vs. progressive questions (scope §12). Only essentials block "ready". */
export function missingInfo(p: CandidateProfile): ProfileMissing[] {
  const m: ProfileMissing[] = [];
  const pr = p.preferences;
  if (!p.experience.length && !p.skills.length)
    m.push({ field: "resume", question: "Please upload your resume so I can understand your experience.", essential: true });
  if (!pr.targetRoles.length)
    m.push({ field: "targetRoles", question: "Which role(s) are you looking for? (e.g. Senior Project Manager)", essential: true });
  if (!pr.locations.length && !answered(p, "locations"))
    m.push({ field: "locations", question: `Which city or cities would you like to work in?${p.city ? ` (You're currently in ${p.city}.)` : ""}`, essential: true });
  if (!pr.workModes.length)
    m.push({ field: "workModes", question: "Do you prefer remote, hybrid or in-office roles?", essential: true });
  if (pr.minSalaryLPA === undefined && !answered(p, "minSalaryLPA"))
    m.push({ field: "minSalaryLPA", question: "What is the minimum salary (in LPA) you'd consider? Say \"flexible\" if you have no minimum.", essential: true });
  if (pr.noticePeriodDays === undefined && !answered(p, "noticePeriodDays"))
    m.push({ field: "noticePeriodDays", question: "What is your notice period? (e.g. 30 days, or \"immediate\")", essential: true });
  // progressive, asked later
  if (!pr.industries.length) m.push({ field: "industries", question: "Any industries you prefer or want to avoid?", essential: false });
  if (!pr.employmentTypes.length) m.push({ field: "employmentTypes", question: "Are you looking for full-time, contract, or either?", essential: false });
  if (pr.willingToRelocate === undefined) m.push({ field: "willingToRelocate", question: "Are you open to relocating for the right role?", essential: false });
  return m;
}

/** Profile readiness — how much the system knows, NOT job suitability (scope §11). */
export function evaluate(p: CandidateProfile): CandidateProfile {
  const missing = missingInfo(p);
  const essentialMissing = missing.filter((m) => m.essential);
  const checks: Array<[boolean, number]> = [
    [Boolean(p.fullName), 5], [Boolean(p.email), 5], [Boolean(p.phone), 5], [Boolean(p.city), 5],
    [Boolean(p.currentRole), 10], [p.experience.length > 0 || p.totalExperienceYears === 0 && p.skills.length > 0, 15],
    [p.skills.length >= 3, 15], [p.education.length > 0, 5],
    [p.preferences.targetRoles.length > 0, 8], [p.preferences.locations.length > 0 || answered(p, "locations"), 7],
    [p.preferences.workModes.length > 0, 5], [p.preferences.minSalaryLPA !== undefined || answered(p, "minSalaryLPA"), 5],
    [p.preferences.noticePeriodDays !== undefined || answered(p, "noticePeriodDays"), 5],
  ];
  const score = Math.round(checks.reduce((s, [ok, w]) => s + (ok ? w : 0), 0));
  const hasResumeData = p.skills.length > 0 || p.experience.length > 0;
  const status = p.status === "parsing" ? "parsing" : !hasResumeData ? "empty" : essentialMissing.length ? "needs_info" : "ready";
  return { ...p, completeness: { score, missing }, status };
}

/** Merge a parsed resume into the profile without clobbering anything the user has edited or answered. */
export function applyParsedResume(p: CandidateProfile, parsed: ParsedResume, resumeId: string): CandidateProfile {
  const prov: Record<string, Source> = { ...p.provenance };
  const keepUser = (field: string) => prov[field] === "user";
  const setStr = <K extends "fullName" | "email" | "phone" | "city" | "state" | "country" | "currentRole" | "summary">(field: K) => {
    if (keepUser(field) || !parsed[field]) return p[field];
    prov[field] = parsed.provenance[field] || "resume";
    return parsed[field];
  };
  const userSkills = p.skills.filter((s) => s.source === "user");
  const parsedKeys = new Set(parsed.skills.map((s) => s.key));
  const skills = [...parsed.skills, ...userSkills.filter((s) => !parsedKeys.has(s.key))];

  const experience = parsed.experience;
  const preferences = { ...p.preferences };
  if (!preferences.targetRoles.length && parsed.insights.targetRoleSuggestions.length) {
    preferences.targetRoles = parsed.insights.targetRoleSuggestions.slice(0, 3);
    prov["preferences.targetRoles"] = "ai_derived";
  }
  const merged: CandidateProfile = {
    ...p,
    fullName: setStr("fullName"), email: setStr("email"), phone: setStr("phone"), city: setStr("city"), state: setStr("state"), country: setStr("country"),
    currentRole: setStr("currentRole"), summary: setStr("summary"),
    links: { ...p.links, ...Object.fromEntries(Object.entries(parsed.links).filter(([, v]) => v)) },
    experience, skills, education: parsed.education, certifications: parsed.certifications, projects: parsed.projects,
    totalExperienceYears: totalExperienceYears(experience),
    insights: parsed.insights, preferences, provenance: { ...prov, insights: "ai_derived" },
    resumeId, status: "empty",
  };
  return evaluate(merged);
}

export async function updatePreferences(uid: string, patchIn: unknown, source: Source = "user", actor: "user" | "agent" = "user"): Promise<CandidateProfile> {
  const patch = PreferencePatch.parse(patchIn);
  const p = await getProfile(uid);
  if (!p) throw new Error("Profile not found");
  const prov = { ...p.provenance };
  const prefs = { ...p.preferences };
  for (const [k, v] of Object.entries(patch)) {
    (prefs as any)[k] = v;
    prov[`preferences.${k}`] = source;
  }
  const saved = await saveProfile({ ...p, preferences: prefs, provenance: prov });
  await audit(uid, "profile.preferences_updated", { fields: Object.keys(patch), source }, actor);
  return saved;
}

/** Put preference fields back exactly as they were (used by the assistant's Undo). `undefined` clears a field. */
export async function restorePreferences(uid: string, previous: Partial<CandidatePreferences>, keys: string[]): Promise<CandidateProfile> {
  const p = await getProfile(uid);
  if (!p) throw new Error("Profile not found");
  const prefs: Record<string, unknown> = { ...p.preferences };
  for (const k of keys) {
    if (previous[k as keyof CandidatePreferences] === undefined) delete prefs[k];
    else prefs[k] = previous[k as keyof CandidatePreferences];
  }
  const saved = await saveProfile({ ...p, preferences: prefs as unknown as CandidatePreferences });
  await audit(uid, "profile.preferences_restored", { fields: keys }, "user");
  return saved;
}

/** Answer to a profile-completion question in natural language. Returns what was understood. */
export async function answerProfileQuestion(uid: string, text: string): Promise<{ profile: CandidateProfile; understood: PreferencePatchT }> {
  const understood = parsePreferenceText(text);
  if (!Object.keys(understood).length) {
    const p = await getProfile(uid);
    if (!p) throw new Error("Profile not found");
    return { profile: p, understood };
  }
  return { profile: await updatePreferences(uid, understood, "user"), understood };
}

export const EDITABLE_SCALARS = ["fullName", "email", "phone", "city", "state", "country", "currentRole", "summary"] as const;

export async function editProfile(
  uid: string,
  edit: { scalars?: Partial<Record<(typeof EDITABLE_SCALARS)[number], string>>; addSkills?: string[]; removeSkills?: string[]; discoveryPaused?: boolean; automationLevel?: 0 | 1 | 2 | 3 },
): Promise<CandidateProfile> {
  const p = await getProfile(uid);
  if (!p) throw new Error("Profile not found");
  const next: CandidateProfile = { ...p, provenance: { ...p.provenance }, skills: [...p.skills] };
  for (const [k, v] of Object.entries(edit.scalars || {})) {
    if (!(EDITABLE_SCALARS as readonly string[]).includes(k)) continue;
    (next as any)[k] = String(v).slice(0, k === "summary" ? 1500 : 120);
    next.provenance[k] = "user";
  }
  for (const s of edit.addSkills || []) {
    const key = normalizeSkillKey(s);
    const existing = next.skills.findIndex((x) => x.key === key);
    const entry = { name: displayName(key, s.trim()), key, category: categoryOf(key), source: "user" as const, confidence: 1 };
    if (existing >= 0) next.skills[existing] = { ...next.skills[existing], source: "user", confidence: 1 };
    else next.skills.push(entry);
  }
  if (edit.removeSkills?.length) {
    const rm = new Set(edit.removeSkills.map(normalizeSkillKey));
    next.skills = next.skills.filter((s) => !rm.has(s.key));
  }
  if (edit.discoveryPaused !== undefined) next.discoveryPaused = edit.discoveryPaused;
  if (edit.automationLevel !== undefined) next.automationLevel = edit.automationLevel;
  const saved = await saveProfile(next);
  await audit(uid, "profile.edited", { fields: Object.keys(edit) });
  return saved;
}
