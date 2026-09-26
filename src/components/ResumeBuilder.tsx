import { CheckCircle2, Printer, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { BuiltResume, ResumeHealth } from "@shared/career";
import { api, errMsg } from "../lib/api";
import { Badge, Button, Card, Chip, ErrorNote, Progress, Spinner, cn } from "../ui";

type Template = "classic" | "modern" | "compact";
const TEMPLATES: Array<{ id: Template; label: string; hint: string }> = [
  { id: "classic", label: "Classic", hint: "Single column, serif. Safe for every ATS." },
  { id: "modern", label: "Modern", hint: "Clean sans-serif with an accent colour." },
  { id: "compact", label: "Compact", hint: "Tighter spacing to fit more on one page." },
];

// Plain single-column layouts on purpose: applicant tracking systems read these reliably (no tables, icons or images).
function Paper({ r, t }: { r: BuiltResume; t: Template }) {
  const compact = t === "compact";
  const modern = t === "modern";
  const head = cn("font-bold uppercase tracking-wide", modern ? "border-b-2 border-brand-500 pb-0.5 text-brand-700" : "border-b border-slate-400 pb-0.5 text-slate-800", compact ? "mb-1 text-[11px]" : "mb-1.5 text-xs");
  const gap = compact ? "space-y-2.5" : "space-y-4";
  return (
    <div className={cn("print-area theme-paper bg-white p-7 text-[13px] leading-relaxed text-slate-900 shadow-sm ring-1 ring-slate-200", t === "classic" ? "font-serif" : "font-sans", compact && "text-[12px] leading-snug", gap)}>
      <header className={cn(t === "classic" && "text-center")}>
        <h2 className={cn("font-bold", modern ? "text-2xl text-brand-700" : "text-2xl")}>{r.name}</h2>
        {r.headline && <p className="text-slate-700">{r.headline}</p>}
        {r.contact.length > 0 && <p className="text-xs text-slate-600">{r.contact.join("  |  ")}</p>}
      </header>
      {r.summary && <section><h3 className={head}>Summary</h3><p>{r.summary}</p></section>}
      {r.skills.length > 0 && <section><h3 className={head}>Skills</h3><p>{r.skills.join(" • ")}</p></section>}
      {r.experience.length > 0 && (
        <section>
          <h3 className={head}>Experience</h3>
          <div className={compact ? "space-y-2" : "space-y-3"}>
            {r.experience.map((e, i) => (
              <div key={i}>
                <p className="flex flex-wrap justify-between gap-x-3"><span><strong>{e.title}</strong>{e.company && <>, {e.company}</>}{e.location && <span className="text-slate-600"> · {e.location}</span>}</span><span className="text-xs text-slate-600">{e.period}</span></p>
                {e.bullets.length > 0 && <ul className="mt-0.5 list-disc space-y-0.5 pl-5">{e.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>}
              </div>
            ))}
          </div>
        </section>
      )}
      {r.projects.length > 0 && <section><h3 className={head}>Projects</h3><ul className="space-y-0.5">{r.projects.map((p, i) => <li key={i}><strong>{p.title}</strong>{p.description && <>: {p.description}</>}</li>)}</ul></section>}
      {r.education.length > 0 && <section><h3 className={head}>Education</h3><ul className="space-y-0.5">{r.education.map((e, i) => <li key={i} className="flex flex-wrap justify-between gap-x-3"><span><strong>{e.degree}</strong>{e.institution && <>, {e.institution}</>}</span>{e.year && <span className="text-xs text-slate-600">{e.year}</span>}</li>)}</ul></section>}
      {r.certifications.length > 0 && <section><h3 className={head}>Certifications</h3><ul className="list-disc pl-5">{r.certifications.map((c, i) => <li key={i}>{c}</li>)}</ul></section>}
    </div>
  );
}

const tone = (s: number) => (s >= 80 ? "green" : s >= 60 ? "amber" : "red");

export default function ResumeBuilder() {
  const [data, setData] = useState<{ resume: BuiltResume; health: ResumeHealth } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tpl, setTpl] = useState<Template>(() => { try { return (localStorage.getItem("resumeTemplate") as Template) || "classic"; } catch { return "classic"; } });
  useEffect(() => { api<{ resume: BuiltResume; health: ResumeHealth }>("/career/resume").then(setData).catch((e) => setError(errMsg(e))); }, []);
  const pick = (t: Template) => { setTpl(t); try { localStorage.setItem("resumeTemplate", t); } catch { /* private mode */ } };

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Building your resume…" />;
  const { resume, health } = data;
  const failing = health.checks.filter((c) => !c.ok);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {TEMPLATES.map((t) => <Chip key={t.id} on={tpl === t.id} onClick={() => pick(t.id)}>{t.label}</Chip>)}
          <Button className="ml-auto" onClick={() => window.print()}><Printer className="h-4 w-4" />Download PDF</Button>
        </div>
        <p className="text-xs text-slate-500">{TEMPLATES.find((t) => t.id === tpl)?.hint} Built only from facts in your profile. In the print dialog choose “Save as PDF”.</p>
        <Paper r={resume} t={tpl} />
      </div>

      <Card className="h-fit space-y-3 p-4 lg:sticky lg:top-4">
        <div className="flex items-center justify-between"><h3 className="font-display font-semibold">Resume health</h3><Badge tone={tone(health.score)}>{health.score}/100</Badge></div>
        <Progress value={health.score} tone={health.score >= 80 ? "green" : health.score >= 60 ? "amber" : "brand"} />
        {failing.length === 0 ? <p className="text-sm text-slate-600">Everything we check looks good.</p> : <p className="text-sm text-slate-600">{failing.length} thing{failing.length === 1 ? "" : "s"} to fix{health.targetRole ? ` for ${health.targetRole}` : ""}:</p>}
        <ul className="space-y-2">
          {health.checks.map((c) => (
            <li key={c.id} className="flex gap-2 text-sm">
              {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
              <span><span className={cn(c.ok ? "text-slate-600" : "font-medium text-slate-900")}>{c.label}</span>{!c.ok && c.fix && <span className="block text-xs text-slate-500">{c.fix}</span>}</span>
            </li>
          ))}
        </ul>
        {health.keywordsMissing.length > 0 && (
          <div><p className="mb-1 text-xs font-medium text-slate-500">Employers often ask for</p><div className="flex flex-wrap gap-1">{health.keywordsMissing.slice(0, 8).map((k) => <Badge key={k}>{k}</Badge>)}</div><p className="mt-1 text-xs text-slate-500">Add these only if you truly have them.</p></div>
        )}
      </Card>
    </div>
  );
}
