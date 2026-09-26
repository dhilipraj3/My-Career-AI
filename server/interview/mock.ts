// Mock interviews: one question at a time, feedback on structure, evidence, clarity and length, and a score history.
// The rule-based scorer always works; when AI is available it adds a short coaching note on top, never replacing the
// checks (so scores stay explainable and consistent).
import crypto from "node:crypto";
import { z } from "zod";
import type { CandidateProfile } from "../../shared/types.js";
import type { AnswerFeedback, MockSession, PrepQuestion } from "../../shared/interview.js";
import { generateJSON } from "../ai/gateway.js";
import { AppError } from "../applications/service.js";
import { audit } from "../audit.js";
import { getStore } from "../db/store.js";
import { extractSkillKeys } from "../nlp/skills.js";
import { UNTRUSTED_NOTICE, fenceUntrusted, overlap, tokenize } from "../nlp/text.js";
import { tickGoal, weeklyPlan } from "../companion/service.js";
import { getProfile } from "../profile/service.js";
import { getPrep } from "./prep.js";

const FILLERS = /\b(um+|uh+|you know|basically|actually|kind of|sort of|like i said|i guess)\b/gi;
const STAR = {
  situation: /\b(situation|when i was|at that time|we were|the project|our client|the team had|context)\b/i,
  task: /\b(my (role|task|responsibility)|i was (responsible|asked|tasked)|needed to|had to|goal was)\b/i,
  action: /\b(i (led|built|created|designed|decided|organi[sz]ed|implemented|fixed|analy[sz]ed|proposed|set up|talked|spoke|worked|introduced|automated|negotiated|planned|coordinated|wrote|developed))\b/i,
  result: /\b(result|as a result|outcome|which (led|helped|reduced|increased|saved)|reduced|increased|improved|saved|delivered|achieved|resulting)\b/i,
};

const wordCount = (s: string) => (s.trim().match(/\S+/g) || []).length;
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Rule-based scoring. Pure and deterministic so it can be tested and explained. */
export function scoreAnswer(question: PrepQuestion, answer: string, profile: CandidateProfile): AnswerFeedback {
  const strengths: string[] = [];
  const improvements: string[] = [];
  const flags: string[] = [];
  const words = wordCount(answer);
  if (words < 8) return { score: clamp(words * 2), strengths: [], improvements: ["That was very short. Aim for 60–180 words: a clear point and one real example."], flags, by: "rules" };

  // Length: 60–180 words is the sweet spot for a spoken answer.
  let length = 100;
  if (words < 40) { length = 35 + words; improvements.push(`Your answer was ${words} words: add a concrete example (aim for 60–180 words).`); }
  else if (words < 60) length = 80;
  else if (words > 260) { length = 55; improvements.push(`At ${words} words this is long. Trim to the key point, the example and the result.`); }
  else if (words > 180) length = 80;
  else strengths.push("A good length: complete without rambling.");

  // Structure: STAR for behavioural, direct answer + example otherwise.
  const parts = (Object.keys(STAR) as Array<keyof typeof STAR>).filter((k) => STAR[k].test(answer));
  let structure = 40 + parts.length * 15;
  if (question.kind === "behavioural" || question.kind === "gap") {
    if (parts.length >= 3) strengths.push("Clear structure: situation, action and result all come through.");
    else {
      const missing = (["situation", "task", "action", "result"] as const).filter((k) => !parts.includes(k));
      improvements.push(`Use the STAR shape. Still missing: ${missing.slice(0, 2).join(" and ")}.`);
    }
  } else structure = 60 + parts.length * 10;

  // Evidence: numbers and specifics beat generalities.
  const numbers = (answer.match(/\d+(?:[.,]\d+)?\s*(%|percent|lakh|crore|k|x|hours?|days?|weeks?|months?|people|members|users|clients)?/gi) || []).length;
  let evidence = 45 + Math.min(numbers, 3) * 18;
  if (numbers) strengths.push("You backed it up with numbers.");
  else improvements.push("Add one number (time saved, people, money, quality). Only if it is true.");

  // Ownership: "I" vs "we".
  const i = (answer.match(/\bI\b/g) || []).length;
  const we = (answer.match(/\bwe\b/gi) || []).length;
  if (we > i * 2 && we >= 4) { improvements.push("You said “we” much more than “I”. Say what YOU personally did."); evidence -= 10; }

  // Clarity: filler words.
  const fillers = (answer.match(FILLERS) || []).length;
  let clarity = 100 - fillers * 8;
  if (fillers >= 3) improvements.push(`Watch filler words (${fillers} found). A short pause is better than “um” or “basically”.`);
  else if (fillers === 0) strengths.push("Clean delivery with no filler words.");

  // Relevance: does it use the question's own words and the job's skills?
  const rel = overlap(new Set(tokenize(question.question)), new Set(tokenize(answer)));
  const relevance = 45 + Math.min(1, rel * 2.5) * 55;
  if (rel < 0.12) improvements.push("Make sure you answer the question that was asked. Start with a direct one-line answer.");

  // Honesty: skills claimed in the answer that aren't in the candidate's profile.
  const mine = new Set(profile.skills.filter((s) => s.source !== "ai_derived").map((s) => s.key));
  for (const k of extractSkillKeys(answer)) if (!mine.has(k)) flags.push(`You mentioned ${k.replace(/_/g, " ")}, which isn't on your profile. Be ready to explain it, or leave it out.`);

  const score = clamp(length * 0.15 + structure * 0.25 + evidence * 0.25 + clarity * 0.15 + relevance * 0.2);
  return { score, strengths: strengths.slice(0, 3), improvements: improvements.slice(0, 4), flags: flags.slice(0, 3), by: "rules" };
}

const Coach = z.object({ note: z.string().min(10).max(400), betterOpening: z.string().max(300).catch("") });

async function coachNote(uid: string, question: PrepQuestion, answer: string, fb: AnswerFeedback): Promise<AnswerFeedback> {
  try {
    const r = await generateJSON({
      task: "mock_feedback", uid, schema: Coach, cache: false, maxTokens: 400,
      system: `You are a kind, direct interview coach. Give one specific suggestion. Never invent facts about the candidate. ${UNTRUSTED_NOTICE}`,
      prompt: `Question: ${question.question}\nAlready noted by the scorer: ${fb.improvements.join("; ") || "nothing"}\n\n${fenceUntrusted("candidate_answer", answer, 2500)}\n\nReturn {"note": "one coaching sentence", "betterOpening": "a stronger first sentence using only what the candidate said"}`,
    });
    return { ...fb, by: "ai", improvements: [r.note, ...fb.improvements].slice(0, 4), strengths: fb.strengths, ...(r.betterOpening ? { flags: fb.flags } : {}) };
  } catch {
    return fb;
  }
}

const pickQuestions = (all: PrepQuestion[], n: number): PrepQuestion[] => {
  const by = (k: PrepQuestion["kind"]) => all.filter((x) => x.kind === k);
  const order = [by("behavioural")[0], by("technical")[0], by("role")[0], by("gap")[0], by("behavioural")[1], by("technical")[1], by("role")[1]].filter((x): x is PrepQuestion => Boolean(x));
  const seen = new Set<string>();
  return [...order, ...all].filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))).slice(0, n);
};

const GENERIC: PrepQuestion[] = [
  { id: "g_about", kind: "behavioural", question: "Tell me about yourself.", tip: "Two minutes: what you do, your strengths, and what you want next." },
  { id: "g_conflict", kind: "behavioural", question: "Tell me about a time you disagreed with a colleague. How did you handle it?", tip: "Explain both views fairly, what you did, and the result." },
  { id: "g_fail", kind: "behavioural", question: "Describe a mistake you made and what you learned.", tip: "Be genuine; spend most of the time on what you changed." },
  { id: "g_proud", kind: "behavioural", question: "What achievement are you most proud of?", tip: "Pick one with a clear result you can put a number on." },
  { id: "g_why", kind: "role", question: "Why should we hire you?", tip: "Connect two or three of your real strengths to what the role needs." },
];

export async function startMock(uid: string, jobId?: string): Promise<MockSession> {
  const profile = await getProfile(uid);
  if (!profile) throw new AppError(409, "Set up your profile first.");
  let questions = GENERIC;
  let role = profile.preferences.targetRoles[0] || profile.currentRole || "your target role";
  let company: string | undefined;
  if (jobId) {
    const prep = await getPrep(uid, jobId);
    questions = pickQuestions(prep.questions, 5);
    role = prep.role;
    company = prep.company;
  }
  const now = new Date().toISOString();
  const s: MockSession = { id: `mock_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`, uid, jobId, role, company, questions, answers: [], status: "active", createdAt: now };
  await (await getStore()).put("mockInterviews", s.id, s);
  await audit(uid, "mock.started", { sessionId: s.id, jobId });
  return s;
}

export async function getMock(uid: string, id: string): Promise<MockSession> {
  const s = await (await getStore()).get<MockSession>("mockInterviews", id);
  if (!s || s.uid !== uid) throw new AppError(404, "Practice session not found");
  return s;
}

export async function answerMock(uid: string, id: string, text: string): Promise<{ session: MockSession; feedback: AnswerFeedback; next: PrepQuestion | null }> {
  const s = await getMock(uid, id);
  if (s.status !== "active") throw new AppError(409, "This practice session is finished.");
  const question = s.questions[s.answers.length];
  if (!question) throw new AppError(409, "No more questions.");
  const profile = (await getProfile(uid))!;
  let feedback = scoreAnswer(question, text, profile);
  if (wordCount(text) >= 25) feedback = await coachNote(uid, question, text, feedback);
  s.answers.push({ questionId: question.id, text: text.slice(0, 4000), feedback, at: new Date().toISOString() });
  const done = s.answers.length >= s.questions.length;
  if (done) {
    s.status = "done";
    s.finishedAt = new Date().toISOString();
    s.score = Math.round(s.answers.reduce((n, a) => n + a.feedback.score, 0) / s.answers.length);
    await audit(uid, "mock.finished", { sessionId: id, score: s.score });
    // A finished mock counts toward this week's "practise" goal.
    const goal = (await weeklyPlan(uid)).goals.find((g) => g.id === "practise");
    if (goal) await tickGoal(uid, "practise", goal.done + 1).catch(() => undefined);
  }
  await (await getStore()).put("mockInterviews", id, s);
  return { session: s, feedback, next: done ? null : s.questions[s.answers.length] };
}

export async function listMocks(uid: string): Promise<Array<Omit<MockSession, "answers" | "questions"> & { answered: number; total: number }>> {
  const all = await (await getStore()).query<MockSession>("mockInterviews", { where: { uid } });
  return all
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30)
    .map(({ answers, questions, ...rest }) => ({ ...rest, answered: answers.length, total: questions.length }));
}
