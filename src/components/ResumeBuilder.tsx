import { ArrowRight, Briefcase, Maximize2, CheckCircle2, Download, Lightbulb, Pencil, Plus, Trash2, UserRound, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { BuiltResume, ResumeCheck, ResumeHealth } from "@shared/career";
import type { CandidateProfile, ExperienceEntry } from "@shared/types";
import { api, errMsg } from "../lib/api";
import { fromBuilt, openResume, printResume, type Template } from "../lib/resumeDoc";
import { Badge, Button, Card, ErrorNote, Progress, Skeleton, cn, useToast } from "../ui";
import ResumePaper from "./ResumePaper";

const TEMPLATES: Array<{ id: Template; label: string; hint: string }> = [
  { id: "classic", label: "Classic", hint: "Serif, centred header. Safe for every applicant tracking system." },
  { id: "modern", label: "Modern", hint: "Clean sans-serif with a peacock accent." },
  { id: "compact", label: "Compact", hint: "Tighter spacing to fit more on each page." },
];
type Area = "contact" | "summary" | "experience" | "skills";
const input = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none";

// ---------------------------------------------------------------- editors
function Section({ id, icon, title, hint, children, open, onToggle }: { id: Area; icon: ReactNode; title: string; hint: string; children: ReactNode; open: boolean; onToggle: () => void }) {
  return (
    <Card id={`edit-${id}`} className={cn("scroll-mt-24 p-0 transition", open && "ring-2 ring-brand-300")}>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>
        <span className="min-w-0 flex-1"><span className="block font-semibold text-ink">{title}</span><span className="block text-sm text-slate-500">{hint}</span></span>
        <Pencil className={cn("h-4 w-4 shrink-0 text-slate-400 transition", open && "text-brand-600")} />
      </button>
      {open && <div className="space-y-4 border-t border-slate-100 p-4">{children}</div>}
    </Card>
  );
}

function ContactEditor({ p, onSaved }: { p: CandidateProfile; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({ fullName: p.fullName, email: p.email, phone: p.phone, city: p.city });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await api("/profile", { method: "PATCH", body: { scalars: f } }); await onSaved(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {([["fullName", "Full name"], ["email", "Email"], ["phone", "Phone"], ["city", "City"]] as const).map(([k, l]) => (
          <label key={k} className="space-y-1 text-sm font-medium text-slate-700">{l}<input className={input} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} inputMode={k === "phone" ? "tel" : k === "email" ? "email" : undefined} /></label>
        ))}
      </div>
      <ErrorNote error={error} />
      <Button loading={busy} onClick={() => void save()}>Save contact details</Button>
    </>
  );
}

function SummaryEditor({ p, suggested, onSaved }: { p: CandidateProfile; suggested?: string; onSaved: () => Promise<void> }) {
  const [text, setText] = useState(p.summary || "");
  const [busy, setBusy] = useState(false);
  const save = async (value = text) => { setBusy(true); try { await api("/profile", { method: "PATCH", body: { scalars: { summary: value.trim() } } }); await onSaved(); } finally { setBusy(false); } };
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return (
    <>
      {suggested && suggested !== text && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-semibold text-brand-800"><Lightbulb className="h-4 w-4" />Suggested from your profile</p>
          <p className="mt-1 text-slate-700">{suggested}</p>
          <Button size="sm" className="mt-2" onClick={() => setText(suggested)}>Use this</Button>
        </div>
      )}
      <label className="block space-y-1 text-sm font-medium text-slate-700">Your summary
        <textarea className={cn(input, "min-h-28")} value={text} onChange={(e) => setText(e.target.value)} placeholder="2–3 lines: what you do, what you're best at, and the role you want next." />
      </label>
      <p className={cn("text-xs", words >= 25 && words <= 80 ? "text-emerald-600" : "text-slate-500")}>{words} words · aim for 25–80</p>
      <Button loading={busy} disabled={text.trim().length < 20} onClick={() => void save()}>Save summary</Button>
    </>
  );
}

function JobEditor({ job, health, onDone, onCancel }: { job?: ExperienceEntry; health: ResumeHealth; onDone: () => Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState({
    designation: job?.designation || "", company: job?.company || "", startDate: (job?.startDate || "").slice(0, 7), endDate: job?.current ? "" : (job?.endDate || "").slice(0, 7),
    current: job?.current || false, points: job ? [...job.responsibilities, ...job.achievements] : [""],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rewrites = health.rewrites.filter((r) => r.experienceId === job?.id);
  const numbers = health.needsNumbers.filter((r) => r.experienceId === job?.id);
  const setPoint = (i: number, v: string) => setF({ ...f, points: f.points.map((p, k) => (k === i ? v : p)) });
  const save = async () => {
    setBusy(true); setError(null);
    const body = { ...f, points: f.points.map((p) => p.trim()).filter((p) => p.length >= 3) };
    try {
      if (job) await api(`/profile/experience/${job.id}`, { method: "PUT", body });
      else await api("/profile/experience", { body });
      await onDone();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-slate-700">Job title<input className={input} value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} /></label>
        <label className="space-y-1 text-sm font-medium text-slate-700">Company<input className={input} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></label>
        <label className="space-y-1 text-sm font-medium text-slate-700">Started<input type="month" className={input} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
        <label className="space-y-1 text-sm font-medium text-slate-700">Ended<input type="month" className={input} disabled={f.current} value={f.current ? "" : f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="h-4 w-4" checked={f.current} onChange={(e) => setF({ ...f, current: e.target.checked })} />I work here now</label>
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">What you did <span className="font-normal text-slate-500">(3–5 points, start with an action word, add numbers where true)</span></p>
        {f.points.map((pt, i) => {
          const rw = rewrites.find((r) => r.from.trim() === pt.trim());
          const num = numbers.find((r) => r.point.trim() === pt.trim());
          return (
            <div key={i} className="space-y-1.5">
              <div className="flex items-start gap-2">
                <textarea rows={2} className={cn(input, "min-h-[3.25rem]")} value={pt} onChange={(e) => setPoint(i, e.target.value)} placeholder="e.g. Led a team of 8 to deliver the billing system 2 weeks early" />
                <button aria-label="Remove this point" onClick={() => setF({ ...f, points: f.points.filter((_, k) => k !== i) })} className="mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
              </div>
              {rw && <button onClick={() => setPoint(i, rw.to)} className="flex w-full items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-left text-xs text-amber-900 hover:bg-amber-100"><Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span><strong>Stronger:</strong> {rw.to} <span className="font-semibold underline">Use this</span></span></button>}
              {!rw && num && <p className="flex items-start gap-2 px-1 text-xs text-slate-500"><Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />Add a number if you have one: team size, %, ₹, customers or time saved.</p>}
            </div>
          );
        })}
        {f.points.length < 8 && <Button size="sm" variant="ghost" onClick={() => setF({ ...f, points: [...f.points, ""] })}><Plus className="h-4 w-4" />Add a point</Button>}
      </div>
      <ErrorNote error={error} />
      <div className="flex flex-wrap gap-2">
        <Button loading={busy} disabled={f.designation.trim().length < 2 || !f.company.trim()} onClick={() => void save()}>{job ? "Save job" : "Add job"}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function ExperienceEditor({ p, health, onSaved }: { p: CandidateProfile; health: ResumeHealth; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const remove = async (e: ExperienceEntry) => {
    if (!window.confirm(`Remove ${e.designation} at ${e.company} from your profile?`)) return;
    try { await api(`/profile/experience/${e.id}`, { method: "DELETE" }); await onSaved(); } catch (err) { toast("error", errMsg(err)); }
  };
  return (
    <div className="space-y-3">
      {p.experience.map((e) => editing === e.id ? (
        <JobEditor key={e.id} job={e} health={health} onCancel={() => setEditing(null)} onDone={async () => { setEditing(null); await onSaved(); }} />
      ) : (
        <div key={e.id} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink">{e.designation}</p>
            <p className="text-sm text-slate-600">{e.company}{e.startDate ? ` · ${e.startDate.slice(0, 7)} – ${e.current ? "Present" : (e.endDate || "").slice(0, 7)}` : ""}</p>
            <p className="mt-0.5 text-xs text-slate-500">{e.responsibilities.length + e.achievements.length} points{health.rewrites.some((r) => r.experienceId === e.id) ? " · wording can be stronger" : ""}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setEditing(e.id)}>Edit</Button>
          <button aria-label={`Remove ${e.designation}`} onClick={() => void remove(e)} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      {editing === "new" ? <JobEditor health={health} onCancel={() => setEditing(null)} onDone={async () => { setEditing(null); await onSaved(); }} />
        : <Button variant="secondary" onClick={() => setEditing("new")}><Plus className="h-4 w-4" />Add a job</Button>}
    </div>
  );
}

function SkillsEditor({ p, health, onSaved }: { p: CandidateProfile; health: ResumeHealth; onSaved: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const have = new Set(p.skills.filter((s) => s.source !== "ai_derived").map((s) => s.name.toLowerCase()));
  const change = async (body: object, key: string) => { setBusy(key); try { await api("/profile", { method: "PATCH", body }); await onSaved(); } finally { setBusy(null); } };
  const shown = p.skills.filter((s) => s.source !== "ai_derived");
  return (
    <>
      {health.keywordsMissing.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">Employers {health.targetRole ? `hiring for ${health.targetRole}` : ""} often ask for</p>
          <p className="text-xs text-amber-800">Tap the ones you have really used. Never add a skill you don't have.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{health.keywordsMissing.filter((k) => !have.has(k.toLowerCase())).map((k) => (
            <button key={k} disabled={busy === k} onClick={() => void change({ addSkills: [k] }, k)} className="inline-flex h-8 items-center gap-1 rounded-full border border-amber-300 bg-white px-3 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"><Plus className="h-3.5 w-3.5" />{k}</button>
          ))}</div>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">{shown.map((s) => (
        <span key={s.key} className="inline-flex h-8 items-center gap-1 rounded-lg bg-brand-50 pl-2.5 pr-1 text-sm font-medium text-brand-800">{s.name}
          <button aria-label={`Remove ${s.name}`} disabled={busy === s.key} onClick={() => void change({ removeSkills: [s.name] }, s.key)} className="flex h-7 w-7 items-center justify-center rounded hover:bg-brand-100"><X className="h-3.5 w-3.5" /></button></span>
      ))}</div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void change({ addSkills: [text.trim()] }, "new").then(() => setText("")); }}>
        <input className={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a skill, e.g. Power BI" />
        <Button type="submit" variant="secondary" loading={busy === "new"} disabled={!text.trim()}>Add</Button>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- page section
export default function ResumeBuilder({ profile, onChanged }: { profile: CandidateProfile; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [data, setData] = useState<{ resume: BuiltResume; health: ResumeHealth } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Area | null>(null);
  const [tpl, setTpl] = useState<Template>(() => { try { return (localStorage.getItem("resumeTemplate") as Template) || "classic"; } catch { return "classic"; } });
  const editors = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => { try { setData(await api<{ resume: BuiltResume; health: ResumeHealth }>("/career/resume")); } catch (e) { setError(errMsg(e)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const pick = (t: Template) => { setTpl(t); try { localStorage.setItem("resumeTemplate", t); } catch { /* private mode */ } };
  const saved = async () => { await Promise.all([onChanged(), load()]); toast("success", "Saved. Your resume is updated."); };
  const fix = (c: ResumeCheck) => {
    const area: Area = c.area === "other" ? "experience" : c.area;
    setOpen(area);
    setTimeout(() => document.getElementById(`edit-${area}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  if (error) return <ErrorNote error={error} />;
  if (!data) return <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]"><Skeleton className="h-[640px] rounded-xl" /><Skeleton className="h-80 rounded-2xl" /></div>;
  const { resume, health } = data;
  const failing = health.checks.filter((c) => !c.ok);
  const tone = health.score >= 85 ? "green" : health.score >= 65 ? "amber" : "red";

  return (
    <div className="space-y-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl bg-slate-100 p-1" role="group" aria-label="Template">
              {TEMPLATES.map((t) => <button key={t.id} aria-pressed={tpl === t.id} onClick={() => pick(t.id)} className={cn("h-9 rounded-lg px-3.5 text-sm font-medium transition", tpl === t.id ? "bg-white text-ink shadow-sm" : "text-slate-600 hover:text-ink")}>{t.label}</button>)}
            </div>
            <div className="ml-auto flex gap-2"><Button variant="secondary" onClick={() => openResume(fromBuilt(resume), tpl)}><Maximize2 className="h-4 w-4" />Full size</Button><Button onClick={() => printResume(fromBuilt(resume), tpl, `${resume.name} - Resume`)}><Download className="h-4 w-4" />Download PDF</Button></div>
          </div>
          <p className="text-xs text-slate-500">{TEMPLATES.find((t) => t.id === tpl)?.hint} In the print window, choose <strong>Save as PDF</strong>. Every page is included.</p>
          <ResumePaper doc={fromBuilt(resume)} template={tpl} />
        </div>

        <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          <Card className="space-y-3">
            <div className="flex items-center justify-between"><h3 className="font-display text-base font-semibold text-ink">Resume check</h3><Badge tone={tone}>{health.score} / 100</Badge></div>
            <Progress value={health.score} tone={health.score >= 85 ? "green" : health.score >= 65 ? "amber" : "brand"} />
            <p className="text-sm text-slate-600">{failing.length === 0 ? "Everything looks good. Keep it up to date as you grow." : `${failing.length} ${failing.length === 1 ? "thing" : "things"} to improve${health.targetRole ? ` for ${health.targetRole} roles` : ""}.`}</p>
            <ul className="space-y-2">
              {failing.map((c) => (
                <li key={c.id} className="rounded-xl border border-slate-200 p-3">
                  <p className="text-sm font-medium text-ink">{c.label}</p>
                  {c.fix && <p className="mt-0.5 text-xs text-slate-600">{c.fix}</p>}
                  <Button size="sm" variant="secondary" className="mt-2" onClick={() => fix(c)}><Wrench className="h-3.5 w-3.5" />Fix this<ArrowRight className="h-3.5 w-3.5" /></Button>
                </li>
              ))}
            </ul>
            {health.checks.some((c) => c.ok) && (
              <details className="text-sm"><summary className="cursor-pointer text-slate-500">Passed checks ({health.checks.filter((c) => c.ok).length})</summary>
                <ul className="mt-2 space-y-1.5">{health.checks.filter((c) => c.ok).map((c) => <li key={c.id} className="flex items-start gap-2 text-slate-600"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{c.label}</li>)}</ul>
              </details>
            )}
          </Card>
        </aside>
      </div>

      <div ref={editors} className="space-y-3">
        <div><h2 className="font-display text-lg font-semibold text-ink">Improve your resume</h2><p className="text-sm text-slate-500">Changes update your profile, your matches and every resume made from now on.</p></div>
        <Section id="contact" icon={<UserRound className="h-[18px] w-[18px]" />} title="Contact details" hint="Name, email, phone and city" open={open === "contact"} onToggle={() => setOpen(open === "contact" ? null : "contact")}>
          <ContactEditor p={profile} onSaved={saved} />
        </Section>
        <Section id="summary" icon={<Pencil className="h-[18px] w-[18px]" />} title="Summary" hint="The 2–3 lines recruiters read first" open={open === "summary"} onToggle={() => setOpen(open === "summary" ? null : "summary")}>
          <SummaryEditor p={profile} suggested={health.suggestedSummary} onSaved={saved} />
        </Section>
        <Section id="experience" icon={<Briefcase className="h-[18px] w-[18px]" />} title="Work history" hint={`${profile.experience.length} ${profile.experience.length === 1 ? "job" : "jobs"} · dates, points and wording`} open={open === "experience"} onToggle={() => setOpen(open === "experience" ? null : "experience")}>
          <ExperienceEditor p={profile} health={health} onSaved={saved} />
        </Section>
        <Section id="skills" icon={<Wrench className="h-[18px] w-[18px]" />} title="Skills" hint="Add what employers ask for, if you have it" open={open === "skills"} onToggle={() => setOpen(open === "skills" ? null : "skills")}>
          <SkillsEditor p={profile} health={health} onSaved={saved} />
        </Section>
      </div>
    </div>
  );
}
