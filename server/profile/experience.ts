// Editing work history directly (from the resume screen), so people can fix what the resume check points out
// without re-uploading. Dates drive the total experience, unless the person told us their total themselves.
import crypto from "node:crypto";
import { z } from "zod";
import type { CandidateProfile, ExperienceEntry } from "../../shared/types.js";
import { AppError } from "../applications/service.js";
import { audit } from "../audit.js";
import { totalExperienceYears } from "../resume/dates.js";
import { getProfile, saveProfile } from "./service.js";

const YM = z.string().trim().regex(/^(19|20)\d{2}(-(0[1-9]|1[0-2]))?$/, "Use a date like 2021-06").optional().or(z.literal("").transform(() => undefined));
export const ExperienceBody = z.object({
  designation: z.string().trim().min(2).max(100),
  company: z.string().trim().min(1).max(100),
  location: z.string().trim().max(80).optional(),
  startDate: YM,
  endDate: YM,
  current: z.boolean().default(false),
  points: z.array(z.string().trim().min(3).max(300)).max(10).default([]),
});
export type ExperienceInput = z.infer<typeof ExperienceBody>;

const sortRecentFirst = (xs: ExperienceEntry[]) => [...xs].sort((a, b) => Number(b.current) - Number(a.current) || (b.startDate || "").localeCompare(a.startDate || ""));

async function commit(p: CandidateProfile, experience: ExperienceEntry[], action: string): Promise<CandidateProfile> {
  if (experience.some((e) => e.startDate && e.endDate && !e.current && e.endDate < e.startDate)) throw new AppError(422, "An end date is before its start date.");
  const next: CandidateProfile = {
    ...p, experience: sortRecentFirst(experience), provenance: { ...p.provenance, experience: "user" },
    totalExperienceYears: p.provenance.totalExperienceYears === "user" ? p.totalExperienceYears : totalExperienceYears(experience),
  };
  const current = next.experience.find((e) => e.current) || next.experience[0];
  if (current && p.provenance.currentRole !== "user") next.currentRole = current.designation;
  const saved = await saveProfile(next);
  await audit(p.uid, action, { count: experience.length });
  return saved;
}

const toEntry = (input: ExperienceInput, id: string, keep?: ExperienceEntry): ExperienceEntry => ({
  id, company: input.company, designation: input.designation, location: input.location || keep?.location,
  startDate: input.startDate, endDate: input.current ? "present" : input.endDate, current: input.current,
  // Everything the person writes becomes their responsibilities; nothing is kept split in a second list.
  responsibilities: input.points, achievements: [], tools: keep?.tools || [],
});

export async function addExperience(uid: string, input: ExperienceInput): Promise<CandidateProfile> {
  const p = await getProfile(uid);
  if (!p) throw new AppError(404, "Profile not found");
  if (p.experience.length >= 20) throw new AppError(422, "That's the most jobs a resume can hold.");
  return commit(p, [...p.experience, toEntry(input, `exp_${crypto.randomBytes(4).toString("hex")}`)], "profile.experience_added");
}

export async function updateExperience(uid: string, id: string, input: ExperienceInput): Promise<CandidateProfile> {
  const p = await getProfile(uid);
  const cur = p?.experience.find((e) => e.id === id);
  if (!p || !cur) throw new AppError(404, "Job not found in your profile");
  return commit(p, p.experience.map((e) => (e.id === id ? toEntry(input, id, cur) : e)), "profile.experience_edited");
}

export async function removeExperience(uid: string, id: string): Promise<CandidateProfile> {
  const p = await getProfile(uid);
  if (!p || !p.experience.some((e) => e.id === id)) throw new AppError(404, "Job not found in your profile");
  return commit(p, p.experience.filter((e) => e.id !== id), "profile.experience_removed");
}

// ---------------- wording help (rules, instant, no AI) ----------------

const REWRITES: Array<[RegExp, string]> = [
  [/^responsible for (leading|managing|handling|running|overseeing)\s+/i, "$MANAGED "],
  [/^responsible for\s+/i, "Owned "],
  [/^(worked on|involved in|participated in|part of)\s+/i, "Contributed to "],
  [/^(helped|helping|assisted|assisting)( in| with| to)?\s+/i, "Supported "],
  [/^(handled|handling)\s+/i, "Managed "],
  [/^(was )?in charge of\s+/i, "Led "],
  [/^(duties|tasks) (included|include)\s*:?\s*/i, ""],
];
const VERB_FOR: Record<string, string> = { leading: "Led", managing: "Managed", handling: "Managed", running: "Ran", overseeing: "Oversaw" };

/** A stronger opening for a point that starts weakly ("Responsible for managing…" → "Managed…"). Never changes facts. */
export function strongerPoint(point: string): string | null {
  const t = point.trim().replace(/^[•\-–*]\s*/, "");
  for (const [re, rep] of REWRITES) {
    const m = re.exec(t);
    if (!m) continue;
    const lead = rep === "$MANAGED " ? `${VERB_FOR[m[1].toLowerCase()] || "Managed"} ` : rep;
    const rest = t.slice(m[0].length);
    const out = (lead + rest).trim();
    if (!out || out.toLowerCase() === t.toLowerCase()) return null;
    return out.charAt(0).toUpperCase() + out.slice(1);
  }
  return null;
}
