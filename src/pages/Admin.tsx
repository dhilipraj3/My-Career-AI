import { Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CompanyAts, CompanyRecord } from "@shared/types";
import { api, errMsg } from "../lib/api";
import { CATEGORY_LABELS } from "../lib/labels";
import AdminAi from "../components/AdminAi";
import AdminDiscovery from "../components/AdminDiscovery";
import AdminModeration from "../components/AdminModeration";
import { Badge, Button, Card, ErrorNote, PageHeader, Spinner, cn, timeAgo } from "../ui";

const companyTone = (s: CompanyRecord["status"]) => (s === "active" ? "green" : s === "dead" ? "red" : s === "empty" ? "amber" : "slate") as "green" | "amber" | "red" | "slate";

interface Detection { ats: CompanyAts | null; board: string; unsupported?: string; evidence: string }
interface Preview { total: number; india: number; sample: Array<{ title: string; location?: string }>; error?: string }

function Breakdown({ title, data, label = (k: string) => k }: { title: string; data: Record<string, number>; label?: (k: string) => string }) {
  const max = Math.max(1, ...Object.values(data));
  return (
    <Card className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {Object.keys(data).length === 0 ? <p className="text-xs text-slate-500">No jobs yet.</p> : (
        <ul className="space-y-1">
          {Object.entries(data).map(([k, v]) => (
            <li key={k} className="grid grid-cols-[1fr_auto] items-center gap-x-2 text-xs">
              <span className="truncate">{label(k)}</span><span className="tabular-nums text-slate-500">{v}</span>
              <div className="col-span-2 h-1 rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(v / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AddCompany({ onAdded }: { onAdded: () => void }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"detect" | "add" | null>(null);
  const [det, setDet] = useState<{ detection: Detection; preview: Preview | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="space-y-3">
      <h3 className="font-semibold">Add a company by its careers page</h3>
      <p className="text-xs text-slate-500">Paste the careers URL. I'll work out which careers system it uses and preview its India jobs before you add it.</p>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={async (e) => {
        e.preventDefault(); setBusy("detect"); setError(null); setDet(null);
        try { setDet(await api("/admin/companies/detect", { body: { url: url.trim() } })); } catch (er) { setError(errMsg(er)); } finally { setBusy(null); }
      }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://company.com/careers" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <Button type="submit" variant="secondary" loading={busy === "detect"} disabled={!url.trim()}><Search className="h-4 w-4" />Detect</Button>
      </form>
      <ErrorNote error={error} />
      {det && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
          {det.detection.ats ? (
            <>
              <p><Badge tone="brand">{det.detection.ats}</Badge> board <code className="text-xs">{det.detection.board}</code> <span className="text-xs text-slate-500">({det.detection.evidence})</span></p>
              {det.preview?.error ? <p className="text-red-600">Preview failed: {det.preview.error}</p> : det.preview && (
                <>
                  <p>{det.preview.india} India-relevant of {det.preview.total} jobs.</p>
                  <ul className="list-inside list-disc text-xs text-slate-600">{det.preview.sample.map((s, i) => <li key={i}>{s.title}{s.location ? ` — ${s.location}` : ""}</li>)}</ul>
                </>
              )}
              <div className="flex gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
                <Button loading={busy === "add"} disabled={!name.trim()} onClick={async () => {
                  setBusy("add"); setError(null);
                  try {
                    await api("/admin/companies", { body: { name: name.trim(), ats: det.detection.ats, board: det.detection.board, careersUrl: url.trim() } });
                    setUrl(""); setName(""); setDet(null); onAdded();
                  } catch (er) { setError(errMsg(er)); } finally { setBusy(null); }
                }}><Plus className="h-4 w-4" />Add</Button>
              </div>
            </>
          ) : <p className="text-amber-700">{det.detection.unsupported || `Not detected: ${det.detection.evidence}`}</p>}
        </div>
      )}
    </Card>
  );
}

export default function Admin() {
  const [loaded, setLoaded] = useState(false);
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [atsFilter, setAtsFilter] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const [s, co] = await Promise.all([api("/admin/stats"), api<{ companies: CompanyRecord[] }>("/admin/companies")]);
      setStats(s); setCompanies(co.companies); setLoaded(true);
    } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => companies.filter((c) => (!atsFilter || c.ats === atsFilter) && (!filter || c.name.toLowerCase().includes(filter.toLowerCase()))), [companies, filter, atsFilter]);
  const byAts = useMemo(() => companies.reduce<Record<string, number>>((m, c) => ({ ...m, [c.ats]: (m[c.ats] || 0) + 1 }), {}), [companies]);

  if (!loaded) return error ? <ErrorNote error={error} /> : <Spinner />;
  return (
    <div className="space-y-5">
      <PageHeader title="Admin" subtitle="AI, job discovery and the company registry." />
      <AdminAi />
      <AdminModeration />
      <ErrorNote error={error} />
      {stats && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[["Live jobs", stats.liveJobs], ["Searchable", stats.searchIndex], ["Companies", stats.companies], ["Users", stats.users], ["Suspicious", stats.suspicious]].map(([k, v]) => (
              <Card key={k as string}><p className="text-xs text-slate-500">{k}</p><p className="text-2xl font-bold tabular-nums">{Number(v).toLocaleString("en-IN")}</p></Card>
            ))}
          </div>
          <p className="text-xs text-slate-500">Store: {stats.store} · AI providers: {stats.ai.map((a: any) => `${a.id}${a.configured ? " ✓" : " (no key)"}`).join(", ")}</p>
          <div className="grid gap-3 md:grid-cols-3">
            <Breakdown title="Live jobs by source" data={stats.jobsBySource} />
            <Breakdown title="Live jobs by city" data={stats.jobsByCity} />
            <Breakdown title="Live jobs by category" data={stats.jobsByCategory} label={(k) => CATEGORY_LABELS[k as keyof typeof CATEGORY_LABELS] || k} />
          </div>
        </>
      )}

      <AdminDiscovery onRunFinished={load} />

      <section className="space-y-2">
        <h2 className="font-semibold">Company registry <span className="font-normal text-slate-500">({companies.length})</span></h2>
        <AddCompany onAdded={load} />
        <div className="flex flex-wrap gap-2">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          {["", ...Object.keys(byAts)].map((a) => (
            <button key={a || "all"} onClick={() => setAtsFilter(a)} className={cn("rounded-full px-3 py-1 text-sm", atsFilter === a ? "bg-slate-900 text-white" : "bg-slate-100")}>{a ? `${a} (${byAts[a]})` : "All"}</button>
          ))}
        </div>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-2">Company</th><th className="px-3 py-2">System</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Jobs</th><th className="px-3 py-2">Last fetch</th><th className="px-3 py-2">On</th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-3 py-2"><span className="font-medium">{c.name}</span>{c.lastError && <span className="block max-w-xs truncate text-xs text-red-600" title={c.lastError}>{c.lastError}</span>}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{c.ats}</td>
                  <td className="px-3 py-2"><Badge tone={companyTone(c.status)}>{c.status}</Badge></td>
                  <td className="px-3 py-2 tabular-nums">{c.lastJobCount}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{c.lastFetchedAt ? timeAgo(c.lastFetchedAt) : "never"}</td>
                  <td className="px-3 py-2"><input type="checkbox" aria-label={`Enable ${c.name}`} checked={c.enabled} onChange={async (e) => {
                    try { await api(`/admin/companies/${c.id}`, { method: "PATCH", body: { enabled: e.target.checked } }); await load(); } catch (er) { setError(errMsg(er)); }
                  }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}
