import { ExternalLink, Globe2, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { JobQuery, JobSearchHit, JobSearchResult } from "@shared/types";
import type { Me } from "../App";
import FilterBar, { toParams } from "../components/FilterBar";
import ImportJobModal from "../components/ImportJobModal";
import JobCard from "../components/JobCard";
import SyncBadge from "../components/SyncBadge";
import { api, errMsg } from "../lib/api";
import { track } from "../lib/analytics";
import { Button, Card, Empty, ErrorNote, JobCardSkeleton, PageHeader, Skeleton, useToast } from "../ui";

interface PortalLink { id: string; name: string; url: string; bestFor: string }

export default function JobSearch({ me, openJob, initialQuery = "" }: { me: Me; openJob: (id: string) => void; initialQuery?: string }) {
  const prefs = me.profile.preferences;
  const toast = useToast();
  const defaults = (): JobQuery => ({ q: initialQuery || undefined, cities: prefs.locations.filter((l) => !/anywhere/i.test(l)).slice(0, 3), sort: initialQuery ? "relevance" : "match" });
  const [query, setQuery] = useState<JobQuery>(defaults);
  const [result, setResult] = useState<JobSearchResult | null>(null);
  const [hits, setHits] = useState<JobSearchHit[] | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portals, setPortals] = useState<PortalLink[]>([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => { if (initialQuery) setQuery((q) => ({ ...q, q: initialQuery, sort: "relevance" })); }, [initialQuery]);

  const load = useCallback(async (p: number, append: boolean) => {
    setLoading(true); setError(null);
    try {
      const r = await api<JobSearchResult>(`/jobs/search?${toParams({ ...query, page: p, pageSize: 20 })}`);
      setResult(r); setHits((h) => (append && h ? [...h, ...r.hits] : r.hits)); setPage(p);
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  }, [query]);
  useEffect(() => { void load(1, false); }, [load]);
  useEffect(() => { if (query.q) track("search", { search_term: query.q }); }, [query.q]);

  // Portal links follow the current search, so "try Naukri" searches the same thing.
  useEffect(() => {
    const role = query.q || prefs.targetRoles[0] || me.profile.currentRole || "";
    void api<{ links: PortalLink[] }>(`/portal-links?${new URLSearchParams({ role, city: query.cities?.[0] || "" })}`).then((r) => setPortals(r.links)).catch(() => undefined);
  }, [query.q, query.cities, prefs.targetRoles, me.profile.currentRole]);

  const save = async (jobId: string, saved: boolean) => {
    try { await api(`/jobs/${jobId}/save`, { body: { saved } }); if (saved) track("job_save", { from: "search" }); setHits((h) => h && h.map((x) => (x.job.id === jobId ? { ...x, saved } : x))); toast("success", saved ? "Saved" : "Removed from saved"); } catch (e) { toast("error", errMsg(e)); }
  };

  const total = result?.total ?? 0;
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Every live job we can see" title="Search jobs"
        subtitle={result ? <>Searching <strong className="text-ink">{result.indexSize.toLocaleString("en-IN")}</strong> live jobs from company careers sites and job boards across India. <SyncBadge className="ml-1 align-middle" /></> : <Skeleton className="mt-2 h-4 w-80" />}
        actions={<Button variant="secondary" onClick={() => setImporting(true)}><Plus className="h-4 w-4" />Add a job I found</Button>} />

      <FilterBar query={query} set={(p) => { setQuery((q) => ({ ...q, ...p })); setHits(null); if (!("q" in p)) track("filter_used", { page: "search", filters: Object.keys(p).join(",") }); }} facets={result?.facets} reset={() => setQuery({ q: query.q, cities: query.cities, sort: query.sort })} />
      <ErrorNote error={error} />

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          {result && hits && (
            <p className="text-sm text-slate-500" role="status">
              {total >= 1000 ? "1,000+" : total.toLocaleString("en-IN")} job{total === 1 ? "" : "s"}
              {result.expandedTerms.length > 0 && <> · also searched <span className="text-slate-700">{result.expandedTerms.slice(0, 4).join(", ")}</span></>}
            </p>
          )}
          {hits === null ? <div className="space-y-3">{[0, 1, 2, 3].map((i) => <JobCardSkeleton key={i} />)}</div> : hits.length === 0 ? (
            <Empty icon={<Search className="h-6 w-6" />} title="No jobs match these filters" hint="Try fewer filters or another city — or search the job sites on the right and add the job here." />
          ) : (
            <>
              <ul className="grid gap-3">
                {hits.map((h) => <li key={h.job.id}><JobCard job={h.job} score={h.matchScore} confidence={h.matchConfidence} reason={h.reason} gap={h.gap} saved={h.saved} onOpen={openJob} onSave={(s) => void save(h.job.id, s)} /></li>)}
              </ul>
              {hits.length < Math.min(total, 1000) && <div className="flex justify-center pt-2"><Button variant="secondary" loading={loading} onClick={() => void load(page + 1, true)}>Show more</Button></div>}
            </>
          )}
        </div>

        <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          <Card className="space-y-3 p-4">
            <div className="flex items-center gap-2"><Globe2 className="h-5 w-5 text-brand-600" /><h2 className="font-semibold">Also search on</h2></div>
            <p className="text-xs text-slate-500">Opens the same search on each site. Found a job? Add it here and I'll score it, tailor your resume and track it.</p>
            <ul className="-mx-1 space-y-0.5">
              {portals.map((p) => (
                <li key={p.id}>
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 hover:bg-slate-50">
                    <span className="min-w-0"><span className="block text-sm font-medium text-ink">{p.name}</span><span className="block truncate text-xs text-slate-500">{p.bestFor}</span></span>
                    <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />
                  </a>
                </li>
              ))}
            </ul>
            <Button variant="soft" className="w-full" onClick={() => setImporting(true)}><Plus className="h-4 w-4" />Add a job I found</Button>
          </Card>
        </aside>
      </div>
      {importing && <ImportJobModal onClose={() => setImporting(false)} onDone={(id) => { setImporting(false); openJob(id); }} />}
    </div>
  );
}
