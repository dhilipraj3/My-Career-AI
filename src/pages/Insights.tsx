import { ExternalLink, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import type { FunnelStats, LearningRoi, MarketPulse } from "@shared/insights";
import { api, errMsg } from "../lib/api";
import { Badge, Card, Empty, ErrorNote, PageHeader, Section, Skeleton, cn } from "../ui";

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<T>(path).then(setData).catch((e) => setError(errMsg(e))); }, [path]);
  return { data, error };
}

function Bar({ value, max, tone = "bg-brand-500" }: { value: number; max: number; tone?: string }) {
  return <div className="h-1.5 rounded-full bg-slate-100"><div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%` }} /></div>;
}

function Learning() {
  const { data, error } = useLoad<LearningRoi>("/insights/learning");
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Skeleton className="h-40 rounded-2xl" />;
  return (
    <div className="space-y-3">
      {data.skills.length === 0 ? <Card className="text-sm text-slate-600">{data.note}</Card> : data.skills.map((s) => (
        <Card key={s.key} className="space-y-2 p-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="font-display text-lg font-bold text-ink">Learn {s.skill}</p>
            <Badge tone="green">+{s.newStrong} strong match{s.newStrong === 1 ? "" : "es"}</Badge>
            {s.newExcellent > 0 && <Badge tone="brand">{s.newExcellent} would be excellent</Badge>}
            <span className="text-xs text-slate-500">{s.jobsAsking} of your jobs ask for it</span>
          </div>
          <ul className="flex flex-wrap gap-2">{s.links.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">{l.label}<ExternalLink className="h-3 w-3" /></a></li>)}</ul>
        </Card>
      ))}
      <p className="text-xs text-slate-400">Worked out by re-scoring {data.jobsChecked.toLocaleString("en-IN")} jobs as if you had each skill. Only add a skill to your profile once you really have it.</p>
    </div>
  );
}

function Funnel() {
  const { data, error } = useLoad<{ funnel: FunnelStats }>("/insights/funnel");
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Skeleton className="h-40 rounded-2xl" />;
  const f = data.funnel;
  const stat = (label: string, n: number, rate: number | null) => <div><p className="font-display text-2xl font-bold text-ink">{n}</p><p className="text-xs text-slate-500">{label}{rate !== null ? ` · ${rate}%` : ""}</p></div>;
  const maxWeek = Math.max(1, ...f.weekly.map((w) => w.applied));
  return (
    <Card className="space-y-4 p-5">
      <p className="text-sm font-medium text-ink">{f.insight}</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{stat("Applied", f.applied, null)}{stat("Replies", f.responses, f.responseRate)}{stat("Interviews", f.interviews, f.interviewRate)}{stat("Offers", f.offers, f.offerRate)}</div>
      {f.medianDaysToResponse !== null && <p className="text-sm text-slate-600">Employers typically reply in about <strong>{f.medianDaysToResponse} days</strong>.</p>}
      <div>
        <p className="mb-1.5 text-xs font-semibold text-slate-500">Applications per week</p>
        <div className="flex h-20 items-end gap-1.5">{f.weekly.map((w) => <div key={w.weekStart} title={`${w.weekStart}: ${w.applied}`} className="flex flex-1 flex-col items-center justify-end gap-1"><div className="w-full rounded-t bg-brand-500/80" style={{ height: `${Math.max(3, (w.applied / maxWeek) * 100)}%` }} /><span className="text-[10px] tabular-nums text-slate-400">{w.applied}</span></div>)}</div>
      </div>
      {f.bySource.length > 1 && (
        <div><p className="mb-1.5 text-xs font-semibold text-slate-500">Where replies come from</p>
          <ul className="space-y-1.5 text-sm">{f.bySource.map((s) => <li key={s.source} className="flex items-center gap-2"><span className="w-40 truncate text-slate-700">{s.source}</span><div className="flex-1"><Bar value={s.responses} max={s.applied} tone="bg-emerald-500" /></div><span className="w-16 text-right text-xs tabular-nums text-slate-500">{s.responses}/{s.applied}</span></li>)}</ul></div>
      )}
    </Card>
  );
}

function Market() {
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");
  const { data, error } = useLoad<{ market: MarketPulse | null }>(`/insights/market${q ? `?role=${encodeURIComponent(q)}` : ""}`);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Skeleton className="h-40 rounded-2xl" />;
  const m = data.market;
  const change = m ? m.newThisWeek - m.previousWeek : 0;
  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setQ(role.trim()); }}>
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder={m ? `Showing: ${m.role}. Try another role` : "Try a role, e.g. Data Analyst"} className="h-10 flex-1 rounded-xl border border-slate-200 px-3 text-sm" aria-label="Role" />
        <button className="rounded-xl bg-brand-600 px-4 text-sm font-medium text-white">Look up</button>
      </form>
      {!m ? <Empty title="Add a target role" hint="Tell me the role you want and I'll show you its market." /> : (
        <Card className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div><p className="font-display text-2xl font-bold">{m.openings.toLocaleString("en-IN")}</p><p className="text-xs text-slate-500">openings{m.city ? ` in ${m.city}` : ""}</p></div>
            <div><p className="font-display text-2xl font-bold">{m.openingsInIndia.toLocaleString("en-IN")}</p><p className="text-xs text-slate-500">across India</p></div>
            <div><p className="flex items-center gap-1 font-display text-2xl font-bold">{m.newThisWeek}{change !== 0 && (change > 0 ? <TrendingUp className="h-5 w-5 text-emerald-600" /> : <TrendingDown className="h-5 w-5 text-amber-600" />)}</p><p className="text-xs text-slate-500">new this week (last week {m.previousWeek})</p></div>
            <div><p className="font-display text-2xl font-bold">{m.workMode.remote + m.workMode.hybrid}</p><p className="text-xs text-slate-500">remote or hybrid</p></div>
          </div>
          {m.salary && <p className="rounded-xl bg-slate-50 p-3 text-sm">Typical pay: <strong>₹{m.salary.lowLPA}–{m.salary.highLPA} LPA</strong> (median ₹{m.salary.medianLPA} LPA), from {m.salary.samples} postings that state a salary{m.salary.scope === "city" ? ` in ${m.city}` : " across India"}.</p>}
          <div className="grid gap-5 sm:grid-cols-2">
            <div><p className="mb-1.5 text-xs font-semibold text-slate-500">Skills employers ask for</p><ul className="space-y-1.5">{m.topSkills.map((s) => <li key={s.skill} className="flex items-center gap-2 text-sm"><span className="w-32 truncate">{s.skill}</span><div className="flex-1"><Bar value={s.jobs} max={m.topSkills[0]?.jobs || 1} /></div><span className="w-6 text-right text-xs tabular-nums text-slate-500">{s.jobs}</span></li>)}</ul></div>
            <div><p className="mb-1.5 text-xs font-semibold text-slate-500">Hiring the most</p><ul className="space-y-1.5">{m.topCompanies.map((c) => <li key={c.company} className="flex items-center gap-2 text-sm"><span className="flex-1 truncate">{c.company}</span><span className="text-xs tabular-nums text-slate-500">{c.jobs} open</span></li>)}</ul></div>
          </div>
          <p className="text-xs text-slate-400">From live postings in the top 50 results for this role.</p>
        </Card>
      )}
    </div>
  );
}

export default function Insights() {
  return (
    <div className="space-y-6">
      <PageHeader title="Career insights" subtitle="What to learn next, how your search is going, and what the market looks like." />
      <Section title="What to learn next"><Learning /></Section>
      <Section title="How your search is going"><Funnel /></Section>
      <Section title="Market pulse"><Market /></Section>
    </div>
  );
}
