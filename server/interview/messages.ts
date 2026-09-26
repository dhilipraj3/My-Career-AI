// Message drafts for the moments that matter: follow-up, thank-you, withdrawal, accept, decline, negotiate.
// Templates are filled only from the application and the candidate's profile, so nothing here can be a false claim.
import { experienceText, wholeYears } from "../../shared/format.js";
import type { CandidateProfile, ApplicationRecord, Job } from "../../shared/types.js";
import type { DraftMessage, MessageKind, SalaryBenchmark } from "../../shared/interview.js";
import { displayName } from "../nlp/skills.js";
import { AppError, getApplication } from "../applications/service.js";
import { getStore } from "../db/store.js";
import { salaryBenchmark } from "../insights/salary.js";
import { getProfile } from "../profile/service.js";

const days = (iso?: string) => (iso ? Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0);
const fmtLPA = (n: number) => `₹${Number.isInteger(n) ? n : n.toFixed(1)} LPA`;

export function draftFor(kind: MessageKind, p: CandidateProfile, a: ApplicationRecord, job: Job | null, opts: { offerLPA?: number; benchmark?: SalaryBenchmark | null; interviewer?: string } = {}): DraftMessage {
  const to = opts.interviewer?.trim() || "Hiring Team";
  const sign = `Regards,\n${p.fullName}${p.phone ? `\n${p.phone}` : ""}`;
  const strengths = (job ? job.skills.filter((k) => p.skills.some((s) => s.key === k && s.source !== "ai_derived")) : []).slice(0, 3).map((k) => displayName(k));
  const role = a.role, company = a.company;
  switch (kind) {
    case "follow_up":
      return {
        kind, subject: `Following up on my ${role} application`,
        body: `Dear ${to},\n\nI applied for the ${role} position at ${company}${a.appliedAt ? ` ${days(a.appliedAt)} days ago` : ""} and wanted to check on the status of my application.${strengths.length ? ` My experience with ${strengths.join(", ")} fits what the role needs.` : ""} I remain very interested and would be glad to share anything further that helps.\n\nThank you for your time.\n\n${sign}`,
        notes: ["Send it to the recruiter or hiring manager if you have their address, not a generic inbox.", "Wait at least a week after applying before following up."],
      };
    case "thank_you":
      return {
        kind, subject: `Thank you: ${role} interview`,
        body: `Dear ${to},\n\nThank you for taking the time to speak with me about the ${role} role at ${company}. I enjoyed learning more about the team and the work.\n\n[Add one specific thing you discussed and how you would contribute to it.]\n\nI remain very interested and look forward to the next steps.\n\n${sign}`,
        notes: ["Replace the bracketed line with something specific from your conversation.", "Send within 24 hours of the interview."],
      };
    case "withdraw":
      return {
        kind, subject: `Withdrawing my application for ${role}`,
        body: `Dear ${to},\n\nThank you for considering me for the ${role} position at ${company}. After careful thought I would like to withdraw my application.\n\nI appreciate your time and wish you and the team all the best.\n\n${sign}`,
        notes: ["A short, polite note keeps the door open for the future."],
      };
    case "accept":
      return {
        kind, subject: `Accepting the offer: ${role}`,
        body: `Dear ${to},\n\nThank you for the offer for the ${role} position at ${company}. I am delighted to accept.${opts.offerLPA ? ` I understand the compensation to be ${fmtLPA(opts.offerLPA)}.` : ""} ${p.preferences.noticePeriodDays !== undefined ? `My notice period is ${p.preferences.noticePeriodDays} days, and I can confirm a joining date once my resignation is accepted. ` : ""}Please let me know the next steps and any documents you need.\n\n${sign}`,
        notes: ["Get the offer letter in writing before you resign from your current job.", "Confirm the joining date and documents required."],
      };
    case "decline":
      return {
        kind, subject: `Regarding the ${role} offer`,
        body: `Dear ${to},\n\nThank you very much for offering me the ${role} position at ${company}, and for the time your team spent with me. After careful consideration I have decided not to proceed.\n\nI truly appreciate the opportunity and hope our paths cross again.\n\n${sign}`,
        notes: ["You don't need to give a reason, but a kind reply protects the relationship."],
      };
    case "negotiate": {
      const b = opts.benchmark;
      const market = b ? `Postings for similar roles${b.scope === "city" && b.city ? ` in ${b.city}` : " in India"} typically state ${fmtLPA(b.lowLPA)} to ${fmtLPA(b.highLPA)} (median ${fmtLPA(b.medianLPA)}, from ${b.samples} postings). ` : "";
      const target = b ? Math.max(b.medianLPA, opts.offerLPA ? opts.offerLPA * 1.08 : 0) : opts.offerLPA ? opts.offerLPA * 1.08 : 0;
      return {
        kind, subject: `${role} offer: compensation discussion`,
        body: `Dear ${to},\n\nThank you for the offer for the ${role} position at ${company}. I am very excited about the role and the team.\n\n${opts.offerLPA ? `The offer is ${fmtLPA(opts.offerLPA)}. ` : ""}${market}${strengths.length ? `Given my experience with ${strengths.join(", ")}${p.totalExperienceYears ? ` and ${experienceText(p.totalExperienceYears)} in the field` : ""}, ` : "Given my experience, "}I was hoping we could discuss ${target ? `a fixed compensation closer to ${fmtLPA(Math.round(target * 10) / 10)}` : "the compensation"}.\n\nI am confident I can add strong value and would be happy to accept once we are aligned.\n\n${sign}`,
        notes: [
          b ? `Market figures come from ${b.samples} live postings that state a salary. Treat them as a guide, not a rule.` : "No reliable market data for this role yet. Ask peers and check other sources before naming a number.",
          "Negotiate the whole package: fixed pay, joining bonus, notice buy-out, work-from-home days, review date.",
          "Stay polite and specific. Have a number you'd accept and one you'd walk away below.",
        ],
      };
    }
  }
}

export async function draftMessage(uid: string, applicationId: string, kind: MessageKind, opts: { offerLPA?: number; interviewer?: string } = {}): Promise<DraftMessage> {
  const profile = await getProfile(uid);
  if (!profile) throw new AppError(409, "Set up your profile first.");
  const app = await getApplication(uid, applicationId);
  const job = await (await getStore()).get<Job>("jobs", app.jobId);
  const benchmark = kind === "negotiate" ? await salaryBenchmark(app.role, job?.city || profile.city).catch(() => null) : null;
  return draftFor(kind, profile, app, job, { ...opts, benchmark });
}
