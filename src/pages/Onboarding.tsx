import { CheckCircle2, FileText, Loader2, LogOut, MessageSquareText, Mic, ShieldCheck, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo, Wordmark, type Me } from "../App";
import { api, devUser, errMsg } from "../lib/api";
import { signOutUser } from "../lib/firebase";
import { track } from "../lib/analytics";
import { firstName } from "../lib/labels";
import InterviewFlow from "../components/InterviewFlow";
import UnderstandingCard from "../components/UnderstandingCard";
import { useI18n } from "../lib/i18n";
import { Button, Card, ErrorNote, cn } from "../ui";

const STEPS = ["Your resume", "A few questions", "Your matches"];

export default function Onboarding({ me, refresh }: { me: Me; refresh: () => Promise<void> }) {
  const p = me.profile;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [dragging, setDragging] = useState(false);
  const [talking, setTalking] = useState(false);
  const { t } = useI18n();
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

  const step = p.status === "empty" || p.status === "parsing" ? 0 : 1;

  return (
    <div className="min-h-full hero-gradient">
      <div className="mx-auto flex min-h-full max-w-2xl flex-col gap-8 px-5 py-10">
        <div className="flex items-center gap-2.5">
          <Logo className="h-8 w-8" /><Wordmark />
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="hidden max-w-[16rem] truncate text-slate-500 sm:block" title={me.user.email}>{me.user.email}</span>
            {!devUser && (
              <button onClick={() => void signOutUser().then(() => { location.hash = ""; })} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/80 px-3 py-1.5 font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white">
                <LogOut className="h-4 w-4" />Sign out
              </button>
            )}
          </div>
        </div>

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
        ) : p.status === "empty" && talking ? (
          <InterviewFlow onDone={refresh} onBack={() => setTalking(false)} />
        ) : p.status === "empty" ? (
          <Card className="space-y-5 p-6">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) void upload(f); }}
              className={cn("flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition", dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50/50")}>
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/25"><Upload className="h-6 w-6" /></span>
              <div><p className="font-display text-lg font-semibold text-ink">Drop your resume here</p><p className="text-sm text-slate-500">PDF, Word, text or a photo · up to 8 MB</p></div>
              <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.doc,.txt,.jpg,.jpeg,.png,.webp,image/*" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
              <Button size="lg" loading={busy} onClick={() => fileRef.current?.click()}><FileText className="h-5 w-5" />Choose file</Button>
            </div>
            <ErrorNote error={error} />
            <button onClick={() => setTalking(true)} className="group flex w-full items-center gap-4 rounded-2xl border border-accent-200 bg-gradient-to-br from-accent-50 to-brand-50 p-4 text-left transition hover:border-accent-400 hover:shadow-sm">
              <span className="bg-peacock flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-md"><Mic className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1"><span className="block font-display font-semibold text-ink">{t("iv.title")}</span><span className="block text-sm text-slate-600">{t("iv.sub")}</span></span>
              <span className="hidden rounded-xl bg-white px-3 py-1.5 text-sm font-medium text-brand-700 shadow-sm group-hover:bg-brand-600 group-hover:text-white sm:block">{t("iv.start")}</span>
            </button>
            <div className="text-center"><button className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline" onClick={() => setPasting(!pasting)}><MessageSquareText className="h-4 w-4" />Have your resume as text? Paste it</button></div>
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
            <Card className="flex items-start gap-3 p-6">
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
              <div className="min-w-0">
                <p className="font-display font-semibold text-ink">Here's what I understood about you</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[p.currentRole, p.totalExperienceYears ? `${p.totalExperienceYears} years experience` : "", p.skills.length ? `${p.skills.length} skills` : "", p.city, p.education[0]?.degree.split(",")[0]].filter(Boolean).map((f, i) => (
                    <span key={f} className="rounded-lg bg-brand-50 px-2.5 py-1 text-sm font-medium text-brand-800 animate-slide-up" style={{ animationDelay: `${i * 140}ms` }}>{f}</span>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">You can review and correct everything later in your Profile.</p>
              </div>
            </Card>

            {/* Same understanding engine used on Home/Profile: it actually knows how to file a role, city, salary or notice-period answer. */}
            <UnderstandingCard onChanged={() => void refresh()} className="animate-slide-up" />
          </>
        )}
      </div>
    </div>
  );
}
