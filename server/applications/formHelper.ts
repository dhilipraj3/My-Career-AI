// Application form helper: copy-ready answers for the questions almost every Indian job form asks, taken from the
// candidate's own profile. Nothing is submitted for the user, and anything we don't know is left for them to fill in.
import type { CandidateProfile, Job } from "../../shared/types.js";
import { displayName } from "../nlp/skills.js";

export interface FormField { id: string; label: string; value: string; known: boolean; hint?: string }

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function formHelper(p: CandidateProfile, job?: Job): FormField[] {
  const pr = p.preferences;
  const latest = p.experience.find((e) => e.current) || p.experience[0];
  const edu = p.education[0];
  const skills = p.skills.filter((s) => s.source !== "ai_derived").slice(0, 12).map((s) => s.name);
  const relevant = job ? job.skills.filter((k) => p.skills.some((s) => s.key === k && s.source !== "ai_derived")).slice(0, 5).map((k) => displayName(k)) : [];
  const f = (id: string, label: string, value: string | undefined, hint?: string): FormField => ({ id, label, value: value?.trim() || "", known: Boolean(value?.trim()), hint });
  return [
    f("name", "Full name", p.fullName),
    f("email", "Email", p.email),
    f("phone", "Phone", p.phone),
    f("location", "Current location", [p.city, p.state].filter(Boolean).join(", ")),
    f("experience", "Total experience", p.totalExperienceYears ? `${fmt(p.totalExperienceYears)} years` : p.insights.careerLevel === "fresher" ? "Fresher (0 years)" : undefined),
    f("currentCompany", "Current / last company", latest?.company),
    f("currentRole", "Current / last designation", latest?.designation || p.currentRole),
    f("noticePeriod", "Notice period", pr.noticePeriodDays !== undefined ? (pr.noticePeriodDays === 0 ? "Immediate joiner" : `${pr.noticePeriodDays} days`) : undefined, "Tell me your notice period in your profile to fill this."),
    f("currentCtc", "Current CTC", undefined, "Only you know this. Enter it yourself; I never guess pay."),
    f("expectedCtc", "Expected CTC", pr.minSalaryLPA ? `${fmt(pr.minSalaryLPA)} LPA (negotiable)` : undefined, "Set your minimum salary in your profile to fill this."),
    f("education", "Highest qualification", edu ? [edu.degree, edu.specialization, edu.institution, edu.gradYear].filter(Boolean).join(", ") : undefined),
    f("skills", "Key skills", skills.join(", ")),
    f("relocate", "Willing to relocate?", pr.willingToRelocate === undefined ? undefined : pr.willingToRelocate ? "Yes" : "No"),
    f("whyThisRole", "Why are you interested in this role?", job && relevant.length ? `I'm interested in the ${job.title} role at ${job.company} because it uses ${relevant.join(", ")}, which I work with, and it fits the direction I want my career to take.` : undefined, "Add one specific reason about the company or team before you send it."),
    f("summary", "Short introduction", p.summary),
  ];
}
