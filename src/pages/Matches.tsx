import { EyeOff, Plus, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedSummary, JobQuery, JobSearchHit, JobSearchResult, MatchFeedbackReason } from "@shared/types";
import type { Me } from "../App";
import Diagnosis from "../components/Diagnosis";
import FilterBar, { toParams } from "../components/FilterBar";
import JobCard from "../components/JobCard";
import { useJobListKeys } from "../lib/keys";
import { listPageSize } from "../lib/lowdata";
import { api, errMsg } from "../lib/api";
import { track } from "../lib/analytics";
import { useNav } from "../lib/nav";
import { Button, Empty, ErrorNote, JobCardSkeleton, PageHeader, Skeleton, Tabs, useToast } from "../ui";
import ImportJobModal from "../components/ImportJobModal";

type Tier = "all" | "excellent" | "good" | "fair" | "saved";
const TIER_RANGE: Record<Tier, Partial<JobQuery>> = {
  all: { minScore: 50 }, excellent: { minScore: 80 }, good: { minScore: 65, maxScore: 79 }, fair: { minScore: 50, maxScore: 64 }, saved: { savedOnly: true, minScore: 0 },
};
const REASONS: Array<[MatchFeedbackReason, string]> = [
  ["not_relevant", "Not relevant"], ["wrong_role", "Wrong role"], ["wrong_location", "Wrong location"], ["salary_too_low", "Salary too low"],
  ["skill_mismatch", "Skill mismatch"], ["company_not_preferred", "Company not preferred"], ["already_applied", "Already applied"], ["not_interested", "Not interested"],
];

export default function Matches({ me }: { me: Me }) {
  const nav = useNav();
  const toast = useToast();
  const [summary, setSummary] = useState<FeedSummary | null>(null);
  const [tier, setTier] = useState<Tier>("all");
  const [query, setQuery] = useState<JobQuery>({ sort: "match" });
  const [hits, setHits] = useState<JobSearchHit[] | null>(null);
  const [result, setResult] = useState<JobSearchResult | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [searching, setSearching] = useState(false);
  const lastSeen = useRef<string | undefined>(undefined);

  const loadSummary = useCallback(async () => {
    try {
      const s = await api<FeedSummary>("/feed/summary");
      if (lastSeen.current === undefined) lastSeen.current = s.lastSeenAt || "";
      setSummary(s);
    } catch (e) { setError(errMsg(e)); }
  }, []);
  // Mark the feed seen after the first summary, so "New" badges compare against the previous visit.
  useEffect(() => { void loadSummary().then(() => api("/feed/seen", { body: {} }).catch(() => undefined)); }, [loadSummary]);

  const load = useCallback(async (p: number, append: boolean) => {
    setLoading(true); setError(null);
    try {
      const r = await api<JobSearchResult>(`/jobs/search?${toParams({ ...query, ...TIER_RANGE[tier], matchedOnly: true, page: p, pageSize: listPageSize(20) })}`);
      setResult(r); setHits((h) => (append && h ? [...h, ...r.hits] : r.hits)); setPage(p);
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  }, [query, tier]);
  useEffect(() => { void load(1, false); }, [load]);

  useJobListKeys(nav.openJob, (t) => toast("info", t));
  const refreshAll = () => { void loadSummary(); void load(1, false); };
  const save = async (id: string, saved: boolean) => {
    try { await api(`/jobs/${id}/save`, { body: { saved } }); if (saved) track("job_save", { from: "matches" }); setHits((h) => h && h.map((x) => (x.job.id === id ? { ...x, saved } : x))); toast("success", saved ? "Saved" : "Removed from saved"); void loadSummary(); } catch (e) { toast("error", errMsg(e)); }
  };
  const hide = async (id: string, reason: MatchFeedbackReason) => {
    setMenuFor(null);
    try { await api(`/jobs/${id}/hide`, { body: { reason } }); setHits((h) => h && h.filter((x) => x.job.id !== id)); toast("info", "Hidden. I'll show fewer jobs like this."); void loadSummary(); } catch (e) { toast("error", errMsg(e)); }
  };
  const searchNow = async () => {
    setSearching(true);
    try {
      const r = await api<{ started: boolean; retryInSeconds?: number }>("/search", { body: {} });
      if (!r.started) toast("info", `A search ran recently. Try again in ${Math.ceil((r.retryInSeconds || 60) / 60)} min.`);
      else { toast("info", "Searching every source. New matches will appear in a minute or two."); setTimeout(refreshAll, 60_000); }
    } catch (e) { toast("error", errMsg(e)); } finally { setSearching(false); }
  };

  const b = summary?.bands;
  const subtitle = !summary ? <Skeleton className="mt-2 h-4 w-72" /> : summary.total === 0 ? "No matches yet — I'm still looking." : (
    <><strong className="text-ink">{summary.total.toLocaleString("en-IN")}</strong> jobs match you: <span className="text-emerald-700">{b!.excellent} excellent</span> · <span className="text-brand-700">{b!.good} good</span> · <span className="text-amber-700">{b!.fair} fair</span>{summary.newSinceLastVisit > 0 && <> · <strong className="text-brand-700">{summary.newSinceLastVisit} new</strong> since your last visit</>}</>
  );
  const total = result?.total ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Matched to your profile" title="For you" subtitle={subtitle}
        actions={<>
          <Button variant="secondary" onClick={() => setImporting(true)}><Plus className="h-4 w-4" />Add a job</Button>
          <Button loading={searching} onClick={searchNow}><RefreshCw className="h-4 w-4" />Find new jobs</Button>
        </>} />

      {summary && <Diagnosis summary={summary} profile={me.profile} onChanged={() => { void nav.refresh(); refreshAll(); }} />}

      <Tabs value={tier} onChange={(t) => { setTier(t); setHits(null); }} items={[
        { id: "all", label: "All matches", count: summary?.total },
        { id: "excellent", label: "Excellent", count: b?.excellent },
        { id: "good", label: "Good", count: b?.good },
        { id: "fair", label: "Fair", count: b?.fair },
        { id: "saved", label: "Saved", count: summary?.saved },
      ]} />

      <FilterBar query={query} set={(p) => { setQuery((q) => ({ ...q, ...p })); setHits(null); if (!("q" in p)) track("filter_used", { page: "matches", filters: Object.keys(p).join(",") }); }} facets={result?.facets} reset={() => setQuery({ sort: query.sort, q: query.q, cities: query.cities })} />
      <ErrorNote error={error} />

      {hits === null ? <div className="space-y-3">{[0, 1, 2].map((i) => <JobCardSkeleton key={i} />)}</div> : hits.length === 0 ? (
        tier === "saved" ? <Empty icon={<Sparkles className="h-6 w-6" />} title="No saved jobs yet" hint="Tap the bookmark on any job to keep it here." />
          : tier === "excellent" ? <Empty icon={<Sparkles className="h-6 w-6" />} title={query.q || query.cities?.length ? "No excellent matches for this search" : "No excellent matches yet"} hint={query.q || query.cities?.length ? "Try clearing the search or filters." : "Ask the assistant what would turn your good matches into excellent ones."} action={<div className="flex flex-wrap justify-center gap-2"><Button variant="secondary" onClick={() => setTier("all")}>See all matches</Button><Button onClick={() => nav.openChat("How can I get more excellent matches?")}>Ask the assistant</Button></div>} />
          : <Empty icon={<Sparkles className="h-6 w-6" />} title="Nothing matches these filters" hint="Try removing a filter, or search all jobs." action={<Button variant="secondary" onClick={() => nav.go("search")}>Search all jobs</Button>} />
      ) : (
        <>
          <p className="text-sm text-slate-500">Showing {hits.length.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}</p>
          <ul className="grid gap-3">
            {hits.map((h) => (
              <li key={h.job.id}>
                <JobCard job={h.job} score={h.matchScore} confidence={h.matchConfidence} reason={h.reason} gap={h.gap} saved={h.saved}
                  isNew={Boolean(lastSeen.current && h.matchedAt && h.matchedAt > lastSeen.current)} onOpen={nav.openJob} onSave={(s) => void save(h.job.id, s)}
                  actions={<div className="relative">
                    <button data-action="hide" aria-label="Not interested" title="Not interested" onClick={() => setMenuFor(menuFor === h.job.id ? null : h.job.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><EyeOff className="h-[18px] w-[18px]" /></button>
                    {menuFor === h.job.id && (
                      <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-[var(--shadow-pop)] animate-fade-in">
                        <p className="px-2 py-1 text-xs font-medium text-slate-500">Why hide this?</p>
                        {REASONS.map(([r, l]) => <button key={r} onClick={() => void hide(h.job.id, r)} className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100">{l}</button>)}
                      </div>
                    )}
                  </div>} />
              </li>
            ))}
          </ul>
          {hits.length < total && <div className="flex justify-center pt-2"><Button variant="secondary" loading={loading} onClick={() => void load(page + 1, true)}>Show more</Button></div>}
        </>
      )}
      {importing && <ImportJobModal onClose={() => setImporting(false)} onDone={(id) => { setImporting(false); nav.openJob(id); }} />}
    </div>
  );
}
