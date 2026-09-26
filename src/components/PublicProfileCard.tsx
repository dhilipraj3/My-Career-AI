import { Copy, Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errMsg } from "../lib/api";
import { Button, ErrorNote, useToast } from "../ui";

interface State {
  settings: { enabled: boolean; indexable: boolean; show: Record<string, boolean> } | null;
  url: string | null;
}
const SECTIONS: Array<[string, string]> = [["summary", "About me"], ["skills", "Skills"], ["roles", "Roles I'm looking for"], ["city", "My city"], ["experience", "Years of experience"], ["education", "Education"]];

/** An optional page you can share with recruiters. Off by default; shows first name and last initial, never contact details. */
export default function PublicProfileCard() {
  const toast = useToast();
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<State>("/me/public-profile").then(setS).catch((e) => setError(errMsg(e))); }, []);

  async function save(body: object) {
    setBusy(true); setError(null);
    try { setS(await api<State>("/me/public-profile", { method: "PUT", body })); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  if (!s) return error ? <ErrorNote error={error} /> : null;
  const on = Boolean(s.settings?.enabled);
  const show = s.settings?.show || {};
  return (
    <div className="space-y-3 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><Globe className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1"><p className="font-semibold text-ink">Shareable profile page</p><p className="mt-0.5 text-sm text-slate-600">{on ? "On. Anyone with the link can see the sections you choose. Contact details are never shown." : "Off. Turn it on to get a link you can share with recruiters."}</p></div>
        <Button variant="secondary" loading={busy} onClick={() => void save({ enabled: !on })}>{on ? "Turn off" : "Turn on"}</Button>
      </div>
      {on && s.url && (
        <div className="space-y-3 rounded-xl bg-slate-50 p-3 text-sm">
          <div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all font-semibold text-ink">{s.url}</code><Button variant="ghost" size="sm" onClick={() => { void navigator.clipboard.writeText(s.url!); toast("success", "Link copied"); }}><Copy className="h-4 w-4" />Copy</Button></div>
          <div className="grid gap-1.5 sm:grid-cols-2">{SECTIONS.map(([k, label]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={Boolean(show[k])} disabled={busy} onChange={(e) => void save({ enabled: true, show: { [k]: e.target.checked } })} />{label}</label>)}</div>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={Boolean(s.settings?.indexable)} disabled={busy} onChange={(e) => void save({ enabled: true, indexable: e.target.checked })} /><span>Let Google and other search engines find this page<span className="block text-xs text-slate-500">Off by default. Turn it on only if you want strangers to find you by name.</span></span></label>
        </div>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
