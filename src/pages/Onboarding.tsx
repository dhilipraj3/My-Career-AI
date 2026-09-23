import { CheckCircle2, FileText, Loader2, MessageSquareText, ShieldCheck, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo, Wordmark, type Me } from "../App";
import { api, errMsg } from "../lib/api";
import { track } from "../lib/analytics";
import { firstName } from "../lib/labels";
import { Button, Card, ErrorNote, Progress, cn } from "../ui";

const QUICK: Record<string, string[]> = {
  workModes: ["Remote", "Hybrid", "In-office", "Any"],
  minSalaryLPA: ["Flexible", "₹20k/month", "10 LPA", "15 LPA", "25 LPA"],
  noticePeriodDays: ["Immediate", "30 days", "60 days", "90 days"],
  locations: ["Bengaluru", "Chennai", "Hyderabad", "Mumbai", "Pune", "Delhi NCR", "Anywhere in India"],
};

const STEPS = ["Your resume", "A few questions", "Your matches"];

export default function Onboarding({ me, refresh }: { me: Me; refresh: () => Promise<void> }) {
  const p = me.profile;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // While the server parses in the background, poll until it's done.
  useEffect(() => {
    if (p.status !== "parsing") return;
    const t = setInterval(() => void refresh(), 1500);
    return () => clearInterval(t);
  }, [p.status, refresh]);

  async function upload(file: File) {
    setError(null); setBusy(true);
    try { const form = new FormData(); form.append("resume", file); await api("/resume", { form }); track("resume_uploaded", { method: "file", where: "onboarding" }); await refresh(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  async function submitAnswer(text: string) {
    if (!text.trim()) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const r = await api<{ understoodAnything: boolean }>("/profile/answer", { body: { text } });
      setAnswer("");
      if (!r.understoodAnything) setNote("I didn't catch that — try something like \"Chennai, hybrid, 15 LPA, 30 days notice\".");
      await refresh();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  const essential = p.completeness.missing.filter((m) => m.essential && m.field !== "resume");
  const next = essential[0];
  const step = p.status === "empty" || p.status === "parsing" ? 0 : 1;

  return (
    <div className="min-h-full hero-gradient">
      <div className="mx-auto flex min-h-full max-w-2xl flex-col gap-8 px-5 py-10">
        <div className="flex items-center gap-2.5"><Logo className="h-8 w-8" /><Wordmark /></div>

        <div>
          <h1 className="text-3xl font-extrabold">Welcome{p.fullName ? `, ${firstName(p.fullName)}` : ""} 👋</h1>
          <p className="mt-2 text-slate-600">Share your resume and answer only what I can't work out myself. Then I'll start finding jobs that fit you.</p>
          <ol className="mt-6 grid grid-cols-3 gap-2" aria-label="Setup steps">
            {STEPS.map((s, i) => (
              <li key={s} className="space-y-1.5">
                <div className={cn("h-1.5 rounded-full", i < step ? "bg-emerald-500" : i === step ? "bg-brand-600" : "bg-slate-200")} />
                <p className={cn("text-xs font-medium", i < step ? "text-emerald-700" : i === step ? "text-brand-700" : "text-slate-400")}>{i + 1}. {s}</p>
              </li>
            ))}
          </ol>
        </div>

        {p.status === "parsing" ? (
          <Card className="flex flex-col items-center gap-3 py-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
            <p className="font-display text-lg font-semibold text-ink">Reading your resume…</p>
            <p className="text-sm text-slate-500">Finding your experience, skills and education. This takes a few seconds.</p>
          </Card>
        ) : p.status === "empty" ? (
          <Card className="space-y-5 p-6">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) void upload(f); }}
              className={cn("flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition", dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50/50")}>
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/25"><Upload className="h-6 w-6" /></span>
              <div><p className="font-display text-lg font-semibold text-ink">Drop your resume here</p><p className="text-sm text-slate-500">PDF, Word or text · up to 8 MB</p></div>
              <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.doc,.txt" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
              <Button size="lg" loading={busy} onClick={() => fileRef.current?.click()}><FileText className="h-5 w-5" />Choose file</Button>
            </div>
            <ErrorNote error={error} />
            <div className="text-center"><button className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline" onClick={() => setPasting(!pasting)}><MessageSquareText className="h-4 w-4" />No file? Paste your resume text</button></div>
            {pasting && (
              <div className="space-y-2 animate-fade-in">
                <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={8} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:border-brand-400 focus:outline-none" placeholder="Paste your full resume here…" />
                <Button loading={busy} disabled={pasted.trim().length < 150} onClick={async () => {
                  setBusy(true); setError(null);
                  try { await api("/resume/text", { body: { text: pasted } }); track("resume_uploaded", { method: "paste", where: "onboarding" }); await refresh(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
                }}>Read my resume</Button>
              </div>
            )}
            <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-600" />Private to you. Used only to build your profile. Delete it any time.</p>
          </Card>
        ) : (
          <>
            <Card className="space-y-4 p-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
                <div>
                  <p className="font-display font-semibold text-ink">Here's what I understood about you</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {[p.currentRole, p.totalExperienceYears ? `${p.totalExperienceYears} years experience` : "", p.skills.length ? `${p.skills.length} skills` : "", p.city, p.education[0]?.degree.split(",")[0]].filter(Boolean).map((f, i) => (
                      <span key={f} className="rounded-lg bg-brand-50 px-2.5 py-1 text-sm font-medium text-brand-800 animate-slide-up" style={{ animationDelay: `${i * 140}ms` }}>{f}</span>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">You can review and correct everything later in your Profile.</p>
                </div>
              </div>
              <div><div className="mb-1 flex justify-between text-xs"><span className="text-slate-500">Profile readiness</span><span className="font-semibold text-ink">{p.completeness.score}%</span></div><Progress value={p.completeness.score} /></div>
              <p className="text-sm text-slate-600">{essential.length} quick question{essential.length === 1 ? "" : "s"} left before I start searching.</p>
            </Card>

            {next && (
              <Card className="space-y-4 border-brand-200 p-6 animate-slide-up" key={next.field}>
                <p className="font-display text-lg font-semibold text-ink">{next.question}</p>
                <div className="flex flex-wrap gap-2">
                  {(QUICK[next.field] || []).map((q) => <button key={q} onClick={() => void submitAnswer(q)} disabled={busy} className="h-9 rounded-full border border-slate-200 bg-white px-4 text-sm transition hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50">{q}</button>)}
                </div>
                <form onSubmit={(e) => { e.preventDefault(); void submitAnswer(answer); }} className="flex gap-2">
                  <input value={answer} onChange={(e) => setAnswer(e.target.value)} className="h-11 flex-1 rounded-xl border border-slate-200 px-3 text-sm focus:border-brand-400 focus:outline-none" placeholder="Or type — you can answer several at once" autoFocus />
                  <Button size="lg" loading={busy} type="submit">Send</Button>
                </form>
                {note && <p className="text-sm text-amber-700">{note}</p>}
                <ErrorNote error={error} />
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
