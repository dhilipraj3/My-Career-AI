import { Bookmark, Briefcase, Clock, GraduationCap, IndianRupee, MapPin, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { Confidence, Job } from "@shared/types";
import { CATEGORY_LABELS, EDUCATION_LABELS, locationText, salaryText, sourceLabel } from "../lib/labels";
import { Badge, CompanyMark, ScoreRing, cn, timeAgo, titleCase } from "../ui";

export interface JobCardProps {
  job: Job;
  score?: number;
  confidence?: Confidence;
  reason?: string;
  gap?: string;
  saved?: boolean;
  isNew?: boolean;
  onOpen: (id: string) => void;
  onSave?: (saved: boolean) => void;
  actions?: ReactNode;
  compact?: boolean;
}

const Fact = ({ icon: Icon, children }: { icon: typeof MapPin; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1 whitespace-nowrap"><Icon className="h-3.5 w-3.5 text-slate-400" />{children}</span>
);

/** Keep the first reason short: "9 of 10 required skills found in your profile (…long list…)" → without the list. */
const shortReason = (r?: string) => r?.replace(/\s*\((?:[^()]*)\)\s*$/, "");

export default function JobCard({ job, score, confidence, reason, gap, saved, isNew, onOpen, onSave, actions, compact }: JobCardProps) {
  const pay = salaryText(job);
  const exp = job.experienceMin !== undefined ? `${job.experienceMin}${job.experienceMax ? `–${job.experienceMax}` : "+"} yrs` : null;
  return (
    <article className={cn("group relative rounded-2xl border border-slate-200/80 bg-white shadow-[var(--shadow-card)] transition hover:-translate-y-px hover:border-brand-200 hover:shadow-[var(--shadow-lift)]", compact ? "p-4" : "p-5")}>
      <div className="flex gap-4">
        <CompanyMark name={job.company} size={compact ? 40 : 48} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <button onClick={() => onOpen(job.id)} className="min-w-0 text-left after:absolute after:inset-0 after:rounded-2xl after:content-['']">
              <h3 className={cn("line-clamp-2 font-semibold leading-snug text-ink group-hover:text-brand-700", compact ? "text-[15px]" : "text-base")}>{job.title}</h3>
            </button>
            {isNew && <Badge tone="brand" className="shrink-0">New</Badge>}
          </div>
          <p className="mt-0.5 truncate text-sm text-slate-600">{job.company}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            <Fact icon={MapPin}>{locationText(job)}{job.workMode === "hybrid" ? " · Hybrid" : job.workMode === "onsite" ? " · On-site" : ""}</Fact>
            {pay && <Fact icon={IndianRupee}><span className="font-medium text-emerald-700">{pay.replace(/^₹/, "")}</span></Fact>}
            {exp && <Fact icon={Briefcase}>{exp}</Fact>}
            {!compact && job.education && ["10th", "12th", "iti", "diploma", "none"].includes(job.education) && <Fact icon={GraduationCap}>{EDUCATION_LABELS[job.education]}</Fact>}
            <Fact icon={Clock}>{timeAgo(job.postedAt || job.firstSeenAt)}</Fact>
          </div>
          {!compact && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {job.freshersWelcome && <Badge tone="green">Freshers welcome</Badge>}
              {job.category && job.category !== "other" && <Badge>{CATEGORY_LABELS[job.category]}</Badge>}
              {job.employmentType !== "full_time" && job.employmentType !== "unknown" && <Badge tone="sky">{titleCase(job.employmentType)}</Badge>}
              {job.status === "stale" && <Badge tone="amber">May be closed</Badge>}
              {confidence === "low" && <Badge tone="amber">Limited job details</Badge>}
            </div>
          )}
          {!compact && (reason || gap) && (
            <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
              {reason && <p className="flex items-start gap-1.5 text-slate-700"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" /><span className="line-clamp-1">{shortReason(reason)}</span></p>}
              {gap && <p className="flex items-start gap-1.5 text-amber-700"><span className="mt-0.5 h-3.5 w-3.5 shrink-0 text-center text-xs font-bold leading-none">!</span><span className="line-clamp-1">{gap}</span></p>}
            </div>
          )}
          {!compact && <p className="mt-2 text-[11px] text-slate-400">{sourceLabel(job)}</p>}
        </div>
        <div className="relative z-10 flex shrink-0 flex-col items-center gap-2">
          {score !== undefined && <ScoreRing score={score} size={compact ? 44 : 54} showLabel={!compact} />}
          <div className="flex items-center gap-0.5">
            {onSave && (
              <button aria-label={saved ? "Remove from saved" : "Save job"} title={saved ? "Saved" : "Save"} onClick={() => onSave(!saved)} className={cn("rounded-lg p-1.5 transition", saved ? "text-brand-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700")}>
                <Bookmark className={cn("h-[18px] w-[18px]", saved && "fill-current")} />
              </button>
            )}
            {actions}
          </div>
        </div>
      </div>
    </article>
  );
}
