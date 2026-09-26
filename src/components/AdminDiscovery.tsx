import { ExternalLink, KeyRound, Pause, Play, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ConnectorHealth } from "@shared/types";
import { api, errMsg } from "../lib/api";
import { Badge, Button, Card, ErrorNote, Spinner, cn, timeAgo, useToast } from "../ui";

interface Settings { paused: boolean; intervalMinutes: number; boardsPerRun: number; maxConcurrent: number; timeoutSeconds: number; sources: Record<string, { intervalMinutes?: number }> }
interface RunConnector { id: string; fetched: number; inserted: number; merged: number; rejected: number; regionFiltered: number; error?: string; durationMs: number }
interface RunRecord { id: string; trigger: string; startedAt: string; finishedAt: string; connectors: RunConnector[]; skipped: string[]; newCompanies: number }
interface Overview {
  settings: Settings;
  state: { started: boolean; nextRunAt: string | null; paused: boolean; intervalMinutes: number; running: boolean };
  history: RunRecord[];
  connectors: ConnectorHealth[];
  registry: { total: number; byOrigin: Record<string, number>; autoAddedThisWeek: number; failing: number };
}

type Tone = "green" | "amber" | "red" | "slate" | "brand";
const STATUS: Record<ConnectorHealth["status"], { label: string; tone: Tone; hint: string }> = {
  healthy: { label: "Healthy", tone: "green", hint: "Fetched successfully on its last run." },
  degraded: { label: "Temporarily failing", tone: "amber", hint: "The last run failed but earlier ones worked; it retries automatically." },
  failing: { label: "Failing", tone: "red", hint: "Several runs in a row failed. Check the error below." },
  disabled: { label: "Switched off", tone: "slate", hint: "Turned off here in Admin." },
  needs_key: { label: "Needs a free key", tone: "brand", hint: "Paste a free key below to switch this source on." },
  not_set_up: { label: "Not set up", tone: "slate", hint: "Configured through .env on the server." },
  unknown: { label: "Waiting for first run", tone: "slate", hint: "Hasn't run yet." },
};

const INTERVALS = [15, 30, 60, 120, 180, 360, 720, 1440];
const SOURCE_INTERVALS = [...INTERVALS, 2880, 10080];
const every = (m: number) => (m < 60 ? `Every ${m} min` : m < 1440 ? `Every ${m / 60} hour${m === 60 ? "" : "s"}` : m === 1440 ? "Once a day" : m === 10080 ? "Once a week" : `Every ${m / 1440} days`);
const inTime = (iso: string | null) => {
  if (!iso) return "—";
  const min = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  return min <= 0 ? "any moment" : min < 60 ? `in ${min} min` : `in ${Math.round(min / 60)} h`;
};
const secs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`);
const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label className="block space-y-1 text-sm"><span className="font-medium">{label}</span>{children}{hint && <span className="block text-xs text-slate-500">{hint}</span>}</label>
);
const inputCls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm";

function KeyForm({ c, onSaved }: { c: ConnectorHealth; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const setup = c.setup!;
  return (
    <form className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError(null);
      try {
        const r = await api<{ sample: number }>(`/admin/sources/${c.id}/key`, { method: "PUT", body: values });
        toast("success", `Key works — a test search returned ${r.sample} jobs.`);
        setValues({}); onSaved();
      } catch (er) { setError(errMsg(er)); } finally { setBusy(false); }
    }}>
      <a href={setup.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">Get a free key <ExternalLink className="h-3.5 w-3.5" /></a>
      {setup.hint && <p className="text-xs text-slate-500">{setup.hint}</p>}
      {setup.fields.map((f) => (
        <Field key={f.id} label={f.label}>
          <input className={inputCls} type={f.secret ? "password" : "text"} autoComplete="off" placeholder={f.placeholder} value={values[f.id] || ""} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })} />
        </Field>
      ))}
      <ErrorNote error={error} />
      <Button type="submit" size="sm" loading={busy} disabled={setup.fields.some((f) => !values[f.id]?.trim())}><KeyRound className="h-4 w-4" />Test and save</Button>
      <p className="text-xs text-slate-500">I run one small search with it first; it's stored encrypted and never shown again.</p>
    </form>
  );
}

function SourceCard({ c, runs, settings, running, onChange, onError }: { c: ConnectorHealth; runs: RunConnector[]; settings: Settings; running: boolean; onChange: () => void; onError: (e: string) => void }) {
  const [open, setOpen] = useState(false);
  const s = STATUS[c.status] || STATUS.unknown;
  const override = settings.sources[c.id]?.intervalMinutes;
  const setInterval_ = async (v: string) => {
    const sources = { ...settings.sources };
    if (v) sources[c.id] = { intervalMinutes: Number(v) }; else delete sources[c.id];
    try { await api("/admin/discovery/settings", { method: "PUT", body: { sources } }); onChange(); } catch (e) { onError(errMsg(e)); }
  };
  return (
    <Card className="flex h-full flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{c.name}</p>
          <p className="text-xs text-slate-500">{c.access}</p>
        </div>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      <p className="text-xs text-slate-500" title={s.hint}>{s.hint}</p>
      {c.lastRun && (
        <p className="text-xs text-slate-600">
          Last run {timeAgo(c.lastRun.at)}: <b>{c.lastRun.fetched}</b> fetched · {c.lastRun.inserted} new · {c.lastRun.merged} merged · {c.lastRun.rejected} rejected · {secs(c.lastRun.durationMs)}
        </p>
      )}
      {c.lastError && c.status !== "healthy" && <p className="text-xs text-red-600" title={c.lastError}>Why: {c.lastError}</p>}
      {runs.length > 0 && (
        <div className="flex items-center gap-1" aria-label="Recent runs">
          <span className="mr-1 text-[11px] text-slate-400">Recent</span>
          {runs.slice(0, 10).reverse().map((r, i) => (
            <span key={i} title={r.error ? `Failed: ${r.error}` : `${r.fetched} fetched, ${r.inserted} new`} className={cn("h-3 w-3 rounded-sm", r.error ? "bg-red-400" : r.inserted ? "bg-emerald-500" : "bg-emerald-200")} />
          ))}
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {c.status !== "needs_key" && c.status !== "not_set_up" && (
          <Button size="sm" variant="secondary" disabled={running || !c.enabled} onClick={async () => {
            try { await api("/admin/discovery/run", { body: { connectorIds: [c.id] } }); onChange(); } catch (e) { onError(errMsg(e)); }
          }}><RefreshCw className="h-3.5 w-3.5" />Run now</Button>
        )}
        {c.status !== "needs_key" && c.status !== "not_set_up" && (
          <select aria-label={`How often to check ${c.name}`} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs" value={override || ""} onChange={(e) => void setInterval_(e.target.value)}>
            <option value="">Follow the schedule</option>
            {SOURCE_INTERVALS.map((m) => <option key={m} value={m}>{every(m)}</option>)}
          </select>
        )}
        {c.setup && (c.status === "needs_key" || c.setup.from === "admin") && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}><KeyRound className="h-3.5 w-3.5" />{c.setup.configured ? "Replace key" : "Add free key"}</Button>
        )}
        {c.setup?.from === "admin" && (
          <Button size="sm" variant="ghost" onClick={async () => {
            if (!confirm(`Remove the ${c.name} key? The source will stop until a new key is added.`)) return;
            try { await api(`/admin/sources/${c.id}/key`, { method: "DELETE" }); onChange(); } catch (e) { onError(errMsg(e)); }
          }}>Remove key</Button>
        )}
        {c.setup?.from === "env" && <span className="text-xs text-slate-500">Key set in .env</span>}
        <label className="ml-auto flex min-h-9 cursor-pointer items-center gap-2 text-xs text-slate-600">On
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={c.enabled} onChange={async (e) => {
            try { await api(`/admin/connectors/${c.id}/toggle`, { body: { enabled: e.target.checked } }); onChange(); } catch (er) { onError(errMsg(er)); }
          }} />
        </label>
      </div>
      {open && c.setup && <KeyForm c={c} onSaved={() => { setOpen(false); onChange(); }} />}
    </Card>
  );
}

/** Admin → Discovery: schedule and pace, live status, run history, per-source health, keys and registry growth. */
export default function AdminDiscovery({ onRunFinished }: { onRunFinished?: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const d = await api<Overview>("/admin/discovery");
      setData((prev) => {
        if (prev?.state.running && !d.state.running) onRunFinished?.();
        return d;
      });
      setDraft((cur) => cur ?? d.settings);
    } catch (e) { setError(errMsg(e)); }
  }, [onRunFinished]);

  useEffect(() => { void load(); }, [load]);
  // Poll quickly while a run is in progress, slowly otherwise.
  useEffect(() => {
    const t = setInterval(() => void load(), data?.state.running ? 4000 : 30000);
    return () => clearInterval(t);
  }, [load, data?.state.running]);

  if (!data || !draft) return error ? <ErrorNote error={error} /> : <Spinner label="Loading discovery…" />;
  const { state, history, connectors, registry } = data;
  const last = history[0];
  const dirty = (["paused", "intervalMinutes", "boardsPerRun", "maxConcurrent", "timeoutSeconds"] as const).some((k) => draft[k] !== data.settings[k]);
  const runsFor = (id: string) => history.flatMap((h) => h.connectors.filter((c) => c.id === id));
  const save = async (patch: Partial<Settings>) => {
    setSaving(true); setError(null);
    try {
      const r = await api<{ settings: Settings }>("/admin/discovery/settings", { method: "PUT", body: patch });
      setDraft(r.settings); toast("success", "Discovery settings saved."); await load();
    } catch (e) { setError(errMsg(e)); } finally { setSaving(false); }
  };
  const runAll = async () => {
    try {
      const r = await api<{ started: boolean; message?: string }>("/admin/discovery/run", { body: {} });
      toast("info", r.started ? "Discovery started — this page updates as it runs." : r.message || "Already running.");
      await load();
    } catch (e) { setError(errMsg(e)); }
  };
  const order = ["healthy", "degraded", "failing", "unknown", "needs_key", "disabled", "not_set_up"];
  const sorted = [...connectors].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.name.localeCompare(b.name));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Job discovery</h2>
        <Button size="sm" loading={state.running} onClick={runAll}>{state.running ? "Running…" : <><RefreshCw className="h-4 w-4" />Run all sources now</>}</Button>
      </div>
      <ErrorNote error={error} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <p className="text-xs text-slate-500">Status</p>
          <p className="mt-1 flex items-center gap-2 font-semibold">
            <span className={cn("h-2.5 w-2.5 rounded-full", state.running ? "animate-pulse bg-brand-500" : state.paused ? "bg-amber-400" : "bg-emerald-500")} />
            {state.running ? "Checking sources now" : state.paused ? "Paused" : "Scheduled"}
          </p>
        </Card>
        <Card><p className="text-xs text-slate-500">Last run</p><p className="mt-1 font-semibold">{last ? timeAgo(last.finishedAt) : "Not yet"}</p>{last && <p className="text-xs text-slate-500">{last.connectors.reduce((n, c) => n + c.inserted, 0)} new jobs · {last.trigger}</p>}</Card>
        <Card><p className="text-xs text-slate-500">Next run</p><p className="mt-1 font-semibold">{state.paused ? "Paused" : inTime(state.nextRunAt)}</p><p className="text-xs text-slate-500">{every(state.intervalMinutes)}</p></Card>
        <Card>
          <p className="text-xs text-slate-500">Company boards</p>
          <p className="mt-1 font-semibold tabular-nums">{registry.total.toLocaleString("en-IN")}</p>
          <p className="text-xs text-slate-500">{registry.byOrigin.auto || 0} found automatically{registry.autoAddedThisWeek ? ` (+${registry.autoAddedThisWeek} this week)` : ""}{registry.failing ? ` · ${registry.failing} with errors` : ""}</p>
        </Card>
      </div>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Schedule and pace</h3>
          <Button size="sm" variant={draft.paused ? "primary" : "secondary"} loading={saving} onClick={() => void save({ paused: !data.settings.paused })}>
            {data.settings.paused ? <><Play className="h-3.5 w-3.5" />Resume</> : <><Pause className="h-3.5 w-3.5" />Pause</>}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Check for new jobs" hint="How often the whole cycle runs.">
            <select className={inputCls} value={draft.intervalMinutes} onChange={(e) => setDraft({ ...draft, intervalMinutes: Number(e.target.value) })}>
              {INTERVALS.map((m) => <option key={m} value={m}>{every(m)}</option>)}
            </select>
          </Field>
          <Field label="Company boards per run" hint="Per careers system; Workday, Oracle and careers pages use a quarter.">
            <input className={inputCls} type="number" min={5} max={500} value={draft.boardsPerRun} onChange={(e) => setDraft({ ...draft, boardsPerRun: Number(e.target.value) })} />
          </Field>
          <Field label="Parallel requests" hint="Lower is gentler on sources.">
            <input className={inputCls} type="number" min={1} max={20} value={draft.maxConcurrent} onChange={(e) => setDraft({ ...draft, maxConcurrent: Number(e.target.value) })} />
          </Field>
          <Field label="Request timeout (seconds)">
            <input className={inputCls} type="number" min={5} max={120} value={draft.timeoutSeconds} onChange={(e) => setDraft({ ...draft, timeoutSeconds: Number(e.target.value) })} />
          </Field>
        </div>
        <p className="text-xs text-slate-500">
          Failed requests retry twice with a growing wait. If a source says "too many requests", it's left alone for the time it asks (5 minutes by default).
          {registry.total > 0 && ` At this pace a full pass over all ${registry.total} boards takes about ${Math.max(1, Math.ceil(registry.total / Math.max(1, draft.boardsPerRun * 6)))} run(s).`}
        </p>
        <div className="flex gap-2">
          <Button size="sm" disabled={!dirty} loading={saving} onClick={() => void save({ intervalMinutes: draft.intervalMinutes, boardsPerRun: draft.boardsPerRun, maxConcurrent: draft.maxConcurrent, timeoutSeconds: draft.timeoutSeconds })}><Save className="h-3.5 w-3.5" />Save</Button>
          {dirty && <Button size="sm" variant="ghost" onClick={() => setDraft(data.settings)}>Discard</Button>}
        </div>
      </Card>

      {history.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-2">Run</th><th className="px-3 py-2">Started by</th><th className="px-3 py-2">Sources</th><th className="px-3 py-2">Fetched</th><th className="px-3 py-2">New</th><th className="px-3 py-2">New boards</th><th className="px-3 py-2">Took</th></tr></thead>
            <tbody>
              {history.slice(0, 8).map((h) => {
                const failed = h.connectors.filter((c) => c.error).length;
                return (
                  <tr key={h.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-xs">{timeAgo(h.startedAt)}</td>
                    <td className="px-3 py-2 text-xs capitalize">{h.trigger}</td>
                    <td className="px-3 py-2 text-xs">{h.connectors.length - failed} ok{failed ? <span className="text-red-600"> · {failed} failed</span> : ""}{h.skipped.length ? <span className="text-slate-400"> · {h.skipped.length} not due</span> : ""}</td>
                    <td className="px-3 py-2 tabular-nums">{h.connectors.reduce((n, c) => n + c.fetched, 0)}</td>
                    <td className="px-3 py-2 tabular-nums">{h.connectors.reduce((n, c) => n + c.inserted, 0)}</td>
                    <td className="px-3 py-2 tabular-nums">{h.newCompanies}</td>
                    <td className="px-3 py-2 text-xs">{secs(new Date(h.finishedAt).getTime() - new Date(h.startedAt).getTime())}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <ul className="grid gap-2 md:grid-cols-2">
        {sorted.map((c) => (
          <li key={c.id}><SourceCard c={c} runs={runsFor(c.id)} settings={data.settings} running={state.running} onChange={load} onError={setError} /></li>
        ))}
      </ul>
    </section>
  );
}
