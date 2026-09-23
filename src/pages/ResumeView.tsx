import { AlertTriangle, CheckCircle2, Copy, Printer } from "lucide-react";
import { useMemo, useState } from "react";
import type { CandidateProfile, ResumeVersion, TailoredResumeContent } from "@shared/types";
import { Badge, Button, Card, ErrorNote } from "../ui";

/** Preview + light editing of a tailored resume. Edits are re-validated server-side against the real profile on approval. */
export default function ResumeView({ version, profile, onApprove, busy, error }: {
  version: ResumeVersion;
  profile: CandidateProfile;
  onApprove?: (edited?: TailoredResumeContent) => void;
  busy?: boolean;
  error?: string | null;
}) {
  const original = version.content!;
  const [content, setContent] = useState<TailoredResumeContent>(original);
  const [editing, setEditing] = useState(false);
  const dirty = useMemo(() => JSON.stringify(content) !== JSON.stringify(original), [content, original]);
  const errors = version.validation.issues.filter((i) => i.severity === "error");
  const warnings = version.validation.issues.filter((i) => i.severity === "warning");
  const contact = [profile.email, profile.phone, [profile.city, profile.state].filter(Boolean).join(", "), profile.links.linkedin].filter(Boolean).join(" · ");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {version.approved ? <Badge tone="green"><CheckCircle2 className="mr-1 h-3 w-3" />Approved</Badge> : <Badge tone="amber">Needs your approval</Badge>}
        <Badge tone={version.validation.ok ? "green" : "red"}>{version.validation.ok ? "Verified against your profile" : "Failed verification"}</Badge>
        <Badge>{version.generatedBy === "ai" ? "AI-tailored" : version.generatedBy === "user" ? "Edited by you" : "Auto-tailored"}</Badge>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" onClick={() => void navigator.clipboard.writeText(version.text)}><Copy className="h-4 w-4" />Copy</Button>
          <Button variant="ghost" onClick={() => window.print()}><Printer className="h-4 w-4" />Print / PDF</Button>
        </div>
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="mb-1 flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" />Verification notes</p>
          <ul className="list-disc space-y-0.5 pl-5">{[...errors, ...warnings].slice(0, 6).map((i, k) => <li key={k}>{i.message}</li>)}</ul>
        </div>
      )}

      <Card className="print-area space-y-4 p-6 text-sm leading-relaxed">
        <header>
          <h2 className="text-xl font-bold">{profile.fullName}</h2>
          <p className="text-slate-700">{content.headline}</p>
          <p className="text-xs text-slate-500">{contact}</p>
        </header>
        <section>
          <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Summary</h3>
          {editing ? <textarea value={content.summary} onChange={(e) => setContent({ ...content, summary: e.target.value })} rows={3} className="w-full rounded border border-slate-300 p-2" /> : <p>{content.summary}</p>}
        </section>
        {content.skills.length > 0 && (
          <section>
            <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Skills</h3>
            <div className="flex flex-wrap gap-1.5">
              {content.skills.map((s) => (
                <span key={s} className="rounded bg-slate-100 px-2 py-0.5 text-xs">{s}{editing && <button aria-label={`Remove ${s}`} className="ml-1 text-slate-400 hover:text-red-600" onClick={() => setContent({ ...content, skills: content.skills.filter((x) => x !== s) })}>×</button>}</span>
              ))}
            </div>
          </section>
        )}
        <section>
          <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Experience</h3>
          <div className="space-y-3">
            {content.experience.map((e, i) => (
              <div key={e.experienceId}>
                <p className="font-semibold">{e.designation} <span className="font-normal text-slate-600">— {e.company}</span></p>
                <p className="text-xs text-slate-500">{e.period}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {e.bullets.map((b, j) => (
                    <li key={j}>
                      {editing ? (
                        <span className="flex gap-1"><textarea value={b} rows={2} onChange={(ev) => setContent({ ...content, experience: content.experience.map((x, k) => k === i ? { ...x, bullets: x.bullets.map((y, m) => m === j ? ev.target.value : y) } : x) })} className="w-full rounded border border-slate-300 p-1" />
                          <button aria-label="Remove bullet" className="text-slate-400 hover:text-red-600" onClick={() => setContent({ ...content, experience: content.experience.map((x, k) => k === i ? { ...x, bullets: x.bullets.filter((_, m) => m !== j) } : x) })}>×</button></span>
                      ) : b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
        {content.projects.length > 0 && <section><h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Projects</h3>{content.projects.map((p) => <p key={p.title}><strong>{p.title}:</strong> {p.description}</p>)}</section>}
        {content.education.length > 0 && <section><h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Education</h3>{content.education.map((e, i) => <p key={i}>{e.degree}, {e.institution}{e.gradYear ? ` (${e.gradYear})` : ""}</p>)}</section>}
        {content.certifications.length > 0 && <section><h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Certifications</h3><p>{content.certifications.join(" · ")}</p></section>}
      </Card>

      <ErrorNote error={error} />
      {onApprove && !version.approved && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => { if (editing && dirty) setContent(original); setEditing(!editing); }}>{editing ? "Cancel editing" : "Edit"}</Button>
          <Button loading={busy} onClick={() => onApprove(dirty ? content : undefined)}>{dirty ? "Save edits & approve" : "Approve this resume"}</Button>
          <p className="text-xs text-slate-500">Everything here comes from your own resume. Edits are re-checked against it.</p>
        </div>
      )}
    </div>
  );
}
