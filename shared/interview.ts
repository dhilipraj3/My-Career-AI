// Phase 3 (apply & interview) shared shapes: interview prep, mock interviews, messages, offers, salary benchmarks.

export type QuestionKind = "technical" | "behavioural" | "role" | "gap";

export interface PrepQuestion {
  id: string;
  kind: QuestionKind;
  question: string;
  /** How to approach it, tied to the candidate's own background where possible. */
  tip: string;
  /** The candidate's own fact this answer can lean on (never invented). */
  evidence?: string;
}

/** A story built from one real fact of the candidate's, with prompts for the parts only they can supply. */
export interface PrepStory {
  id: string;
  skill: string;
  source: string; // "Senior PM at Infosys"
  fact: string;
  prompts: { situation: string; task: string; action: string; result: string };
}

export interface InterviewPrep {
  id: string; // `${uid}_${jobId}`
  uid: string;
  jobId: string;
  role: string;
  company: string;
  questions: PrepQuestion[];
  stories: PrepStory[];
  askEmployer: string[];
  checklist: string[];
  generatedBy: "ai" | "rules";
  createdAt: string;
}

export interface AnswerFeedback {
  score: number; // 0..100
  strengths: string[];
  improvements: string[];
  /** Things the answer claims that are not in the candidate's profile: be ready to explain or drop them. */
  flags: string[];
  by: "ai" | "rules";
}

export interface MockAnswer {
  questionId: string;
  text: string;
  feedback: AnswerFeedback;
  at: string;
}

export interface MockSession {
  id: string;
  uid: string;
  jobId?: string;
  role: string;
  company?: string;
  questions: PrepQuestion[];
  answers: MockAnswer[];
  status: "active" | "done";
  score?: number;
  createdAt: string;
  finishedAt?: string;
}

export type MessageKind = "follow_up" | "thank_you" | "withdraw" | "accept" | "decline" | "negotiate";

export interface DraftMessage {
  kind: MessageKind;
  subject: string;
  body: string;
  /** Anything the user must fill in or check before sending. */
  notes: string[];
}

export interface SalaryBenchmark {
  role: string;
  city?: string;
  scope: "city" | "india";
  lowLPA: number;
  medianLPA: number;
  highLPA: number;
  samples: number; // postings with a stated salary
  postings: number; // all matching live postings
}

export interface OfferInput {
  company: string;
  role: string;
  /** Annual fixed pay in LPA. */
  fixedLPA: number;
  variableLPA?: number;
  joiningBonusLakh?: number;
  commuteMinutes?: number;
  wfhDaysPerWeek?: number;
  /** 1 (little) to 5 (a lot). */
  growth?: number;
  benefits?: string[];
}

export interface OfferAnalysis extends OfferInput {
  /** Estimated monthly take-home from fixed pay (new tax regime, employee PF, professional tax). */
  monthlyInHand: number;
  totalFirstYearLPA: number;
  estimate: true;
}

export interface OfferComparison {
  offers: OfferAnalysis[];
  highlights: Array<{ label: string; company: string }>;
  notes: string[];
}
