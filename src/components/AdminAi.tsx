import { ExternalLink, KeyRound, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "../lib/api";
import { Badge, Button, Card, ErrorNote, Modal, Stat, timeAgo, useToast } from "../ui";

interface PoolKey { id: string; kind: "gemini" | "compat"; label: string; baseUrl?: string; models: string[]; last4: string; enabled: boolean; addedAt: string; lastOkAt?: string; lastError?: string; source: "admin" | "env" }
interface Preset { label: string; baseUrl: string; model: string; keyUrl: string }
interface AdminAiData {
  keys: PoolKey[]; presets: Record<string, Preset>; usersWithOwnKey: number; dailyCreditsPerUser: number;
  status: Array<{ id: string; configured: boolean; coolingDownMs: number }>;
  today: { activeUsers: number; poolCredits: number; poolRequests: number; ownKeyRequests: number };
}

/** Admin → AI setup: the shared free pool that serves users without their own key. */
export default function AdminAi() {
  const toast = useToast();
  const [data, setData] = useState<AdminAiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState("gemini");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => { try { setData(await api<AdminAiData>("/admin/ai")); } catch (e) { setError(errMsg(e)); } }, []);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    setBusy("add"); setError(null);
    try {
      const body = provider === "gemini" ? { kind: "gemini", key } : { kind: "compat", preset: provider, key, ...(model ? { model } : {}) };
      await api("/admin/ai/keys", { body });
      toast("success", "Key tested and added to the shared pool"); setAdding(false); setKey(""); setModel(""); await load();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  };
  const act = async (id: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(id);
    try { await fn(); toast("success", msg); await load(); } catch (e) { toast("error", errMsg(e)); } finally { setBusy(null); }
  };

  const keyUrl = provider === "gemini" ? "https://aistudio.google.com/app/apikey" : data?.presets[provider]?.keyUrl;
  const cooling = (id: string) => (data?.status.find((s) => s.id === id)?.coolingDownMs || 0) > 0;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="h-5 w-5 text-brand-600" />AI setup</h2>
        <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add key</Button>
      </div>
      <ErrorNote error={error && !adding ? error : null} />
      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Keys in shared pool" value={data.keys.filter((k) => k.enabled).length} hint={data.keys.length ? `${data.keys.length} total` : "none yet"} tone={data.keys.length ? "brand" : "amber"} />
          <Stat label="Users with own key" value={data.usersWithOwnKey} hint="don't use the pool" tone="green" />
          <Stat label="Pool requests today" value={data.today.poolRequests} hint={`${data.today.poolCredits} credits · ${data.today.activeUsers} users`} />
          <Stat label="Own-key requests today" value={data.today.ownKeyRequests} hint={`${data.dailyCreditsPerUser} free credits/user/day`} />
        </div>
      )}
      <Card className="divide-y divide-slate-100 p-0">
        {data?.keys.length === 0 && <p className="p-5 text-sm text-slate-600">No shared AI keys yet. Users can still add their own free key; add one here so everyone gets a small free daily allowance.</p>}
        {data?.keys.map((k) => (
          <div key={k.id} className="flex flex-wrap items-center gap-3 p-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><KeyRound className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-medium text-ink">{k.label} <span className="text-xs font-normal text-slate-500">…{k.last4}</span>
                {k.source === "env" ? <Badge>from .env</Badge> : k.lastError ? <Badge tone="red">Failing</Badge> : cooling(k.id) ? <Badge tone="amber">Cooling down</Badge> : k.enabled ? <Badge tone="green">Active</Badge> : <Badge>Off</Badge>}</p>
              <p className="truncate text-xs text-slate-500">{k.models.join(" → ")}{k.lastOkAt ? ` · last OK ${timeAgo(k.lastOkAt)}` : ""}</p>
              {k.lastError && <p className="text-xs text-red-600">{k.lastError}</p>}
            </div>
            {k.source === "admin" && (
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" loading={busy === `t${k.id}`} onClick={() => void act(`t${k.id}`, () => api(`/admin/ai/keys/${k.id}/test`, { body: {} }), "Tested")}><RefreshCw className="h-4 w-4" />Test</Button>
                <Button variant="ghost" size="sm" onClick={() => void act(`e${k.id}`, () => api(`/admin/ai/keys/${k.id}`, { method: "PATCH", body: { enabled: !k.enabled } }), k.enabled ? "Key turned off" : "Key turned on")}>{k.enabled ? "Turn off" : "Turn on"}</Button>
                <Button variant="ghost" size="sm" aria-label="Remove key" onClick={() => void act(`d${k.id}`, () => api(`/admin/ai/keys/${k.id}`, { method: "DELETE" }), "Key removed")}><Trash2 className="h-4 w-4 text-red-500" /></Button>
              </div>
            )}
          </div>
        ))}
      </Card>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a key to the shared pool"
        footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button loading={busy === "add"} disabled={key.trim().length < 10} onClick={add}>Test & add</Button></>}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Keys are tested with a real request, encrypted, and never shown again. Gemini is used first for chat and resumes; faster providers take small tasks and act as backup when Gemini hits its free limit.</p>
          <label className="block text-sm font-medium text-slate-700">Provider
            <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(""); }} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
              <option value="gemini">Google Gemini (AI Studio)</option>
              {data && Object.entries(data.presets).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
            </select>
          </label>
          {keyUrl && <a href={keyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">Get a free key <ExternalLink className="h-3.5 w-3.5" /></a>}
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste API key" autoComplete="off" spellCheck={false} className="h-11 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm" />
          {provider !== "gemini" && (
            <label className="block text-sm font-medium text-slate-700">Model <span className="font-normal text-slate-500">(optional)</span>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={data?.presets[provider]?.model} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
          )}
          {provider === "gemini" && <p className="text-xs text-slate-500">The newest stable Flash models this key can use are detected automatically.</p>}
          <ErrorNote error={error} />
        </div>
      </Modal>
    </section>
  );
}
