// Interview prep for one job: likely questions (technical / behavioural / role / gap), stories built from the
// candidate's own facts, questions to ask the employer, and a day-before checklist. Rules always work; AI only adds
// job-specific technical/role questions on top.
import crypto from "node:crypto";
import { z } from "zod";
import type { CandidateProfile, Job, JobMatch } from "../../shared/types.js";
import type { InterviewPrep, PrepQuestion, PrepStory, QuestionKind } from "../../shared/interview.js";
import { generateJSON } from "../ai/gateway.js";
import { getJobForUser } from "../applications/service.js";
import { getStore } from "../db/store.js";
import { ensureMatch } from "../matching/service.js";
import { displayName, extractSkillKeys } from "../nlp/skills.js";
import { UNTRUSTED_NOTICE, fenceUntrusted } from "../nlp/text.js";
import { getProfile } from "../profile/service.js";

const qid = (kind: string, text: string) => `${kind}_${crypto.createHash("sha1").update(text).digest("hex").slice(0, 8)}`;
const q = (kind: QuestionKind, question: string, tip: string, evidence?: string): PrepQuestion => ({ id: qid(kind, question), kind, question, tip, evidence });
const clean = (s: string) => s.replace(/^[•\-–\s]+/, "").replace(/[.\s]+$/, "");

/** Every fact the candidate can truthfully lean on, tagged with where it came from. */
export function factsOf(p: CandidateProfile): Array<{ text: string; source: string; skills: string[] }> {
  const out: Array<{ text: string; source: string; skills: string[] }> = [];
  for (const e of p.experience) for (const f of [...e.achievements, ...e.responsibilities]) out.push({ text: clean(f), source: `${e.designation}${e.company ? ` at ${e.company}` : ""}`, skills: extractSkillKeys(f) });
  for (const x of p.projects) out.push({ text: clean(x.description), source: `Project: ${x.title}`, skills: extractSkillKeys(x.description) });
  return out.filter((f) => f.text.length > 15);
}

export function rulesPrep(p: CandidateProfile, job: Job, match: JobMatch | null): Omit<InterviewPrep, "id" | "uid" | "createdAt" | "generatedBy"> {
  const facts = factsOf(p);
  const mine = new Set(p.skills.filter((s) => s.source !== "ai_derived").map((s) => s.key));
  const questions: PrepQuestion[] = [];

  // Technical: the job's skills you actually have, with your own evidence to lean on.
  for (const key of job.skills.filter((k) => mine.has(k)).slice(0, 4)) {
    const ev = facts.find((f) => f.skills.includes(key));
    questions.push(q("technical", `Tell me about a time you used ${displayName(key)} in your work. What did you do and what was the outcome?`,
      ev ? `Use your own example: "${ev.text}" (${ev.source}). Say what the problem was, what you did, and what changed.` : `You list ${displayName(key)}, but nothing on your resume shows it in use. Prepare one real example.`, ev?.text));
  }
  // Gaps: skills the job wants that aren't on the profile. Honest preparation beats hoping they don't ask.
  for (const key of (match?.missingSkills?.length ? match.missingSkills : job.skills.filter((k) => !mine.has(k))).slice(0, 3)) {
    questions.push(q("gap", `This role uses ${displayName(key)}. How comfortable are you with it?`,
      `It isn't on your resume, so be honest. Say what you have used that is closest, and how quickly you would learn it (with a concrete plan).`));
  }
  const recent = p.experience[0];
  questions.push(
    q("behavioural", "Tell me about yourself.", `Two minutes: what you do now${recent ? ` (${recent.designation}${recent.company ? ` at ${recent.company}` : ""})` : ""}, one or two strengths that fit ${job.title}, and why you want this role.`),
    q("behavioural", "Tell me about a time you faced a conflict at work and how you handled it.", "Pick a real disagreement. Explain the other person's view fairly, what you did, and the result."),
    q("behavioural", "Describe a time you failed or made a mistake. What did you learn?", "Choose a genuine but not disastrous example. Spend most of the answer on what you changed afterwards."),
    q("behavioural", "Tell me about a time you had to meet a tight deadline.", "Give the deadline, how you prioritised, and the outcome with a number if you can."),
    q("role", `Why do you want to be a ${job.title} at ${job.company}?`, `Mention something specific about ${job.company} and connect it to your own strengths. Avoid generic answers.`),
    q("role", `What do you expect to achieve in your first 90 days as ${job.title}?`, "Learn, contribute, then improve: understand the team and tools, deliver one small win, then propose one improvement."),
    q("role", "What are your salary expectations, and what is your notice period?", `Give a range grounded in the market rather than one number. ${p.preferences.noticePeriodDays !== undefined ? `Your notice period is ${p.preferences.noticePeriodDays} days.` : "Know your notice period."}`),
  );

  // Stories: the most job-relevant real facts, with prompts for the parts only the candidate knows.
  const relevant = [...facts].sort((a, b) => b.skills.filter((k) => job.skills.includes(k)).length - a.skills.filter((k) => job.skills.includes(k)).length).slice(0, 3);
  const stories: PrepStory[] = relevant.map((f, i) => ({
    id: `story_${i}`, skill: displayName(f.skills.find((k) => job.skills.includes(k)) || f.skills[0] || "", "Achievement"), source: f.source, fact: f.text,
    prompts: {
      situation: "What was the situation? Who was involved, and what was at stake?",
      task: "What exactly were you responsible for?",
      action: `What did YOU do (not the team)? Start from: “${f.text}”`,
      result: "What changed? Add a number (time saved, money, quality, people) only if it is true.",
    },
  }));

  return {
    jobId: job.id, role: job.title, company: job.company, questions, stories,
    askEmployer: [
      "What does success look like in this role after 6 months?",
      "What are the biggest challenges the team is facing right now?",
      "How is the team structured, and who would I work with most closely?",
      "How do you measure performance, and how often is feedback given?",
      "What does the interview process look like from here, and when can I expect to hear back?",
      "What opportunities are there to learn and grow in this role?",
    ],
    checklist: [
      `Re-read the job description for ${job.title} and note where your experience matches.`,
      `Look up ${job.company}: what they do, recent news, products.`,
      "Prepare 3 stories (situation, task, action, result) and practise them out loud.",
      "Prepare 3 questions to ask the interviewer.",
      "Check the time, place or meeting link, and test your camera and audio for an online round.",
      "Keep your resume, ID and a notebook ready. Sleep early.",
    ],
  };
}

const AiQuestions = z.object({
  questions: z.array(z.object({ kind: z.enum(["technical", "role"]).catch("technical"), question: z.string().min(10).max(300), tip: z.string().max(400).catch("") })).max(8),
});

async function aiQuestions(uid: string, job: Job): Promise<PrepQuestion[]> {
  const r = await generateJSON({
    task: "interview_prep", uid, schema: AiQuestions, cache: true, maxTokens: 1500,
    system: `You are an experienced interviewer. Write realistic interview questions specific to this job. Do not assume anything about the candidate. ${UNTRUSTED_NOTICE}`,
    prompt: `Write 5 interview questions (mix of "technical" and "role") this employer is likely to ask for the job below, each with a one-sentence tip on how to approach it. Return {"questions":[{"kind":"technical|role","question":"","tip":""}]}.\n\n${fenceUntrusted("job_posting", `${job.title} at ${job.company}\n${job.description}`, 4500)}`,
  });
  return r.questions.map((x) => q(x.kind, x.question, x.tip || "Answer with a real example from your own work."));
}

export async function getPrep(uid: string, jobId: string, opts: { regenerate?: boolean } = {}): Promise<InterviewPrep> {
  const store = await getStore();
  const id = `${uid}_${jobId}`;
  const cached = await store.get<InterviewPrep>("interviewPrep", id);
  if (cached && !opts.regenerate) return cached;
  const profile = await getProfile(uid);
  if (!profile) throw new Error("Profile needed");
  const job = await getJobForUser(uid, jobId);
  const match = await ensureMatch(uid, job).catch(() => null);
  const base = rulesPrep(profile, job, match);
  let generatedBy: InterviewPrep["generatedBy"] = "rules";
  try {
    const extra = await aiQuestions(uid, job);
    const seen = new Set(base.questions.map((x) => x.question.toLowerCase()));
    const fresh = extra.filter((x) => !seen.has(x.question.toLowerCase()));
    if (fresh.length) { base.questions = [...fresh, ...base.questions]; generatedBy = "ai"; }
  } catch { /* rules are enough */ }
  const prep: InterviewPrep = { ...base, id, uid, generatedBy, createdAt: new Date().toISOString() };
  await store.put("interviewPrep", id, prep);
  return prep;
}
