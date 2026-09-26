import { FileText, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ResumeRecord, ResumeVersion, TailoredResumeContent } from "@shared/types";
import type { Me } from "../App";
import { api, errMsg } from "../lib/api";
import { track } from "../lib/analytics";
import { useNav } from "../lib/nav";
import ResumeBuilder from "../components/ResumeBuilder";
import { Badge, Button, Card, Empty, ErrorNote, PageHeader, Skeleton, Tabs, timeAgo, useToast } from "../ui";
import ResumeView from "./ResumeView";

type OriginalRow = Omit<ResumeRecord, "text">;
type VersionRow = Omit<ResumeVersion, "text">;
type Tab = "resume" | "files" | "tailored";

export default function Resumes({ me, refresh }: { me: Me; refresh: () => Promise<void> }) {
  const nav = useNav();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("resume");
  const [data, setData] = useState<{ originals: OriginalRow[]; versions: VersionRow[] } | null>(null);
  const [open, setOpen] = useState<ResumeVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => { try { setData(await api("/resumes")); } catch (e) { setError(errMsg(e)); } }, []);
  useEffect(() => { void load(); }, [load]);

  async function replace(file: File) {
    setBusy(true); setError(null);
    try { const f = new FormData(); f.append("resume", file); await api("/resume", { form: f }); track("resume_uploaded", { method: "file", where: "resumes" }); toast("success", "Uploaded. I'm reading it now."); await refresh(); await load(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Resumes" subtitle="Build, check and download your resume, and see every version tailored to a job." />
      <Tabs value={tab} onChange={setTab} items={[
        { id: "resume", label: "My resume" },
        { id: "files", label: "Uploaded files", count: data?.originals.length },
        { id: "tailored", label: "Tailored", count: data?.versions.length },
      ]} />
      <ErrorNote error={error} />

      {tab === "resume" && <ResumeBuilder profile={me.profile} onChanged={refresh} />}

      {tab === "files" && (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-display text-base font-semibold text-ink">Your uploaded resume</h2><p className="text-sm text-slate-500">Kept as your source of truth. Tailored versions never add anything that isn't in it.</p></div>
            <input ref={fileRef} hidden type="file" accept=".pdf,.docx,.doc,.txt,.jpg,.jpeg,.png,.webp,image/*" onChange={(e) => e.target.files?.[0] && void replace(e.target.files[0])} />
            <Button variant="secondary" loading={busy} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />Upload a new version</Button>
          </div>
          {!data ? <Skeleton className="h-16 rounded-xl" /> : data.originals.length === 0 ? <p className="text-sm text-slate-500">No resume uploaded yet.</p> : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {data.originals.map((r) => (
                <li key={r.id} className="flex items-center gap-3 p-3 text-sm">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><FileText className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1"><p className="truncate font-medium text-ink">{r.fileName}</p><p className="text-xs text-slate-500">{(r.sizeBytes / 1024).toFixed(0)} KB · uploaded {timeAgo(r.createdAt)}</p></div>
                  {r.id === me.profile.resumeId && <Badge tone="green">In use</Badge>}
                  <button aria-label={`Delete ${r.fileName}`} onClick={async () => { if (!window.confirm("Delete this file? Your profile stays as it is.")) return; await api(`/resumes/${r.id}`, { method: "DELETE" }); await load(); }} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "tailored" && (
        <div className="space-y-4">
          {!data ? <Skeleton className="h-20 rounded-2xl" /> : data.versions.length === 0 ? (
            <Empty icon={<FileText className="h-6 w-6" />} title="No tailored resumes yet" hint="Open a job you like and choose Prepare my application. I'll write a version aimed at that job, using only your real experience." action={<Button onClick={() => nav.go("matches")}>See my matches</Button>} />
          ) : (
            <ul className="space-y-2">
              {data.versions.map((v) => (
                <li key={v.id}>
                  <Card className="flex items-center gap-3 p-4">
                    <button className="min-w-0 flex-1 text-left" onClick={async () => { const r = await api<{ version: ResumeVersion }>(`/resume-versions/${v.id}`); setOpen(r.version); setTimeout(() => document.getElementById("tailored-view")?.scrollIntoView({ behavior: "smooth" }), 60); }}>
                      <p className="truncate font-medium text-ink">{v.content?.headline || "Tailored resume"}</p>
                      <p className="text-xs text-slate-500">Created {timeAgo(v.createdAt)} · {v.generatedBy === "ai" ? "written with AI" : v.generatedBy === "user" ? "edited by you" : "prepared automatically"}</p>
                    </button>
                    {v.approved ? <Badge tone="green">Approved</Badge> : <Badge tone="amber">Needs review</Badge>}
                    <button aria-label="Delete this version" onClick={async () => { await api(`/resume-versions/${v.id}`, { method: "DELETE" }); if (open?.id === v.id) setOpen(null); await load(); }} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          {open?.content && (
            <div id="tailored-view" className="scroll-mt-24">
              <ResumeView key={open.id} version={open} profile={me.profile} error={error}
                onApprove={async (edited?: TailoredResumeContent) => {
                  try { const r = await api<{ version: ResumeVersion }>(`/resume-versions/${open.id}/approve`, { body: edited ? { content: edited } : {} }); setOpen(r.version); setError(null); await load(); } catch (e) { setError(errMsg(e)); }
                }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
