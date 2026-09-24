// Phase 1 (understanding the user) and Phase 2 (placement companion) shared shapes.

// ---------------- Understanding (confidence model) ----------------
export type UnderstandingAreaId = "role" | "skills" | "experience" | "locationPay" | "availability" | "motivation";

export interface UnderstandingArea {
  id: UnderstandingAreaId;
  label: string;
  score: number; // 0..100
  /** What we know and where it came from, in plain words. */
  evidence: string[];
  /** What is still unclear. */
  gaps: string[];
}

export interface QuestionChoice {
  value: string;
  label: string;
}

export interface UnderstandingQuestion {
  id: string; // e.g. "role", "skills_confirm", "salary"
  area: UnderstandingAreaId;
  text: string;
  why: string; // why this question matters for the matches
  choices: QuestionChoice[];
  multi: boolean;
  allowText: boolean;
  placeholder?: string;
}

export interface Guess {
  kind: "skill" | "role";
  key: string;
  label: string;
}

export interface Understanding {
  score: number; // overall 0..100
  ready: boolean; // at or above the full-power threshold
  threshold: number;
  areas: UnderstandingArea[];
  next: UnderstandingQuestion | null;
  guesses: Guess[];
  /** "What I understand about you" in two or three readable sentences. */
  summary: string;
}

// ---------------- Role discovery ----------------
export interface RolePath {
  role: string;
  source: "your target" | "your current role" | "suggested" | "similar role";
  jobsIndia: number;
  jobsNearYou: number;
  salaryLPA?: { low: number; median: number; high: number; samples: number };
  fitPct: number; // share of commonly-asked skills the user has
  have: string[];
  missing: string[];
  note?: string; // honest market check
  targeted: boolean;
}

// ---------------- Resume builder & health ----------------
export interface BuiltResume {
  name: string;
  headline: string;
  contact: string[];
  summary: string;
  experience: Array<{ title: string; company: string; period: string; location?: string; bullets: string[] }>;
  skills: string[];
  education: Array<{ degree: string; institution: string; year?: string }>;
  certifications: string[];
  projects: Array<{ title: string; description: string }>;
}

export interface ResumeCheck {
  id: string;
  label: string;
  ok: boolean;
  points: number; // earned
  max: number;
  fix?: string;
}

export interface ResumeHealth {
  score: number; // 0..100
  checks: ResumeCheck[];
  keywordsMissing: string[];
  targetRole?: string;
}

// ---------------- Placement companion ----------------
export type JourneyStage = "understanding" | "searching" | "applying" | "interviewing" | "offer" | "placed";
export const JOURNEY_STAGES: JourneyStage[] = ["understanding", "searching", "applying", "interviewing", "offer", "placed"];

export interface NextAction {
  id: string;
  kind: "interview" | "offer" | "follow_up" | "finish_application" | "new_matches" | "question" | "outcome" | "resume" | "skill" | "plan" | "ai_key" | "apply";
  priority: number; // higher first
  title: string;
  detail: string;
  cta: { label: string; page?: string; jobId?: string; chat?: string };
}

export interface ApplicationPulse {
  active: number;
  applied: number;
  responses: number; // moved past "applied"
  interviews: number;
  offers: number;
  responseRate: number | null; // 0..100, null until there's enough data
  upcoming: Array<{ applicationId: string; jobId: string; company: string; role: string; at: string }>;
}

export interface Journey {
  stage: JourneyStage;
  stageIndex: number;
  understanding: number;
  pulse: ApplicationPulse;
  actions: NextAction[];
  placement?: Placement;
}

export interface Placement {
  company: string;
  role: string;
  joiningDate?: string;
  salaryLPA?: number;
  applicationId?: string;
  at: string;
}

export interface PlanGoal {
  id: "apply" | "practise" | "learn" | "profile";
  title: string;
  detail: string;
  target: number;
  done: number;
  auto: boolean; // progress tracked automatically
}

export interface WeeklyPlan {
  id: string; // `${uid}_${weekStart}`
  uid: string;
  weekStart: string; // Monday, YYYY-MM-DD
  goals: PlanGoal[];
  manual: Record<string, number>; // ticks for self-reported goals
  createdAt: string;
}

export interface ActivityItem {
  at: string;
  who: "you" | "assistant" | "system";
  text: string;
}

export type DigestFrequency = "off" | "daily" | "weekly";
