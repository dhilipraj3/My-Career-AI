import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ResumeRecord, ResumeVersion, TailoredResumeContent } from "@shared/types";
import type { Me } from "../App";
import { api, errMsg } from "../lib/api";
import { track } from "../lib/analytics";
import { Badge, Button, Card, Empty, ErrorNote, PageHeader, Spinner, timeAgo } from "../ui";
import ResumeBuilder from "../components/ResumeBuilder";
import ResumeView from "./ResumeView";

type OriginalRow = Omit<ResumeRecord, "text">;
type VersionRow = Omit<ResumeVersion, "text">;

export default function Resumes({ me, refresh }: { me: Me; refresh: () => Promise<void> }) {
  const [data, setData] = useState<{ originals: OriginalRow[]; versions: VersionRow[] } | null>(null);
  const [open, setOpen] = useState<ResumeVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => { try { setData(await api("/resumes")); } catch (e) { setError(errMsg(e)); } }, []);
  useEffect(() => { void load(); }, [load]);

  async function replace(file: File) {
    setBusy(true); setError(null);
    try { const f = new FormData(); f.append("resume", file); await api("/resume", { form: f }); track("resume_uploaded", { method: "file", where: "resumes" }); await refresh(); await load(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (!data) return <Spinner />;
  return (
    <div className="space-y-5">
      <PageHeader title="Resumes" subtitle="A clean resume built from your profile, your uploaded original, and every version tailored to a job." />
      <ErrorNote error={error} />

      <div className="space-y-2">
        <h2 className="font-display font-semibold">Your resume, ready to send</h2>
        <ResumeBuilder key={me.profile.updatedAt} />
      </div>

      <Card className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Your original resume</h2>
          <><input ref={fileRef} hidden type="file" accept=".pdf,.docx,.doc,.txt,.jpg,.jpeg,.png,.webp,image/*" onChange={(e) => e.target.files?.[0] && void replace(e.target.files[0])} /><Button variant="secondary" loading={busy} onClick={() => fileRef.current?.click()}>Replace resume</Button></></div>
        {data.originals.length === 0 ? <p className="text-sm text-slate-500">No resume uploaded.</p> : (
          <ul className="divide-y divide-slate-100">
            {data.originals.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                <span>{r.fileName} <span className="text-slate-400">· {(r.sizeBytes / 1024).toFixed(0)} KB · {timeAgo(r.createdAt)}</span> {r.id === me.profile.resumeId && <Badge tone="green">Active</Badge>}</span>
                <button aria-label="Delete resume" onClick={async () => { if (!window.confirm("Delete this resume file? Your profile stays.")) return; await api(`/resumes/${r.id}`, { method: "DELETE" }); await load(); }} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-500">The original is always kept as your source of truth. Tailored versions below are generated from it and never add anything that isn't in it.</p>
      </Card>

      <div className="space-y-2">
        <h2 className="font-semibold">Tailored resumes</h2>
        {data.versions.length === 0 ? <Empty title="No tailored resumes yet" hint="Open a job and choose “Prepare tailored application”." /> : (
          <ul className="space-y-2">
            {data.versions.map((v) => (
              <li key={v.id}>
                <Card className="flex items-center justify-between">
                  <button className="text-left" onClick={async () => { const r = await api<{ version: ResumeVersion }>(`/resume-versions/${v.id}`); setOpen(r.version); }}>
                    <p className="text-sm font-medium">{v.content?.headline || "Tailored resume"}</p>
                    <p className="text-xs text-slate-500">{timeAgo(v.createdAt)} · {v.generatedBy}</p>
                  </button>
                  <div className="flex items-center gap-2">{v.approved ? <Badge tone="green">Approved</Badge> : <Badge tone="amber">Pending</Badge>}
                    <button aria-label="Delete" onClick={async () => { await api(`/resume-versions/${v.id}`, { method: "DELETE" }); if (open?.id === v.id) setOpen(null); await load(); }} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
      {open?.content && (
        <ResumeView key={open.id} version={open} profile={me.profile} error={error}
          onApprove={async (edited?: TailoredResumeContent) => {
            try { const r = await api<{ version: ResumeVersion }>(`/resume-versions/${open.id}/approve`, { body: edited ? { content: edited } : {} }); setOpen(r.version); setError(null); await load(); } catch (e) { setError(errMsg(e)); }
          }} />
      )}
    </div>
  );
}
