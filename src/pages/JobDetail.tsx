import { AlertTriangle, ArrowLeft, Bookmark, Briefcase, Building2, CheckCircle2, Clock, Copy, ExternalLink, GraduationCap, IndianRupee, MapPin, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ApplicationRecord, Job, JobMatch, JobSearchHit, ResumeVersion, TailoredResumeContent } from "@shared/types";
import type { Me } from "../App";
import JobCard from "../components/JobCard";
import { api, errMsg } from "../lib/api";
import { track } from "../lib/analytics";
import { CATEGORY_LABELS, EDUCATION_LABELS, salaryText, sourceLabel } from "../lib/labels";
import { celebrate } from "../lib/motion";
import { useNav } from "../lib/nav";
import { BAND_LABEL, Badge, BandPill, Button, Card, CompanyMark, ErrorNote, ScoreRing, Section, Skeleton, bandOf, cn, timeAgo, sentenceCase, useToast } from "../ui";
import FormHelper from "../components/FormHelper";
import { DirectApply, ReportJob } from "../components/DirectApply";
import ResumeView from "./ResumeView";

interface Package {
  application: ApplicationRecord;
  resume: ResumeVersion | null;
  coverLetter: string;
  willShare: string[];
  nextStep: string;
}

const BREAKDOWN: Array<[keyof JobMatch["breakdown"], string]> = [["skills", "Skills"], ["experience", "Experience"], ["roleAlignment", "Role fit"], ["domain", "Similar work"], ["location", "Location"], ["preferences", "Your preferences"]];

const Bar = ({ label, value }: { label: string; value: number }) => (
  <div>
    <div className="mb-1 flex justify-between text-xs"><span className="text-slate-600">{label}</span><span className="font-medium tabular-nums text-ink">{value}%</span></div>
    <div className="h-1.5 rounded-full bg-slate-100"><div className={cn("h-full rounded-full transition-all duration-700", value >= 75 ? "bg-emerald-500" : value >= 50 ? "bg-brand-500" : "bg-amber-400")} style={{ width: `${value}%` }} /></div>
  </div>
);

const Fact = ({ icon: Icon, children }: { icon: typeof MapPin; children: ReactNode }) => <span className="inline-flex items-center gap-1.5"><Icon className="h-4 w-4 text-slate-400" />{children}</span>;

const DESC_PREVIEW = 1400;

export default function JobDetail({ jobId, onBack, onChanged, openChat, me }: { jobId: string; onBack: () => void; onChanged: () => void; openChat: () => void; me: Me }) {
  const nav = useNav();
  const toast = useToast();
  const [data, setData] = useState<{ job: Job; match: JobMatch | null; application: ApplicationRecord | null } | null>(null);
  const [pkg, setPkg] = useState<Package | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fullDesc, setFullDesc] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [related, setRelated] = useState<{ sameCompany: JobSearchHit[]; similar: JobSearchHit[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api(`/jobs/${jobId}`);
      setData(d); setError(null);
      const band = (s: number) => (s >= 80 ? "excellent" : s >= 65 ? "good" : s >= 50 ? "fair" : "low");
      track("job_view", { category: d.job?.category, work_mode: d.job?.workMode, match_band: d.match ? band(d.match.score) : "none" });
    } catch (e) { setError(errMsg(e)); }
  }, [jobId]);
  useEffect(() => { setData(null); setPkg(null); setFullDesc(false); void load(); }, [load]);
  useEffect(() => {
    setRelated(null);
    void api<{ sameCompany: JobSearchHit[]; similar: JobSearchHit[] }>(`/jobs/${jobId}/related`).then(setRelated).catch(() => undefined);
  }, [jobId]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null);
    try { await fn(); } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  };

  const back = <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-ink"><ArrowLeft className="h-4 w-4" />Back</button>;
  if (!data) return (
    <div className="space-y-4">{back}{error ? <ErrorNote error={error} /> : (
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]"><div className="space-y-4"><Skeleton className="h-40 w-full rounded-2xl" /><Skeleton className="h-64 w-full rounded-2xl" /></div><Skeleton className="h-72 w-full rounded-2xl" /></div>
    )}</div>
  );

  const { job, match, application } = data;
  const src = job.sources.find((s) => s.applyUrl) || job.sources[0];
  const pay = salaryText(job);
  const direct = job.sources.some((s) => s.connector === "employer");
  const activeApp = pkg?.application || application;
  const resume = pkg?.resume;

  const prepare = (regenerate = false) => run("prepare", async () => {
    const r = await api<Package>(`/jobs/${job.id}/prepare`, { body: { regenerate } });
    setPkg(r); setResumeError(null); onChanged(); await load();
    setTimeout(() => document.getElementById("apply-panel")?.scrollIntoView({ behavior: "smooth" }), 50);
  });
  const approve = (edited?: TailoredResumeContent) => run("approve", async () => {
    try {
      const r = await api<{ version: ResumeVersion }>(`/resume-versions/${pkg!.resume!.id}/approve`, { body: edited ? { content: edited } : {} });
      setPkg({ ...pkg!, resume: r.version }); setResumeError(null); toast("success", "Resume approved");
    } catch (e) {
      setResumeError(errMsg(e));
      const v = await api<{ version: ResumeVersion }>(`/resume-versions/${pkg!.resume!.id}`).catch(() => null);
      if (v) setPkg({ ...pkg!, resume: v.version });
    }
  });
  const setStatus = (status: string, note?: string) => run("status", async () => {
    await api(`/applications/${activeApp!.id}/status`, { body: { status, note } });
    if (status === "applied") track("application_applied", { from: "job" });
    setPkg(null); await load(); onChanged(); celebrate(); toast("success", "Applied! 🎉 I'll remind you to follow up in a week.");
  });
  const openEmployer = () => run("open", async () => {
    const r = await api<{ applyUrl: string }>(`/jobs/${job.id}/direct-apply`, { body: { confirm: true } });
    track("apply_click", { from: "job", category: job.category });
    window.open(r.applyUrl, "_blank", "noopener,noreferrer");
    await load();
  });
  const toggleSave = () => run("save", async () => {
    const r = await api<{ match: JobMatch }>(`/jobs/${job.id}/save`, { body: { saved: !match?.saved } });
    setData({ ...data, match: r.match }); toast("success", r.match.saved ? "Saved" : "Removed from saved");
    if (r.match.saved) track("job_save", { from: "job" });
  });
  const explain = () => run("explain", async () => { const r = await api<{ match: JobMatch }>(`/jobs/${job.id}/explain`, { body: {} }); setData({ ...data, match: r.match }); });

  const desc = job.description;
  const shownDesc = fullDesc || desc.length <= DESC_PREVIEW ? desc : `${desc.slice(0, DESC_PREVIEW).trimEnd()}…`;

  return (
    <div className="space-y-5">
      {back}
      <ErrorNote error={error} />

      <Card className="p-6">
        <div className="flex flex-col gap-5 sm:flex-row">
          <CompanyMark name={job.company} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold leading-tight">{job.title}</h1>
            <p className="mt-1 text-slate-700">{job.company}</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
              <Fact icon={MapPin}>{job.workMode === "remote" ? "Remote" : job.panIndia ? "Pan India" : job.cities?.length ? job.cities.join(", ") : job.city || job.location || "Location not stated"}{job.workMode === "hybrid" ? " · Hybrid" : job.workMode === "onsite" ? " · On-site" : ""}</Fact>
              <Fact icon={IndianRupee}>{pay ? <span className="font-medium text-emerald-700">{pay.replace(/^₹/, "")}</span> : "Pay not disclosed"}</Fact>
              {job.experienceMin !== undefined && <Fact icon={Briefcase}>{job.experienceMin}{job.experienceMax ? `–${job.experienceMax}` : "+"} years</Fact>}
              {job.education && <Fact icon={GraduationCap}>{EDUCATION_LABELS[job.education]}</Fact>}
              <Fact icon={Clock}>Posted {timeAgo(job.postedAt || job.firstSeenAt)}</Fact>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {job.employmentType !== "unknown" && <Badge>{sentenceCase(job.employmentType)}</Badge>}
              {job.shift && <Badge tone={job.shift === "night" || job.shift === "rotational" ? "amber" : "slate"}>{job.shift === "flexible" ? "Flexible hours" : `${sentenceCase(job.shift)} shift`}</Badge>}
              {job.category && job.category !== "other" && <Badge>{CATEGORY_LABELS[job.category]}</Badge>}
              {job.freshersWelcome && <Badge tone="green">Freshers welcome</Badge>}
              {job.status === "stale" && <Badge tone="amber">May be closed</Badge>}
            </div>
          </div>
        </div>
        {job.quality.suspicious && (
          <div className="mt-5 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />This listing has warning signs ({job.quality.flags.map((f) => f.replace(/_/g, " ")).join(", ")}). Never pay to apply; check the employer independently before sharing personal information.</div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          {match && (
            <Card className="space-y-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Why this job fits you</h2>
                <Button variant="ghost" size="sm" loading={busy === "explain"} onClick={explain}><Sparkles className="h-4 w-4" />Explain in plain words</Button>
              </div>
              {match.aiSummary && <p className="rounded-xl bg-brand-50/70 p-4 text-sm leading-relaxed text-slate-800">{match.aiSummary}</p>}
              <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">{BREAKDOWN.map(([k, l]) => <Bar key={k} label={l} value={match.breakdown[k]} />)}</div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" />What matches</h3>
                  <ul className="space-y-1.5 text-sm text-slate-700">{match.reasons.map((r) => <li key={r} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-emerald-500" />{r}</li>)}{!match.reasons.length && <li className="text-slate-500">No strong signals found.</li>}</ul>
                </div>
                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-700"><AlertTriangle className="h-4 w-4" />Gaps & risks</h3>
                  <ul className="space-y-1.5 text-sm text-slate-700">{match.gaps.map((g) => <li key={g} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-amber-500" />{g}</li>)}{!match.gaps.length && <li className="text-slate-500">No gaps found.</li>}</ul>
                </div>
              </div>
              {(match.matchedSkills.length > 0 || match.missingSkills.length > 0) && (
                <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-4">
                  {match.matchedSkills.map((s) => <Badge key={s} tone="green">✓ {s}</Badge>)}
                  {match.missingSkills.map((s) => <Badge key={s} tone="amber">{s}</Badge>)}
                </div>
              )}
              {match.assumptions.length > 0 && <p className="text-xs text-slate-500">Not stated in the posting: {match.assumptions.map((a) => a.replace(/^The posting /i, "").replace(/ is not (disclosed|stated)$/i, "")).join(" · ")}</p>}
            </Card>
          )}

          {pkg && (
            <Card id="apply-panel" className="space-y-5 border-brand-200">
              <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Your application package</h2><Button variant="ghost" size="sm" onClick={() => prepare(true)}>Regenerate</Button></div>
              {resume?.content && <ResumeView version={resume} profile={me.profile} onApprove={approve} busy={busy === "approve"} error={resumeError} />}
              <div>
                <div className="mb-1.5 flex items-center justify-between"><h3 className="text-sm font-semibold">Cover letter</h3>
                  <Button variant="ghost" size="sm" onClick={() => { void navigator.clipboard.writeText(pkg.coverLetter); toast("success", "Cover letter copied"); }}><Copy className="h-4 w-4" />Copy</Button></div>
                <textarea readOnly value={pkg.coverLetter} rows={8} className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" />
              </div>
              <div className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div><p className="font-medium">Shared only when you apply</p><p className="text-slate-600">{pkg.willShare.join(" · ")}. I never submit anything — you apply on the employer's own page.</p></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button loading={busy === "open"} disabled={!resume?.approved} onClick={openEmployer}><ExternalLink className="h-4 w-4" />Open employer page</Button>
                <Button variant="secondary" loading={busy === "status"} disabled={!resume?.approved} onClick={() => setStatus("applied", "Applied via employer site")}>I've applied</Button>
              </div>
              {!resume?.approved && <p className="text-xs text-slate-500">Approve the resume above to continue.</p>}
            </Card>
          )}

          {pkg && <FormHelper jobId={job.id} />}

          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">About the role</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{shownDesc}</p>
            {desc.length > DESC_PREVIEW && <button onClick={() => setFullDesc(!fullDesc)} className="text-sm font-medium text-brand-600 hover:underline">{fullDesc ? "Show less" : "Read full description"}</button>}
          </Card>

          {related && related.similar.length > 0 && (
            <Section title="Similar jobs"><ul className="grid gap-3">{related.similar.map((h) => <li key={h.job.id}><JobCard compact job={h.job} score={h.matchScore} onOpen={nav.openJob} /></li>)}</ul></Section>
          )}
        </div>

        <aside className="order-first space-y-4 lg:order-none lg:sticky lg:top-24 lg:self-start">
          <Card className="space-y-4">
            {match ? (
              <div className="flex items-center gap-4">
                <ScoreRing score={match.score} size={72} />
                <div><BandPill score={match.score} /><p className="mt-1 text-xs text-slate-500">{bandOf(match.score) === "low" ? "Probably not the right fit" : BAND_LABEL[bandOf(match.score)] + " for your profile"}{match.confidence === "low" ? " · the posting has limited details" : ""}</p></div>
              </div>
            ) : <p className="text-sm text-slate-500">Finish your profile to see how well you match.</p>}

            {activeApp && activeApp.status !== "preparing" ? (
              <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
                <p className="font-semibold">Application: {sentenceCase(activeApp.status)}</p>
                {activeApp.appliedAt && <p className="text-emerald-800/80">Applied {timeAgo(activeApp.appliedAt)}</p>}
                <button onClick={() => nav.go("applications")} className="mt-1 font-medium underline">Manage in Applications</button>
              </div>
            ) : direct ? (
              <DirectApply job={job} disabled={me.profile.status !== "ready"} onApplied={() => { onChanged(); void load(); }} />
            ) : !pkg ? (
              <div className="space-y-2">
                <Button className="w-full" size="lg" loading={busy === "prepare"} onClick={() => prepare(false)} disabled={me.profile.status !== "ready"}><Sparkles className="h-4 w-4" />{activeApp ? "Continue application" : "Prepare my application"}</Button>
                <p className="text-center text-xs text-slate-500">A tailored resume using only your real experience + a cover letter. You review everything.</p>
                <Button variant="secondary" className="w-full" loading={busy === "open"} onClick={openEmployer}><ExternalLink className="h-4 w-4" />Apply directly on their site</Button>
              </div>
            ) : <Button variant="soft" className="w-full" onClick={() => document.getElementById("apply-panel")?.scrollIntoView({ behavior: "smooth" })}>Review your application ↓</Button>}

            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-4">
              <Button variant="secondary" size="sm" loading={busy === "save"} onClick={toggleSave} disabled={!match}><Bookmark className={cn("h-4 w-4", match?.saved && "fill-current text-brand-600")} />{match?.saved ? "Saved" : "Save"}</Button>
              <Button variant="secondary" size="sm" onClick={openChat}><MessageCircle className="h-4 w-4" />Ask assistant</Button>
            </div>
          </Card>

          <Card className="space-y-3">
            <div className="flex items-center gap-3"><CompanyMark name={job.company} size={40} /><div className="min-w-0"><p className="truncate font-semibold text-ink">{job.company}</p><p className="text-xs text-slate-500">{related ? `${related.sameCompany.length} other opening${related.sameCompany.length === 1 ? "" : "s"} here` : "Loading…"}</p></div></div>
            {related && related.sameCompany.length > 0 && (
              <ul className="-mx-2 space-y-0.5">
                {related.sameCompany.slice(0, 4).map((h) => (
                  <li key={h.job.id}><button onClick={() => nav.openJob(h.job.id)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"><span className="truncate">{h.job.title}</span>{h.matchScore !== undefined && <span className="shrink-0 text-xs font-medium text-slate-500">{h.matchScore}%</span>}</button></li>
                ))}
              </ul>
            )}
            <Button variant="ghost" size="sm" className="w-full" onClick={() => nav.go("search", { q: job.company })}><Building2 className="h-4 w-4" />All jobs at {job.company}</Button>
          </Card>

          <Card className="space-y-1.5 text-xs text-slate-500">
            {direct && <p><Badge tone="green">Posted directly by the employer</Badge></p>}
            <p><span className="font-medium text-slate-700">Source:</span> {sourceLabel(job)}{job.sources.length > 1 ? ` · listed on ${job.sources.length} sites` : ""}</p>
            <p><span className="font-medium text-slate-700">Last checked:</span> {timeAgo(job.lastVerifiedAt)}</p>
            <p><ReportJob jobId={job.id} /></p>
            {src && !direct && (src.sourceUrl || src.applyUrl) && <a className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline" href={src.sourceUrl || src.applyUrl} target="_blank" rel="noopener noreferrer">Original listing <ExternalLink className="h-3 w-3" /></a>}
          </Card>
        </aside>
      </div>
    </div>
  );
}
