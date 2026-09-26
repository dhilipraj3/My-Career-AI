import { CheckCircle2, Copy, Link2, ListPlus, TextCursorInput, XCircle } from "lucide-react";
import { useState } from "react";
import type { Job } from "@shared/types";
import { api, errMsg } from "../lib/api";
import { Button, ErrorNote, Modal, Tabs } from "../ui";

const input = "h-11 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-brand-400 focus:outline-none";

const bookmarklet = () => `javascript:(()=>{location.href='${location.origin}/add-job?url='+encodeURIComponent(location.href)})()`;

/** Bring in a job found anywhere (Naukri, LinkedIn, a company site…) by link or by pasting its description. */
interface BulkRow { url: string; ok: boolean; jobId?: string; title?: string; company?: string; score?: number; error?: string }

export default function ImportJobModal({ onClose, onDone, initialUrl = "" }: { onClose: () => void; onDone: (jobId: string) => void; initialUrl?: string }) {
  const [mode, setMode] = useState<"url" | "text" | "bulk">("url");
  const [url, setUrl] = useState(initialUrl);
  const [bulk, setBulk] = useState("");
  const [results, setResults] = useState<BulkRow[] | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linkCount = (bulk.match(/https?:\/\/\S+/g) || []).length;
  const ready = mode === "bulk" ? linkCount > 0 : mode === "url" ? /^https?:\/\//.test(url.trim()) : text.trim().length >= 80 && company.trim().length > 0;
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (mode === "bulk") { setResults((await api<{ results: BulkRow[] }>("/jobs/import-bulk", { body: { text: bulk } })).results); return; }
      const r = await api<{ job: Job }>("/jobs/import", { body: mode === "url" ? { url: url.trim() } : { description: text, title, company } });
      onDone(r.job.id);
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Add a job you found" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>{results ? <Button onClick={onClose}>Done</Button> : <Button loading={busy} disabled={!ready} onClick={submit}>{mode === "bulk" ? `Add ${linkCount || ""} job${linkCount === 1 ? "" : "s"}` : "Analyse job"}</Button>}</>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Saw a job on Naukri, LinkedIn, a company site or WhatsApp? Add it here and I'll score it against your profile, tailor your resume and track it.</p>
        <Tabs value={mode} onChange={setMode} items={[{ id: "url", label: <span className="flex items-center gap-1.5"><Link2 className="h-4 w-4" />Job link</span> }, { id: "text", label: <span className="flex items-center gap-1.5"><TextCursorInput className="h-4 w-4" />Paste description</span> }, { id: "bulk", label: <span className="flex items-center gap-1.5"><ListPlus className="h-4 w-4" />Several links</span> }]} />
        {mode === "bulk" ? (
          results ? (
            <ul className="space-y-2">{results.map((r) => (
              <li key={r.url} className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 text-sm">
                {r.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                <span className="min-w-0 flex-1">{r.ok ? <><span className="font-medium text-ink">{r.title}</span> · {r.company}{r.score !== undefined && <span className="text-slate-500"> · {r.score}% match</span>}</> : <><span className="block truncate text-slate-500">{r.url}</span><span className="text-amber-700">{r.error}</span></>}</span>
                {r.ok && r.jobId && <button className="text-xs font-medium text-brand-700 hover:underline" onClick={() => onDone(r.jobId!)}>Open</button>}
              </li>))}</ul>
          ) : (
            <div className="space-y-2">
              <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={7} autoFocus placeholder={"Paste up to 8 job links, one per line, or a whole WhatsApp message with links in it"} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:border-brand-400 focus:outline-none" />
              <p className="text-xs text-slate-500">{linkCount ? `${linkCount} link${linkCount === 1 ? "" : "s"} found` : "I'll pick the links out for you."}</p>
              <details className="text-xs text-slate-500"><summary className="cursor-pointer">Add jobs from any site with one click</summary>
                <p className="mt-1">Create a browser bookmark with this as its address, then click it on any job page:</p>
                <div className="mt-1 flex items-start gap-2"><code className="block flex-1 break-all rounded-lg bg-slate-100 p-2 text-[11px]">{bookmarklet()}</code><button aria-label="Copy bookmark address" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" onClick={() => void navigator.clipboard.writeText(bookmarklet())}><Copy className="h-4 w-4" /></button></div>
              </details>
            </div>
          )
        ) : mode === "url" ? (
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={input} autoFocus />
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Job title" className={input} />
              <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company *" className={input} />
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder="Paste the full job description" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:border-brand-400 focus:outline-none" />
          </div>
        )}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
