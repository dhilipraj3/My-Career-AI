import { experienceText } from "@shared/format";
import { Briefcase, GraduationCap, MapPin, Plus, Sparkles, Target, Wrench, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { CandidatePreferences, EmploymentType, FeedSummary, ShiftPref, SkillEntry, WorkMode } from "@shared/types";
import type { Me } from "../App";
import { api, errMsg } from "../lib/api";
import { POPULAR_CITIES } from "../lib/labels";
import UnderstandingCard from "../components/UnderstandingCard";
import RolePaths from "../components/RolePaths";
import { Badge, Button, Card, Chip, PageHeader, Progress, cn, sentenceCase, useToast } from "../ui";

const SOURCE_LABEL: Record<string, string> = { resume: "From your resume", user: "Added by you", ai_derived: "Guessed by AI — confirm before it's used", imported: "Imported" };

function ChipEditor({ values, onChange, placeholder, suggestions = [], list }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; suggestions?: string[]; list?: string }) {
  const [text, setText] = useState("");
  const add = (v: string) => { const t = v.trim(); if (t && !values.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...values, t]); setText(""); };
  const fresh = suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()));
  return (
    <div className="space-y-2">
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5 focus-within:border-brand-400">
        {values.map((v) => (
          <span key={v} className="inline-flex h-8 items-center gap-1 rounded-lg bg-brand-50 pl-2.5 pr-1 text-sm font-medium text-brand-800">{v}
            <button aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-brand-100"><X className="h-3.5 w-3.5" /></button></span>
        ))}
        <input value={text} onChange={(e) => setText(e.target.value)} list={list} placeholder={values.length ? "Add more…" : placeholder}
          onKeyDown={(e) => { if ((e.key === "Enter" || e.key === ",") && text.trim()) { e.preventDefault(); add(text); } if (e.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1)); }}
          onBlur={() => text.trim() && add(text)} className="h-8 min-w-32 flex-1 bg-transparent px-1.5 text-sm outline-none" />
      </div>
      {fresh.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500">Suggested:</span>
          {fresh.slice(0, 6).map((s) => <button key={s} onClick={() => add(s)} className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-slate-300 px-2.5 text-xs text-slate-600 hover:border-brand-400 hover:text-brand-700"><Plus className="h-3 w-3" />{s}</button>)}
        </div>
      )}
    </div>
  );
}

function Block({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
  return (
    <Card className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>
        <div><h2 className="font-semibold">{title}</h2>{hint && <p className="text-sm text-slate-500">{hint}</p>}</div>
      </div>
      {children}
    </Card>
  );
}

export default function ProfilePage({ me, refresh }: { me: Me; refresh: () => Promise<void> }) {
  const p = me.profile;
  const pr = p.preferences;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [newSkill, setNewSkill] = useState("");
  const [roleIdeas, setRoleIdeas] = useState<string[]>([]);
  const initial = () => ({
    targetRoles: pr.targetRoles, locations: pr.locations, workModes: pr.workModes, minSalaryLPA: pr.minSalaryLPA ?? "", noticePeriodDays: pr.noticePeriodDays ?? "",
    willingToRelocate: pr.willingToRelocate ?? false, excludedCompanies: pr.excludedCompanies, employmentTypes: pr.employmentTypes, shifts: pr.shifts || [],
  } as { targetRoles: string[]; locations: string[]; workModes: WorkMode[]; minSalaryLPA: number | string; noticePeriodDays: number | string; willingToRelocate: boolean; excludedCompanies: string[]; employmentTypes: EmploymentType[]; shifts: ShiftPref[] });
  const [f, setF] = useState(initial);
  useEffect(() => { void api<FeedSummary>("/feed/summary").then((s) => setRoleIdeas(s.roleSuggestions.map((r) => r.role))).catch(() => undefined); }, []);

  const dirty = JSON.stringify(f) !== JSON.stringify(initial());

  const wrap = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); await refresh(); toast("success", msg); } catch (e) { toast("error", errMsg(e)); } finally { setBusy(false); } };
  const savePrefs = () => wrap(() => {
    const patch: Partial<CandidatePreferences> = { targetRoles: f.targetRoles, locations: f.locations, workModes: f.workModes, willingToRelocate: f.willingToRelocate, excludedCompanies: f.excludedCompanies, employmentTypes: f.employmentTypes, ...(f.shifts.length ? { shifts: f.shifts } : {}) };
    if (f.minSalaryLPA !== "") patch.minSalaryLPA = Number(f.minSalaryLPA);
    if (f.noticePeriodDays !== "") patch.noticePeriodDays = Number(f.noticePeriodDays);
    return api("/profile/preferences", { method: "PUT", body: patch });
  }, "Saved. Re-scoring your matches with the new preferences.");
  const toggleMode = (m: WorkMode) => setF({ ...f, workModes: f.workModes.includes(m) ? f.workModes.filter((x) => x !== m) : [...f.workModes, m] });
  const skillStyle = (s: SkillEntry) => (s.source === "ai_derived" ? "border-dashed border-amber-300 bg-amber-50 text-amber-900" : s.source === "user" ? "border-brand-200 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-700");

  return (
    <div className="space-y-5">
      <PageHeader title="Your profile" subtitle="What I know about you — it drives every match. Keep it accurate."
        actions={<div className="w-44"><div className="mb-1 flex justify-between text-xs"><span className="text-slate-500">Profile strength</span><span className="font-semibold text-ink">{p.completeness.score}%</span></div><Progress value={p.completeness.score} tone={p.completeness.score >= 90 ? "green" : "amber"} /></div>} />

      <UnderstandingCard onChanged={() => void refresh()} />
      <RolePaths onChanged={() => void refresh()} />

      <Card className="hero-gradient flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-brand-600 font-display text-2xl font-bold text-white">{(p.fullName || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl font-bold text-ink">{p.fullName || "Your name"}</p>
          <p className="text-slate-700">{p.currentRole || "Role not found"} · {experienceText(p.totalExperienceYears)} experience · {[p.city, p.state].filter(Boolean).join(", ") || "Location not found"}</p>
          <p className="mt-0.5 text-sm text-slate-500">{p.email}{p.phone ? ` · ${p.phone}` : ""}</p>
        </div>
        <Badge tone="brand" className="self-start">{sentenceCase(p.insights.careerLevel)} level</Badge>
      </Card>
      {p.summary && <p className="px-1 text-sm leading-relaxed text-slate-600">{p.summary}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Block icon={<Target className="h-[18px] w-[18px]" />} title="Roles you want" hint="The most important setting for good matches. Add every role you'd genuinely take.">
          <ChipEditor values={f.targetRoles} onChange={(v) => setF({ ...f, targetRoles: v })} placeholder="e.g. Project Manager" suggestions={roleIdeas} />
        </Block>

        <Block icon={<MapPin className="h-[18px] w-[18px]" />} title="Where you want to work" hint="Jobs outside these cities are capped at a Fair match unless remote or you'd relocate.">
          <ChipEditor values={f.locations} onChange={(v) => setF({ ...f, locations: v })} placeholder="e.g. Chennai" list="profile-cities" suggestions={POPULAR_CITIES.filter((c) => c !== p.city).slice(0, 0)} />
          <datalist id="profile-cities">{POPULAR_CITIES.map((c) => <option key={c} value={c} />)}</datalist>
          <div className="flex flex-wrap gap-2">
            {(["remote", "hybrid", "onsite"] as const).map((m) => <Chip key={m} on={f.workModes.includes(m)} onClick={() => toggleMode(m)}>{m === "onsite" ? "On-site" : ({ remote: "Remote", hybrid: "Hybrid", onsite: "On-site" })[m]}</Chip>)}
            <Chip on={f.willingToRelocate} onClick={() => setF({ ...f, willingToRelocate: !f.willingToRelocate })}>Open to relocate</Chip>
          </div>
        </Block>

        <Block icon={<Briefcase className="h-[18px] w-[18px]" />} title="Pay & availability">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-slate-700">Minimum pay (LPA)<input type="number" min={0} value={f.minSalaryLPA} onChange={(e) => setF({ ...f, minSalaryLPA: e.target.value })} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3" placeholder="e.g. 12" /></label>
            <label className="text-sm font-medium text-slate-700">Notice period (days)<input type="number" min={0} value={f.noticePeriodDays} onChange={(e) => setF({ ...f, noticePeriodDays: e.target.value })} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3" placeholder="e.g. 30" /></label>
          </div>
          <p className="text-xs text-slate-500">₹1 LPA ≈ ₹8,300/month. For monthly pay, 3.6 LPA ≈ ₹30,000/month.</p>
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">Job type</p>
            <div className="flex flex-wrap gap-2">
              {([["full_time", "Full-time"], ["part_time", "Part-time"], ["contract", "Contract"], ["internship", "Internship"]] as Array<[EmploymentType, string]>).map(([v, l]) => (
                <Chip key={v} on={f.employmentTypes.includes(v)} onClick={() => setF({ ...f, employmentTypes: f.employmentTypes.includes(v) ? f.employmentTypes.filter((x) => x !== v) : [...f.employmentTypes, v] })}>{l}</Chip>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">Shifts you can work</p>
            <div className="flex flex-wrap gap-2">
              {([["day", "Day"], ["night", "Night"], ["rotational", "Rotational"], ["flexible", "Flexible hours"], ["any", "Any shift"]] as Array<[ShiftPref, string]>).map(([v, l]) => (
                <Chip key={v} on={f.shifts.includes(v)} onClick={() => setF({ ...f, shifts: v === "any" ? (f.shifts.includes("any") ? [] : ["any"]) : f.shifts.includes(v) ? f.shifts.filter((x) => x !== v) : [...f.shifts.filter((x) => x !== "any"), v] })}>{l}</Chip>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">Jobs on shifts you can't do won't be among your top matches.</p>
          </div>
        </Block>

        <Block icon={<X className="h-[18px] w-[18px]" />} title="Companies to avoid" hint="You won't see jobs from these.">
          <ChipEditor values={f.excludedCompanies} onChange={(v) => setF({ ...f, excludedCompanies: v })} placeholder="Company name" />
        </Block>
      </div>

      {dirty && (
        <div className="sticky bottom-20 z-10 flex items-center justify-between gap-3 rounded-2xl bg-[#0f2a3b] ring-1 ring-white/10 px-5 py-3 text-white shadow-[var(--shadow-pop)] animate-slide-up lg:bottom-6">
          <p className="text-sm">You have unsaved changes.</p>
          <div className="flex gap-2"><Button variant="ghost" size="sm" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setF(initial())}>Discard</Button><Button size="sm" loading={busy} onClick={savePrefs}>Save changes</Button></div>
        </div>
      )}

      <Block icon={<Wrench className="h-[18px] w-[18px]" />} title={`Skills (${p.skills.length})`} hint="Only skills from your resume or added by you are used for matching and tailored resumes.">
        <div className="flex flex-wrap gap-1.5">
          {p.skills.map((s) => (
            <span key={s.key} title={SOURCE_LABEL[s.source]} className={cn("inline-flex h-8 items-center gap-1 rounded-lg border pl-2.5 pr-1 text-sm", skillStyle(s))}>
              {s.name}
              <button aria-label={`Remove ${s.name}`} onClick={() => void wrap(() => api("/profile", { method: "PATCH", body: { removeSkills: [s.key] } }), `Removed ${s.name}`)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
            </span>
          ))}
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const s = newSkill.trim(); if (!s) return; void wrap(() => api("/profile", { method: "PATCH", body: { addSkills: [s] } }), `Added ${s}`).then(() => setNewSkill("")); }}>
          <input value={newSkill} onChange={(e) => setNewSkill(e.target.value)} placeholder="Add a skill you have" className="h-10 flex-1 rounded-xl border border-slate-200 px-3 text-sm" />
          <Button type="submit" variant="secondary"><Plus className="h-4 w-4" />Add</Button>
        </form>
        <p className="flex flex-wrap gap-3 text-xs text-slate-500"><span className="flex items-center gap-1"><span className="h-3 w-3 rounded border border-slate-300 bg-white" />From resume</span><span className="flex items-center gap-1"><span className="h-3 w-3 rounded border border-brand-200 bg-brand-50" />Added by you</span><span className="flex items-center gap-1"><span className="h-3 w-3 rounded border border-dashed border-amber-300 bg-amber-50" />Guessed by AI</span></p>
      </Block>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Block icon={<Sparkles className="h-[18px] w-[18px]" />} title="Experience" hint="Read from your resume. Upload an updated resume to correct it.">
          {p.experience.length === 0 ? <p className="text-sm text-slate-500">No work experience found in your resume.</p> : (
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {p.experience.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-500 ring-2 ring-brand-100" />
                  <p className="font-medium text-ink">{e.designation || "Role"}{e.company ? <span className="font-normal text-slate-600"> · {e.company}</span> : null}</p>
                  <p className="text-xs text-slate-500">{[e.startDate, e.current ? "Present" : e.endDate].filter(Boolean).join(" – ")}</p>
                </li>
              ))}
            </ol>
          )}
        </Block>
        <Block icon={<GraduationCap className="h-[18px] w-[18px]" />} title="Education & certifications">
          <ul className="space-y-2 text-sm">
            {p.education.map((e) => {
              // Resumes often put the institution and year inside the degree line; don't repeat them.
              const degree = e.degree.replace(e.institution, "").replace(e.gradYear || "\u0000", "").replace(/[\s,·-]+$/, "").trim() || e.degree;
              return <li key={e.id}><p className="font-medium text-ink">{degree}</p><p className="text-slate-500">{[e.institution, e.gradYear].filter(Boolean).join(" · ")}</p></li>;
            })}
            {p.certifications.map((c) => <li key={c.id} className="flex items-center gap-2"><Badge tone="green">Cert</Badge>{c.name}{c.year && !c.name.includes(c.year) ? <span className="text-slate-500"> · {c.year}</span> : null}</li>)}
            {!p.education.length && !p.certifications.length && <li className="text-slate-500">None found in your resume.</li>}
          </ul>
        </Block>
      </div>
    </div>
  );
}
