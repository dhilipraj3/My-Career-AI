import { ArrowRight, Briefcase, CheckCircle2, PartyPopper, Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { ApplicationRecord, FeedSummary, JobSearchHit, JobSearchResult } from "@shared/types";
import type { AiState, Me } from "../App";
import JobCard from "../components/JobCard";
import SyncBadge from "../components/SyncBadge";
import { ActivityCard, NextActions, PlacedBanner, PlacedModal, PulseCard, WeeklyPlanCard, type CompanionData } from "../components/MissionControl";
import UnderstandingCard from "../components/UnderstandingCard";
import { api } from "../lib/api";
import { firstName } from "../lib/labels";
import { CountUp } from "../lib/motion";
import { useNav, type Page } from "../lib/nav";
import { Button, Card, JobCardSkeleton, Progress, Section, Skeleton, Stat, cn } from "../ui";
import { JOURNEY_STAGES } from "@shared/career";

const STAGE_LABEL: Record<string, string> = { understanding: "Profile", searching: "Searching", applying: "Applying", interviewing: "Interviewing", offer: "Offer", placed: "Placed" };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Dashboard({ me, ai }: { me: Me; ai: AiState }) {
  const nav = useNav();
  const [summary, setSummary] = useState<FeedSummary | null>(null);
  const [apps, setApps] = useState<ApplicationRecord[] | null>(null);
  const [top, setTop] = useState<JobSearchHit[] | null>(null);
  const [co, setCo] = useState<CompanionData | null>(null);
  const [placing, setPlacing] = useState(false);
  const loadCo = () => void api<CompanionData>("/companion/journey").then(setCo).catch(() => undefined);

  useEffect(() => {
    void api<FeedSummary>("/feed/summary").then(setSummary).catch(() => undefined);
    void api<{ applications: ApplicationRecord[] }>("/applications").then((r) => setApps(r.applications)).catch(() => setApps([]));
    loadCo();
    void api<JobSearchResult>("/jobs/search?matchedOnly=true&minScore=50&sort=match&pageSize=3").then((r) => setTop(r.hits)).catch(() => setTop([]));
  }, []);

  const p = me.profile;
  const stage = co?.journey ? co.journey.stageIndex : 1;
  const now = Date.now();
  const interviews = (apps || []).flatMap((a) => a.interviewDates.filter((d) => new Date(d).getTime() >= now - 3600_000));
  const active = (apps || []).filter((a) => !["rejected", "withdrawn", "expired", "recommended", "saved"].includes(a.status));

  const tile = (page: Page) => () => nav.go(page);
  return (
    <div className="space-y-6">
      <section className="hero-gradient overflow-hidden rounded-3xl border border-white/80 p-6 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-8">
        <p className="text-sm font-medium text-brand-700">{greeting()},</p>
        <h1 className="mt-0.5 text-3xl font-extrabold sm:text-4xl">{firstName(p.fullName) || "there"} 👋</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          {!summary ? "Checking what's new for you…" : summary.newSinceLastVisit > 0 ? <><strong className="text-ink">{summary.newSinceLastVisit} new matches</strong> since your last visit. </> : null}
          {summary && (summary.bands.excellent > 0 ? <>You have <strong className="text-ink">{summary.bands.excellent} excellent</strong> {summary.bands.excellent === 1 ? "match" : "matches"} waiting.</> : summary.total > 0 ? <>No excellent matches yet — a couple of quick changes below can unlock them.</> : <>I'm searching for jobs that fit you.</>)}
        </p>
        <div className="mt-2"><SyncBadge /></div>
        <ol className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Your job search journey">
          {JOURNEY_STAGES.map((k, i) => { const s = STAGE_LABEL[k]; return (
            <li key={s} className="space-y-1.5">
              <div className={cn("h-1.5 rounded-full", i < stage ? "bg-emerald-500" : i === stage ? "bg-brand-600" : "bg-slate-200")} />
              <p className={cn("flex items-center gap-1 text-xs font-medium", i < stage ? "text-emerald-700" : i === stage ? "text-brand-700" : "text-slate-400")}>{i < stage && <CheckCircle2 className="h-3.5 w-3.5" />}{s}</p>
            </li>
          ); })}
        </ol>
        {co?.journey && !co.journey.placement && stage >= 2 && <button className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:underline" onClick={() => setPlacing(true)}><PartyPopper className="h-4 w-4" />I got placed</button>}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Matches for you" value={summary ? <CountUp value={summary.total} /> : <Skeleton className="h-7 w-16" />} hint="fair or better" onClick={tile("matches")} icon={<Sparkles className="h-3.5 w-3.5" />} />
        <Stat label="Strong matches" tone="green" value={summary ? <CountUp value={summary.bands.excellent + summary.bands.good} /> : <Skeleton className="h-7 w-10" />} hint={summary ? `${summary.bands.excellent} excellent · ${summary.bands.good} good` : " "} onClick={tile("matches")} />
        <Stat label="Applications" tone="brand" value={apps ? active.length : <Skeleton className="h-7 w-10" />} hint={interviews.length ? `${interviews.length} interview${interviews.length === 1 ? "" : "s"} coming up` : "in progress"} onClick={tile("applications")} icon={<Briefcase className="h-3.5 w-3.5" />} />
        <Stat label="Profile strength" tone={p.completeness.score >= 90 ? "green" : "amber"} value={<><CountUp value={p.completeness.score} />%</>} hint={<Progress value={p.completeness.score} tone={p.completeness.score >= 90 ? "green" : "amber"} className="mt-1.5 h-1.5" />} onClick={tile("profile")} />
      </div>

      {co?.journey?.placement && <PlacedBanner placement={co.journey.placement} onUndo={async () => { await api("/companion/placed", { method: "DELETE" }); loadCo(); }} />}
      {co?.journey && !co.journey.placement && (
        <div className="grid gap-6 lg:grid-cols-2"><NextActions actions={co.journey.actions} /><WeeklyPlanCard plan={co.plan} onChange={(plan) => setCo({ ...co, plan })} /></div>
      )}
      <PlacedModal open={placing} onClose={() => setPlacing(false)} onDone={() => { setPlacing(false); loadCo(); void nav.refresh(); }} />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Section title="Top picks for you" action={<Button variant="ghost" size="sm" onClick={tile("matches")}>See all<ArrowRight className="h-4 w-4" /></Button>}>
          {top === null ? <div className="space-y-3"><JobCardSkeleton /><JobCardSkeleton /></div> : top.length === 0 ? (
            <Card className="text-sm text-slate-600">No matches yet. I'm searching every source — check back in a few minutes, or <button className="font-medium text-brand-600 underline" onClick={tile("search")}>search all jobs</button>.</Card>
          ) : <ul className="grid gap-3">{top.map((h) => <li key={h.job.id}><JobCard job={h.job} score={h.matchScore} reason={h.reason} gap={h.gap} onOpen={nav.openJob} /></li>)}</ul>}
        </Section>

        <div className="space-y-6">
          <UnderstandingCard onChanged={() => void nav.refresh()} />
          {co?.journey && <PulseCard journey={co.journey} />}
          {co && <ActivityCard activity={co.activity} />}

          <AiCard ai={ai} usage={me.usage} />
        </div>
      </div>
    </div>
  );
}

function AiCard({ ai, usage }: { ai: AiState; usage: Me["usage"] }): ReactNode {
  const nav = useNav();
  if (ai.ownKey?.status === "ok") return (
    <Card className="flex items-center gap-3 p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Sparkles className="h-[18px] w-[18px]" /></span>
      <div className="flex-1 text-sm"><p className="font-semibold text-ink">Smart assistant: unlimited</p><p className="text-xs text-slate-500">Using your own Google AI key (…{ai.ownKey.last4})</p></div>
    </Card>
  );
  return (
    <Card className="space-y-3 bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white">
      <p className="flex items-center gap-2 font-display font-semibold"><Sparkles className="h-5 w-5" />{ai.available ? "AI allowance today" : "Smart assistant is off"}</p>
      {ai.available ? (
        <><Progress value={(usage.used / Math.max(1, usage.limit)) * 100} className="bg-white/20 [&>div]:bg-white" /><p className="text-xs text-brand-100">{usage.remaining} of {usage.limit} credits left today. Add your own free key for unlimited use.</p></>
      ) : <p className="text-sm text-brand-100">Add your free Google AI key to chat naturally, tailor resumes with AI and get interview help.</p>}
      <Button variant="secondary" size="sm" onClick={nav.openAiSetup} className="w-full ring-0">Unlock unlimited AI — free</Button>
    </Card>
  );
}
