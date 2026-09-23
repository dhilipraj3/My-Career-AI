import { Link2, TextCursorInput } from "lucide-react";
import { useState } from "react";
import type { Job } from "@shared/types";
import { api, errMsg } from "../lib/api";
import { Button, ErrorNote, Modal, Tabs } from "../ui";

const input = "h-11 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-brand-400 focus:outline-none";

/** Bring in a job found anywhere (Naukri, LinkedIn, a company site…) by link or by pasting its description. */
export default function ImportJobModal({ onClose, onDone }: { onClose: () => void; onDone: (jobId: string) => void }) {
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = mode === "url" ? /^https?:\/\//.test(url.trim()) : text.trim().length >= 80 && company.trim().length > 0;
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ job: Job }>("/jobs/import", { body: mode === "url" ? { url: url.trim() } : { description: text, title, company } });
      onDone(r.job.id);
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Add a job you found" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!ready} onClick={submit}>Analyse job</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Saw a job on Naukri, LinkedIn, a company site or WhatsApp? Add it here and I'll score it against your profile, tailor your resume and track it.</p>
        <Tabs value={mode} onChange={setMode} items={[{ id: "url", label: <span className="flex items-center gap-1.5"><Link2 className="h-4 w-4" />Job link</span> }, { id: "text", label: <span className="flex items-center gap-1.5"><TextCursorInput className="h-4 w-4" />Paste description</span> }]} />
        {mode === "url" ? (
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
