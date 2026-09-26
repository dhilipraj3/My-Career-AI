// Shared domain types (server + client). Mirrors the scope's Candidate Intelligence Profile, Job and Application models.

export type Source = "resume" | "user" | "ai_derived" | "imported";

export type WorkMode = "remote" | "hybrid" | "onsite" | "unknown";
export type EmploymentType = "full_time" | "part_time" | "contract" | "internship" | "unknown";

export interface ExperienceEntry {
  id: string;
  company: string;
  designation: string;
  location?: string;
  startDate?: string; // YYYY-MM or YYYY
  endDate?: string; // YYYY-MM | YYYY | "present"
  current: boolean;
  responsibilities: string[];
  achievements: string[];
  tools: string[];
}

export interface SkillEntry {
  name: string; // display name
  key: string; // normalized key
  category: "technical" | "functional" | "domain" | "soft" | "tool";
  years?: number;
  source: Source;
  confidence: number; // 0..1
}

export interface EducationEntry {
  id: string;
  degree: string;
  specialization?: string;
  institution: string;
  gradYear?: string;
}

export interface CertificationEntry {
  id: string;
  name: string;
  provider?: string;
  year?: string;
  expiry?: string;
}

export interface ProjectEntry {
  id: string;
  title: string;
  description: string;
  tools: string[];
}

export interface CandidatePreferences {
  targetRoles: string[];
  industries: string[];
  workModes: WorkMode[];
  locations: string[];
  minSalaryLPA?: number;
  employmentTypes: EmploymentType[];
  noticePeriodDays?: number;
  willingToRelocate?: boolean;
  excludedCompanies: string[];
  excludedKeywords: string[];
  /** What matters most in the next job (growth, pay, stability…). */
  motivations?: string[];
  /** Working hours they can do. Empty = not asked yet. "any" = no preference. */
  shifts?: ShiftPref[];
}

export type Shift = "day" | "night" | "rotational" | "flexible";
export type ShiftPref = Shift | "any";

export type ProfileStatus = "empty" | "parsing" | "needs_info" | "ready";

export interface ProfileMissing {
  field: string;
  question: string;
  essential: boolean;
}

export interface CandidateProfile {
  uid: string;
  fullName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  country: string;
  links: { linkedin?: string; github?: string; portfolio?: string; other?: string[] };
  currentRole: string;
  summary: string;
  totalExperienceYears: number;
  experience: ExperienceEntry[];
  skills: SkillEntry[];
  education: EducationEntry[];
  certifications: CertificationEntry[];
  projects: ProjectEntry[];
  preferences: CandidatePreferences;
  insights: { careerLevel: "fresher" | "junior" | "mid" | "senior" | "lead" | "executive"; jobFamilies: string[]; targetRoleSuggestions: string[] };
  provenance: Record<string, Source>;
  completeness: { score: number; missing: ProfileMissing[] };
  status: ProfileStatus;
  discoveryPaused: boolean;
  automationLevel: 0 | 1 | 2 | 3;
  resumeId?: string;
  lastSeenFeedAt?: string; // for "new since your last visit"
  lastActiveAt?: string; // last time the user opened the app (for gentle nudges)
  placement?: import("./career.js").Placement; // set when the user tells us they got placed
  emailDigest?: import("./career.js").DigestFrequency;
  language?: "en" | "hi";
  createdAt: string;
  updatedAt: string;
}

export interface FeedDiagnosis {
  kind: "location" | "roles" | "skills";
  title: string;
  detail: string;
  cities?: string[];
  skills?: string[];
}

export interface FeedSummary {
  total: number; // fair or better
  bands: { excellent: number; good: number; fair: number; low: number };
  newSinceLastVisit: number;
  lastSeenAt?: string;
  saved: number;
  belowFair: number;
  diagnosis: FeedDiagnosis[];
  roleSuggestions: Array<{ role: string; jobs: number }>;
}

export interface ResumeRecord {
  id: string;
  uid: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  text: string;
  createdAt: string;
  archived: boolean;
}

export interface TailoredResumeContent {
  headline: string;
  summary: string;
  experience: Array<{ experienceId: string; company: string; designation: string; period: string; bullets: string[] }>;
  skills: string[];
  education: Array<{ degree: string; institution: string; gradYear?: string }>;
  certifications: string[];
  projects: Array<{ title: string; description: string }>;
  /** "Why I'm a fit for this role": each point pairs something the job asks for with the candidate's own evidence. */
  fit?: string[];
}

export interface ValidationIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface ResumeVersion {
  id: string;
  uid: string;
  jobId?: string;
  type: "original" | "tailored" | "user_edited";
  content?: TailoredResumeContent;
  text: string;
  validation: { ok: boolean; issues: ValidationIssue[] };
  approved: boolean;
  generatedBy: "ai" | "deterministic" | "user";
  createdAt: string;
}

export type JobFreshness = "new" | "active" | "recently_verified" | "stale" | "potentially_expired" | "expired" | "closed";

export interface JobSourceRef {
  connector: string;
  sourceName: string;
  sourceJobId: string;
  sourceUrl: string;
  applyUrl: string;
  seenAt: string;
}

export interface JobIntelligence {
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  qualifications: string[];
  minExperience?: number;
  maxExperience?: number;
  seniority: string;
  redFlags: string[];
  ambiguities: string[];
  analyzedBy: "ai" | "deterministic";
}

export interface Job {
  id: string;
  title: string;
  normalizedTitle: string;
  company: string;
  companyKey: string;
  companyUrl?: string;
  location: string;
  city: string;
  country: string;
  workMode: WorkMode;
  employmentType: EmploymentType;
  experienceMin?: number;
  experienceMax?: number;
  salaryMinLPA?: number;
  salaryMaxLPA?: number;
  currency: string;
  skills: string[]; // normalized keys
  description: string;
  industry?: string;
  seniority: string;
  postedAt?: string;
  updatedAtSource?: string;
  lastVerifiedAt: string;
  firstSeenAt: string;
  deadline?: string;
  status: JobFreshness;
  sources: JobSourceRef[];
  dedupeKey: string;
  quality: { score: number; flags: string[]; suspicious: boolean };
  intelligence?: JobIntelligence;
  userProvided?: boolean;
  ownerUid?: string; // set for user-provided jobs (private to that user)
  // v2 enrichment (set by normalize; optional so older stored jobs stay valid)
  cities?: string[]; // every Indian city the posting names
  state?: string;
  panIndia?: boolean;
  category?: JobCategory;
  education?: EducationLevel; // minimum the posting asks for
  freshersWelcome?: boolean;
  salaryPeriod?: "year" | "month" | "day" | "hour";
  salaryDisplay?: string; // human text in the posting's own terms, e.g. "₹15,000–20,000/month"
  shift?: Shift; // working hours the posting states (night includes US/UK-hours shifts)
}

export type JobCategory =
  | "tech" | "data_ai" | "design" | "product" | "sales" | "marketing" | "customer_support" | "finance_accounts" | "hr" | "legal"
  | "operations" | "office_admin" | "logistics_delivery" | "driver" | "retail" | "hospitality_food" | "healthcare" | "education"
  | "skilled_trades" | "manufacturing" | "construction_realestate" | "security_facility" | "media_content" | "other";

export type EducationLevel = "none" | "10th" | "12th" | "iti" | "diploma" | "graduate" | "postgraduate";

export type Confidence = "high" | "medium" | "low";

export interface MatchBreakdown {
  skills: number;
  experience: number;
  roleAlignment: number;
  domain: number;
  location: number;
  preferences: number;
}

export interface JobMatch {
  id: string; // `${uid}_${jobId}`
  uid: string;
  jobId: string;
  score: number; // 0..100
  confidence: Confidence;
  breakdown: MatchBreakdown;
  matchedSkills: string[];
  missingSkills: string[];
  hardFailures: string[];
  reasons: string[]; // "why this matches"
  gaps: string[];
  assumptions: string[];
  aiSummary?: string;
  rankScore: number;
  feedback?: MatchFeedbackReason;
  hidden: boolean;
  saved: boolean;
  notified: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MatchFeedbackReason =
  | "not_relevant"
  | "already_applied"
  | "not_interested"
  | "wrong_location"
  | "salary_too_low"
  | "wrong_role"
  | "skill_mismatch"
  | "company_not_preferred";

export type ApplicationStatus =
  | "recommended"
  | "saved"
  | "preparing"
  | "applied"
  | "under_review"
  | "shortlisted"
  | "interview"
  | "offer"
  | "rejected"
  | "withdrawn"
  | "expired";

export interface ApplicationEvent {
  at: string;
  status: ApplicationStatus;
  note?: string;
  actor: "user" | "agent" | "system";
}

export interface ApplicationRecord {
  id: string;
  uid: string;
  jobId: string;
  company: string;
  role: string;
  source: string;
  applyUrl: string;
  mode: "direct" | "assisted";
  status: ApplicationStatus;
  resumeVersionId?: string;
  coverLetter?: string;
  screeningAnswers?: Array<{ question: string; answer: string }>;
  notes: string;
  appliedAt?: string;
  interviewDates: string[];
  followUpAt?: string;
  history: ApplicationEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRecord {
  id: string;
  uid: string;
  kind: "new_jobs" | "application" | "profile" | "resume_ready" | "reminder" | "summary" | "system";
  title: string;
  body: string;
  jobId?: string;
  read: boolean;
  createdAt: string;
}

export interface ConnectorHealth {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  access: string;
  terms: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  jobsRetrieved: number;
  jobsRejected: number;
  duplicates: number;
  errorCount: number;
  status: "healthy" | "degraded" | "failing" | "disabled" | "needs_key" | "not_set_up" | "unknown";
  /** For sources that need a free key: where to get it and what to paste. */
  setup?: { url: string; fields: Array<{ id: string; label: string; secret: boolean; placeholder?: string }>; configured: boolean; from: "env" | "admin" | null; hint?: string };
  intervalMinutes?: number; // per-source override
  lastRun?: { at: string; fetched: number; inserted: number; merged: number; rejected: number; durationMs: number; error?: string };
}

export interface AiUsageRecord {
  id: string; // `${uid}_${YYYY-MM-DD}`
  uid: string;
  date: string;
  creditsUsed: number;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  ownKeyRequests?: number; // served by the user's own key (not metered)
}

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  cards?: Array<{ type: "job"; jobId: string; title: string; company: string; location: string; score?: number }>;
  pendingAction?: PendingAction;
  /** What the assistant did to answer (tools it used), shown as a compact activity line. */
  steps?: ChatStep[];
  /** Changes it made that can be undone from the chat. */
  changes?: Array<{ id: string; summary: string; undone?: boolean }>;
  suggestions?: string[];
  rating?: "up" | "down";
  /** Said out loud in a live voice conversation (shown with a small voice mark). */
  voice?: boolean;
}

export interface ChatStep {
  id: string;
  tool: string;
  label: string;
  state: "running" | "done" | "error";
  detail?: string;
}

export interface PendingAction {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  createdAt: string;
  expiresAt: string;
}

export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  recommended: ["saved", "preparing", "applied", "withdrawn", "expired"],
  saved: ["preparing", "applied", "withdrawn", "expired"],
  preparing: ["applied", "saved", "withdrawn", "expired"],
  applied: ["under_review", "shortlisted", "interview", "offer", "rejected", "withdrawn", "expired"],
  under_review: ["shortlisted", "interview", "offer", "rejected", "withdrawn"],
  shortlisted: ["interview", "offer", "rejected", "withdrawn"],
  interview: ["interview", "offer", "rejected", "withdrawn"],
  offer: ["withdrawn", "rejected"],
  rejected: [],
  withdrawn: [],
  expired: [],
};

// ---------------- Career intelligence (v2) ----------------

/** A saved search / alert: "tell me when a matching job appears". */
export interface Watcher {
  id: string;
  uid: string;
  name: string;
  keywords: string[]; // any-of, matched against title + skills
  companies: string[]; // any-of, empty = all
  locations: string[]; // any-of city names, empty = all
  workModes: WorkMode[]; // empty = all
  minScore: number;
  enabled: boolean;
  lastRunAt?: string;
  lastHitCount: number;
  totalHits: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkillOpportunity {
  skill: string; // display name
  key: string;
  jobsMentioning: number; // matched jobs that list it and you lack it
  jobsUnlocked: number; // jobs that would cross the strong-match line if you had it
  avgScoreLift: number; // average score gain across jobs mentioning it
  adjacentTo: string[]; // your skills that make it quicker to learn
}

export interface SalaryBenchmark {
  roleFamily: string;
  sampleSize: number;
  p25?: number;
  median?: number;
  p75?: number;
  byCity: Array<{ city: string; median: number; sampleSize: number }>;
  yourMinimum?: number;
  verdict: "below_market" | "at_market" | "above_market" | "insufficient_data";
}

export interface FunnelStats {
  total: number;
  applied: number;
  responded: number;
  interviews: number;
  offers: number;
  rejected: number;
  responseRate: number; // 0..100
  interviewRate: number;
  offerRate: number;
  medianDaysToResponse?: number;
  weekly: Array<{ week: string; applied: number }>;
  byStage: Record<string, number>;
}

export interface MarketPulse {
  jobsAnalysed: number;
  strongMatches: number;
  topSkillsInDemand: Array<{ skill: string; jobs: number; youHaveIt: boolean }>;
  topCompanies: Array<{ company: string; jobs: number; bestScore: number }>;
  workModeSplit: Record<string, number>;
  skillCoverage: number; // % of in-demand skills you have
}

export interface CareerInsights {
  generatedAt: string;
  skillOpportunities: SkillOpportunity[];
  salary: SalaryBenchmark;
  funnel: FunnelStats;
  market: MarketPulse;
}

export interface HealthCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fix?: string;
  weight: number;
}

export interface ResumeHealth {
  score: number; // 0..100
  grade: "A" | "B" | "C" | "D";
  checks: HealthCheck[];
  stats: { words: number; bullets: number; quantifiedBullets: number; weakPhrases: number; actionVerbBullets: number };
}

export interface StoryAnchor {
  id: string;
  company: string;
  designation: string;
  text: string; // verbatim achievement/responsibility from the profile
  skills: string[];
}

export interface InterviewQuestion {
  id: string;
  kind: "technical" | "behavioural" | "role" | "gap" | "company";
  question: string;
  why: string; // why they'll likely ask it
  answerHint: string;
  storyIds: string[]; // which of YOUR stories to use
}

export interface InterviewPrep {
  id: string; // `${uid}_${jobId}`
  uid: string;
  jobId: string;
  company: string;
  role: string;
  questions: InterviewQuestion[];
  stories: StoryAnchor[];
  questionsToAsk: string[];
  gapStrategies: Array<{ skill: string; strategy: string }>;
  checklist: string[];
  generatedBy: "ai" | "deterministic";
  createdAt: string;
}

export type NextActionKind = "interview_prep" | "follow_up" | "finish_application" | "review_match" | "complete_profile" | "improve_resume" | "learn_skill" | "search" | "create_watcher";

export interface NextAction {
  id: string;
  kind: NextActionKind;
  priority: number; // higher first
  title: string;
  detail: string;
  jobId?: string;
  applicationId?: string;
  skill?: string;
  due?: string;
}

export type MessageKind = "follow_up" | "thank_you" | "withdraw" | "accept" | "negotiate";

// ---------------- Company registry (job sourcing) ----------------

export type CompanyAts = "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workday" | "oracle" | "recruitee" | "workable" | "teamtailor" | "careers_page";

export interface CompanyRecord {
  id: string;
  name: string;
  ats: CompanyAts;
  board: string; // ATS-specific board id (see server/jobs/detect.ts)
  careersUrl?: string;
  industries: string[];
  enabled: boolean;
  status: "unverified" | "active" | "empty" | "dead";
  origin: "seed" | "admin" | "auto"; // auto = found in a job link by the self-growing registry
  lastFetchedAt?: string;
  lastJobCount: number;
  lastError?: string;
  errorCount: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------- Job search ----------------

export interface JobQuery {
  q?: string;
  cities?: string[]; // any of; Pan-India and remote jobs are included unless `strictCity`
  strictCity?: boolean;
  workModes?: WorkMode[];
  employmentTypes?: EmploymentType[];
  categories?: JobCategory[];
  companies?: string[];
  experienceYears?: number; // show jobs whose minimum experience is <= this
  minSalaryLPA?: number; // excludes jobs that don't disclose pay
  maxEducation?: EducationLevel; // jobs asking for at most this
  freshersOnly?: boolean;
  postedWithinDays?: number;
  sort?: "match" | "relevance" | "newest" | "salary";
  /** "For you": only jobs scored for this user, within a score range, not hidden or already applied. */
  matchedOnly?: boolean;
  savedOnly?: boolean;
  minScore?: number;
  maxScore?: number;
  page?: number; // 1-based
  pageSize?: number;
}

export interface JobSearchHit {
  job: Job;
  matchScore?: number;
  matchConfidence?: Confidence;
  reason?: string; // "why it fits" one-liner
  gap?: string;
  saved?: boolean;
  matchedAt?: string; // when this job was first scored for the user ("new since your last visit")
}

export interface JobSearchResult {
  hits: JobSearchHit[];
  total: number;
  page: number;
  pageSize: number;
  facets: Record<"category" | "workMode" | "employmentType" | "education" | "city", Record<string, number>>;
  expandedTerms: string[]; // synonyms we added to the query, shown to the user
  indexSize: number;
}
