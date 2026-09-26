import { experienceText, wholeYears } from "../../shared/format.js";
import type { CandidateProfile, Confidence, Job, JobMatch, MatchBreakdown } from "../../shared/types.js";
import { cosine } from "../nlp/text.js";
import {
  categoryOf, displayName, familySimilarity, normalizeSkillKey, roleFamily, seniorityRank, skillSimilarity, titleSimilarity, detectSeniority,
} from "../nlp/skills.js";
import { RECOMMENDABLE } from "../jobs/normalize.js";

/** Configurable weights (scope §23: "the exact scoring model should be configurable"). Must sum to 1. */
export const WEIGHTS: Record<keyof MatchBreakdown, number> = {
  skills: 0.35, experience: 0.15, roleAlignment: 0.2, domain: 0.1, location: 0.1, preferences: 0.1,
};

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Highest score a job outside the candidate's preferred cities can get (top of the "Fair" band). */
export const LOCATION_CAP = 60;

export type ScoreBand = "excellent" | "good" | "fair" | "low";
/** Plain-language bands so a number like 73 means something to the user. */
export const scoreBand = (score: number): ScoreBand => (score >= 80 ? "excellent" : score >= 65 ? "good" : score >= 50 ? "fair" : "low");
const pct = (n: number) => Math.round(clamp(n * 100));

/** Skills the candidate can legitimately claim: from the resume or added by the user — never AI guesses. */
function claimableSkillKeys(p: CandidateProfile): Set<string> {
  return new Set(p.skills.filter((s) => s.source !== "ai_derived").map((s) => s.key));
}

function candidateText(p: CandidateProfile): string {
  return [p.currentRole, p.summary, ...p.experience.flatMap((e) => [e.designation, ...e.responsibilities, ...e.achievements]), ...p.projects.map((x) => x.description)].join(" ");
}

// -------- Layer 1: hard constraints --------
export function hardConstraints(p: CandidateProfile, j: Job): string[] {
  const fails: string[] = [];
  const pr = p.preferences;
  const yrs = p.totalExperienceYears;
  if (j.experienceMin !== undefined && j.experienceMin > 0 && yrs + 1 < j.experienceMin && j.experienceMin - yrs >= 2)
    fails.push(`Requires ${j.experienceMin}+ years; your profile shows ${yrs}`);
  if (pr.employmentTypes.length && j.employmentType !== "unknown" && !pr.employmentTypes.includes(j.employmentType as any))
    fails.push(`Employment type is ${j.employmentType.replace("_", " ")}`);
  if (j.currency === "INR" && pr.minSalaryLPA && j.salaryMaxLPA !== undefined && j.salaryMaxLPA < pr.minSalaryLPA * 0.9)
    fails.push(`Salary up to ${j.salaryMaxLPA} LPA is below your minimum of ${pr.minSalaryLPA} LPA`);
  if (pr.excludedCompanies.some((c) => c && j.companyKey.includes(c.toLowerCase().trim())))
    fails.push("Company is on your exclusion list");
  const hay = `${j.title} ${j.description}`.toLowerCase();
  const kw = pr.excludedKeywords.find((k) => k && hay.includes(k.toLowerCase()));
  if (kw) fails.push(`Mentions "${kw}", which you asked to avoid`);
  if (pr.workModes.length && pr.workModes.length < 3 && j.workMode !== "unknown" && !pr.workModes.includes(j.workMode as any)) {
    const canRelocate = pr.willingToRelocate && j.workMode === "onsite";
    if (!canRelocate) fails.push(`Work mode is ${j.workMode}; you prefer ${pr.workModes.join("/")}`);
  }
  return fails;
}

// -------- Layer 2: structured matching --------
function skillScore(p: CandidateProfile, j: Job) {
  const have = claimableSkillKeys(p);
  // Soft skills ("teamwork", "communication") can't be evidenced on a resume, so they neither count for nor against a match.
  const hard = (k: string) => categoryOf(k) !== "soft";
  const required = (j.intelligence?.requiredSkills?.length ? j.intelligence.requiredSkills.map(normalizeSkillKey) : j.skills).filter(hard);
  const preferred = (j.intelligence?.preferredSkills || []).map(normalizeSkillKey).filter((k) => hard(k) && !required.includes(k));
  if (!required.length) return { score: 0.5, matched: [] as string[], missing: [] as string[], relatedOnly: [] as string[], known: false };
  const matched: string[] = [];
  const missing: string[] = [];
  const relatedOnly: string[] = [];
  let credit = 0;
  for (const req of required) {
    if (have.has(req)) {
      matched.push(req);
      credit += 1;
      continue;
    }
    const best = Math.max(0, ...[...have].map((h) => skillSimilarity(h, req)));
    if (best > 0) {
      relatedOnly.push(req); // partial credit, but never reported as a skill the candidate has
      credit += best * 0.7;
    } else missing.push(req);
  }
  let score = credit / required.length;
  const prefHit = preferred.filter((k) => have.has(k)).length;
  if (preferred.length) score = Math.min(1, score + (prefHit / preferred.length) * 0.08);
  return { score, matched, missing, relatedOnly, known: true };
}

function experienceScore(p: CandidateProfile, j: Job): number {
  const yrs = p.totalExperienceYears;
  const min = j.experienceMin ?? j.intelligence?.minExperience;
  const max = j.experienceMax ?? j.intelligence?.maxExperience;
  if (min === undefined) {
    const rank = seniorityRank(j.seniority);
    const mine = p.insights.careerLevel === "fresher" ? 0 : p.insights.careerLevel === "junior" ? 1 : p.insights.careerLevel === "mid" ? 2 : p.insights.careerLevel === "senior" ? 3 : 4;
    return clamp(1 - Math.abs(rank - mine) * 0.25, 0, 1);
  }
  if (yrs >= min) {
    if (max !== undefined && yrs > max + 4) return 0.6; // heavily over-qualified
    if (max !== undefined && yrs > max + 2) return 0.8;
    return 1;
  }
  const gap = min - yrs;
  return clamp(1 - gap * 0.3, 0, 1);
}

function roleScore(p: CandidateProfile, j: Job): number {
  const targets = [...p.preferences.targetRoles, p.currentRole].filter(Boolean);
  if (!targets.length) return 0.4;
  const jobFam = roleFamily(j.title);
  let best = 0;
  for (const t of targets) {
    const sim = titleSimilarity(t, j.title);
    const fam = familySimilarity(roleFamily(t), jobFam);
    best = Math.max(best, sim * 0.7 + fam * 0.3, fam * 0.75);
  }
  // Seniority alignment: reaching two levels up/down is a poorer fit.
  const ref = seniorityRank(detectSeniority(p.currentRole || targets[0]));
  const diff = Math.abs(seniorityRank(j.seniority) - ref);
  return clamp(best - Math.max(0, diff - 1) * 0.15, 0, 1);
}

function domainScore(p: CandidateProfile, j: Job): number {
  const desc = `${j.title}\n${j.description}`;
  const cand = candidateText(p);
  return clamp(cosine(cand, desc) * 2.2, 0, 1); // TF cosine tops out low for long texts; scale into a usable range
}

function locationScore(p: CandidateProfile, j: Job): number {
  const pr = p.preferences;
  if (j.workMode === "remote") return pr.workModes.length && !pr.workModes.includes("remote") ? 0.5 : 1;
  const wanted = pr.locations.map((l) => l.toLowerCase());
  if (!wanted.length || wanted.some((l) => /anywhere|any location|pan india/.test(l))) return 0.85;
  const jobCities = (j.cities?.length ? j.cities : [j.city]).filter(Boolean).map((c) => c.toLowerCase());
  if (jobCities.some((c) => wanted.includes(c))) return 1;
  if (j.panIndia) return 0.9; // hiring across India, so very likely near the candidate
  if (p.city && jobCities.includes(p.city.toLowerCase())) return 0.8;
  return pr.willingToRelocate ? 0.5 : 0.15;
}

function preferenceScore(p: CandidateProfile, j: Job): number {
  const pr = p.preferences;
  let score = 0.6;
  if (pr.workModes.length) score += j.workMode === "unknown" || pr.workModes.includes(j.workMode as any) ? 0.2 : -0.3;
  if (pr.minSalaryLPA && j.salaryMaxLPA) score += j.salaryMaxLPA >= pr.minSalaryLPA ? 0.2 : -0.3;
  if (pr.industries.length && j.industry) score += pr.industries.some((i) => j.industry!.toLowerCase().includes(i.toLowerCase())) ? 0.1 : 0;
  return clamp(score, 0, 1);
}

// -------- Aggregation, explanation, confidence --------
export function confidenceFor(j: Job, skillsKnown: boolean): Confidence {
  let points = 0;
  if (j.description.length > 600) points++;
  if (skillsKnown && j.skills.length >= 3) points++;
  if (j.experienceMin !== undefined) points++;
  if (j.intelligence) points++;
  if (j.quality.flags.includes("short_description")) points -= 2;
  return points >= 3 ? "high" : points >= 1 ? "medium" : "low";
}

export interface MatchInput {
  profile: CandidateProfile;
  job: Job;
  now?: number;
}

export function computeMatch({ profile: p, job: j, now = Date.now() }: MatchInput): Omit<JobMatch, "id" | "uid" | "feedback" | "hidden" | "saved" | "notified" | "createdAt" | "updatedAt" | "aiSummary"> {
  const sk = skillScore(p, j);
  const breakdown: MatchBreakdown = {
    skills: pct(sk.score), experience: pct(experienceScore(p, j)), roleAlignment: pct(roleScore(p, j)),
    domain: pct(domainScore(p, j)), location: pct(locationScore(p, j)), preferences: pct(preferenceScore(p, j)),
  };
  const hardFailures = hardConstraints(p, j);
  let score = (Object.keys(WEIGHTS) as Array<keyof MatchBreakdown>).reduce((s, k) => s + breakdown[k] * WEIGHTS[k], 0);
  if (hardFailures.length) score = Math.min(score, 45 - (hardFailures.length - 1) * 5);
  // A job in a city the candidate didn't ask for can't be better than "Fair", however well the skills fit.
  const outsideCities = breakdown.location < 50;
  if (outsideCities) score = Math.min(score, LOCATION_CAP);
  score = Math.round(clamp(score));

  const matchedNames = sk.matched.map((k) => displayName(k));
  const relatedNames = sk.relatedOnly.map((k) => displayName(k));
  const missingNames = [...sk.missing, ...sk.relatedOnly].map((k) => displayName(k));
  const totalRequired = sk.matched.length + sk.missing.length + sk.relatedOnly.length;
  const reasons: string[] = [];
  const gaps: string[] = [];
  const assumptions: string[] = [];
  if (sk.known && sk.matched.length) reasons.push(`${sk.matched.length} of ${totalRequired} required skills found in your profile (${matchedNames.slice(0, 5).join(", ")})`);
  if (relatedNames.length) reasons.push(`Related experience for ${relatedNames.slice(0, 3).join(", ")}`);
  if (breakdown.experience >= 85) reasons.push(j.experienceMin !== undefined ? `Experience requirement (${j.experienceMin}+ yrs) satisfied with your ${experienceText(p.totalExperienceYears)}` : "Seniority level fits your experience");
  if (breakdown.roleAlignment >= 70) reasons.push(`Role aligns with your target${p.preferences.targetRoles[0] ? ` (${p.preferences.targetRoles[0]})` : ""}`);
  if (breakdown.location >= 85) reasons.push(j.workMode === "remote" ? "Remote role" : `Location matches your preference (${j.city || j.location})`);
  if (j.salaryMaxLPA && p.preferences.minSalaryLPA && j.salaryMaxLPA >= p.preferences.minSalaryLPA) reasons.push(`Salary up to ${j.salaryMaxLPA} LPA meets your ${p.preferences.minSalaryLPA} LPA minimum`);
  if (breakdown.domain >= 55) reasons.push("Responsibilities are similar to work in your experience");
  if (sk.missing.length || sk.relatedOnly.length) gaps.push(`Skills not found in your profile: ${missingNames.slice(0, 6).join(", ")}`);
  if (j.experienceMin !== undefined && p.totalExperienceYears < j.experienceMin) gaps.push(`Asks for ${j.experienceMin}+ years; you have ${experienceText(p.totalExperienceYears)}`);
  gaps.push(...hardFailures);
  if (outsideCities) gaps.push(`Based in ${j.cities?.length ? j.cities.join(", ") : j.city || j.location}, outside your preferred locations (${p.preferences.locations.join(", ")})`);
  if (!sk.known) assumptions.push("The posting lists few explicit skills, so the skill score is a neutral estimate");
  if (j.salaryMinLPA === undefined && j.salaryMaxLPA === undefined) assumptions.push("Salary is not disclosed");
  if (j.experienceMin === undefined) assumptions.push("Experience requirement is not stated");
  if (j.workMode === "unknown") assumptions.push("The posting doesn't say whether it's remote, hybrid or on-site");
  if (j.quality.suspicious) gaps.push("Listing has quality warnings — verify the employer before applying");

  const confidence = confidenceFor(j, sk.known);
  const stale = j.status === "stale" ? 0.85 : 1;
  const conf = confidence === "high" ? 1 : confidence === "medium" ? 0.95 : 0.85;
  const postedDays = j.postedAt ? (now - new Date(j.postedAt).getTime()) / 86400000 : 30;
  const recency = postedDays <= 7 ? 1.05 : postedDays <= 30 ? 1 : 0.95;
  const actionable = j.sources.some((s) => s.applyUrl) ? 1 : 0.9;
  const rankScore = Math.round(score * stale * conf * recency * actionable * (j.quality.suspicious ? 0.7 : 1) * 10) / 10;

  return { jobId: j.id, score, confidence, breakdown, matchedSkills: matchedNames, missingSkills: missingNames, hardFailures, reasons, gaps, assumptions, rankScore };
}

export function isCandidateJob(j: Job, uid: string): boolean {
  if (j.ownerUid && j.ownerUid !== uid) return false;
  return RECOMMENDABLE.includes(j.status);
}
