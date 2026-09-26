// Phase 5.1 career insights: what to learn, how the search is going, and what the market looks like.

export interface LearnLink { label: string; url: string; free: true }

export interface SkillRoi {
  key: string;
  skill: string;
  /** Jobs that would move up into "Good match" (65+) or better if the person had this skill. */
  newStrong: number;
  /** Of those, jobs that would become "Excellent" (80+). */
  newExcellent: number;
  /** Live jobs in the person's pool that ask for it. */
  jobsAsking: number;
  links: LearnLink[];
}

export interface LearningRoi {
  skills: SkillRoi[];
  /** Jobs re-scored to work this out. */
  jobsChecked: number;
  note?: string;
}

export interface FunnelStats {
  applied: number;
  responses: number;
  interviews: number;
  offers: number;
  rejected: number;
  /** null until there are at least 5 applications, so tiny samples don't mislead. */
  responseRate: number | null;
  interviewRate: number | null;
  offerRate: number | null;
  medianDaysToResponse: number | null;
  /** Applications sent in each of the last 8 weeks, oldest first. */
  weekly: Array<{ weekStart: string; applied: number }>;
  bySource: Array<{ source: string; applied: number; responses: number }>;
  insight: string;
}

export interface MarketPulse {
  role: string;
  city?: string;
  openings: number;
  openingsInIndia: number;
  newThisWeek: number;
  previousWeek: number;
  workMode: { remote: number; hybrid: number; onsite: number };
  topSkills: Array<{ skill: string; jobs: number }>;
  topCompanies: Array<{ company: string; jobs: number }>;
  salary: { lowLPA: number; medianLPA: number; highLPA: number; samples: number; scope: "city" | "india" } | null;
}
