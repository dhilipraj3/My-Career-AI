// Phase 4.3 (employer side): free direct job posting, moderation, and matched candidates.

export type EmployerStatus = "verified" | "pending" | "blocked";

export interface Employer {
  uid: string;
  company: string;
  website: string;
  contactName: string;
  contactEmail: string;
  /** True when the sign-in email is on the company's own website domain. Otherwise an admin reviews it. */
  domainVerified: boolean;
  status: EmployerStatus;
  createdAt: string;
}

export type EmployerJobStatus = "live" | "pending_review" | "rejected" | "closed";

export interface EmployerJob {
  id: string;
  employerUid: string;
  title: string;
  company: string;
  location: string;
  description: string;
  salaryText?: string;
  employmentType?: "full_time" | "part_time" | "contract" | "internship";
  remote?: boolean;
  status: EmployerJobStatus;
  /** Why it is waiting for review, or was rejected: plain-language reasons. */
  reasons: string[];
  jobId?: string; // set once it is live
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export type DirectApplicationStatus = "new" | "shortlisted" | "rejected" | "hired";

/** What the candidate chose to share when they applied, and nothing more. */
export interface SharedProfile {
  name: string;
  email: string;
  phone: string;
  city: string;
  currentRole: string;
  experienceYears: number;
  skills: string[];
  summary: string;
  education: string[];
  message?: string;
}

export interface DirectApplication {
  id: string;
  employerJobId: string;
  jobId: string;
  candidateUid: string;
  employerUid: string;
  shared: SharedProfile;
  matchScore: number;
  reasons: string[];
  gaps: string[];
  status: DirectApplicationStatus;
  employerNote?: string;
  createdAt: string;
  updatedAt: string;
}

export type ReportReason = "scam" | "fee_requested" | "fake_company" | "misleading" | "discriminatory" | "other";
export const REPORT_REASONS: ReportReason[] = ["scam", "fee_requested", "fake_company", "misleading", "discriminatory", "other"];

export interface JobReport {
  id: string;
  jobId: string;
  reporterUid: string;
  reason: ReportReason;
  note?: string;
  at: string;
  handled: boolean;
}

export const EMPLOYER_LIMITS = { postsPerDayVerified: 5, postsPerDayPending: 2, reportsToHide: 3, liveDays: 60 };
