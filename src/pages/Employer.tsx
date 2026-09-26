import { Building2, CheckCircle2, ChevronDown, Clock, Sparkles, Users, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DirectApplication, DirectApplicationStatus, Employer as EmployerT, EmployerJob } from "@shared/employer";
import type { Me } from "../App";
import { api, errMsg } from "../lib/api";
import { Badge, Button, Card, Empty, ErrorNote, PageHeader, ScoreRing, Section, Spinner, cn, timeAgo, useToast } from "../ui";

type Row = EmployerJob & { applicants: number; newApplicants: number };
const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";
const STATUS_TONE: Record<EmployerJob["status"], "green" | "amber" | "red" | "slate"> = { live: "green", pending_review: "amber", rejected: "red", closed: "slate" };
const STATUS_LABEL: Record<EmployerJob["status"], string> = { live: "Live", pending_review: "In review", rejected: "Not approved", closed: "Closed" };

function Register({ me, onDone }: { me: Me; onDone: () => void }) {
  const [f, setF] = useState({ company: "", website: "", contactName: me.profile.fullName || "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await api("/employer/register", { body: f }); onDone(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <Card className="space-y-4 p-6">
        <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white"><Building2 className="h-6 w-6" /></span><div><h2 className="font-display text-lg font-semibold">Hire through MyCareer.AI</h2><p className="text-sm text-slate-600">Post jobs for free and get candidates ranked by how well they fit, each with the reasons.</p></div></div>
        <label className="block text-sm font-medium">Company name<input className={input} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></label>
        <label className="block text-sm font-medium">Company website<input className={input} placeholder="www.yourcompany.com" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></label>
        <label className="block text-sm font-medium">Your name<input className={input} value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></label>
        <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><p className="font-semibold text-slate-700">How verification works</p><p className="mt-1">You're signed in as <strong>{me.user.email}</strong>. If that email is on your company's own website domain, you're verified straight away. Otherwise a person reviews your account and each posting, usually within a day. Free-mail addresses (like Gmail) can't verify a company on their own.</p></div>
        <ErrorNote error={error} />
        <Button loading={busy} disabled={f.company.trim().length < 2 || f.website.trim().length < 4 || f.contactName.trim().length < 2} onClick={() => void submit()}>Create employer account</Button>
      </Card>
    </div>
  );
}

function PostJob({ employer, onPosted }: { employer: EmployerT; onPosted: () => void }) {
  const toast = useToast();
  const [rough, setRough] = useState("");
  const [f, setF] = useState({ title: "", location: "", description: "", salaryText: "", employmentType: "full_time" as EmployerJob["employmentType"] });
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function draft() {
    setDrafting(true); setError(null); setNote(null);
    try {
      const r = await api<{ draft: typeof f; by: "ai" | "rules" }>("/employer/draft", { body: { text: rough } });
      setF({ ...f, ...r.draft }); setNote(r.by === "ai" ? "Written by AI from your message. Please read it and fix anything that's not right." : "Filled in from your message. Please check every field.");
    } catch (e) { setError(errMsg(e)); } finally { setDrafting(false); }
  }
  async function post() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ job: EmployerJob }>("/employer/jobs", { body: { ...f, salaryText: f.salaryText || undefined } });
      toast(r.job.status === "live" ? "success" : "info", r.job.status === "live" ? "Your job is live!" : "Submitted. It will go live after a quick review.");
      setF({ title: "", location: "", description: "", salaryText: "", employmentType: "full_time" }); setRough(""); setNote(null); onPosted();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  const ok = f.title.trim().length >= 3 && f.location.trim().length >= 2 && f.description.trim().length >= 60;
  return (
    <Card className="space-y-4 p-5">
      <div><h2 className="font-display text-lg font-semibold">Post a job in about a minute</h2><p className="text-sm text-slate-600">Paste what you'd send on WhatsApp and I'll turn it into a clear posting. Or fill it in yourself.</p></div>
      <div className="space-y-2">
        <textarea rows={4} className={input} placeholder="e.g. Urgent: Delivery executives needed in Indore. ₹15,000/month + incentives. Bike and licence required." value={rough} onChange={(e) => setRough(e.target.value)} aria-label="Rough job message" />
        <Button variant="secondary" loading={drafting} disabled={rough.trim().length < 20} onClick={() => void draft()}><Sparkles className="h-4 w-4" />Write it for me</Button>
      </div>
      {note && <p className="rounded-lg bg-brand-50 p-2.5 text-sm text-brand-800">{note}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Job title<input className={input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="text-sm font-medium">Location<input className={input} placeholder="City, or Remote" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></label>
        <label className="text-sm font-medium">Salary <span className="font-normal text-slate-400">(recommended)</span><input className={input} placeholder="e.g. ₹15,000–20,000/month or 8–12 LPA" value={f.salaryText} onChange={(e) => setF({ ...f, salaryText: e.target.value })} /></label>
        <label className="text-sm font-medium">Type<select className={input} value={f.employmentType} onChange={(e) => setF({ ...f, employmentType: e.target.value as never })}><option value="full_time">Full time</option><option value="part_time">Part time</option><option value="contract">Contract</option><option value="internship">Internship</option></select></label>
      </div>
      <label className="block text-sm font-medium">Description<textarea rows={8} className={input} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <p className="text-xs text-slate-500">Candidates apply inside MyCareer.AI and choose to share their profile with you. Never ask candidates for money, and don't ask them to contact a personal email: such postings are held back.{employer.status !== "verified" && " Your company isn't verified yet, so postings are reviewed before going live."}</p>
      <ErrorNote error={error} />
      <Button loading={busy} disabled={!ok} onClick={() => void post()}>Post job</Button>
    </Card>
  );
}

function Candidates({ job }: { job: Row }) {
  const toast = useToast();
  const [list, setList] = useState<DirectApplication[] | null>(null);
  const load = useCallback(() => { api<{ candidates: DirectApplication[] }>(`/employer/jobs/${job.id}/candidates`).then((r) => setList(r.candidates)).catch(() => setList([])); }, [job.id]);
  useEffect(load, [load]);
  async function set(a: DirectApplication, status: DirectApplicationStatus) {
    const note = status === "rejected" || status === "shortlisted" ? window.prompt(status === "rejected" ? "Add a short, kind note for the candidate (optional)" : "Add a note, like when you'll call (optional)") || undefined : undefined;
    try { await api(`/employer/applicants/${a.id}/status`, { body: { status, note } }); toast("success", "The candidate has been told."); load(); } catch (e) { toast("error", errMsg(e)); }
  }
  if (!list) return <Spinner />;
  if (!list.length) return <p className="p-4 text-sm text-slate-500">No applicants yet. New ones appear here, best fit first.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {list.map((a) => (
        <li key={a.id} className="space-y-2 p-4">
          <div className="flex items-start gap-3">
            <ScoreRing score={a.matchScore} size={48} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">{a.shared.name || "Candidate"} <Badge tone={a.status === "hired" ? "green" : a.status === "rejected" ? "red" : a.status === "shortlisted" ? "sky" : "slate"}>{a.status}</Badge></p>
              <p className="text-sm text-slate-600">{a.shared.currentRole}{a.shared.experienceYears ? ` · ${a.shared.experienceYears} yrs` : ""}{a.shared.city ? ` · ${a.shared.city}` : ""}</p>
              <p className="text-xs text-slate-500">{a.shared.email}{a.shared.phone ? ` · ${a.shared.phone}` : ""} · applied {timeAgo(a.createdAt)}</p>
            </div>
          </div>
          {a.reasons.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">{a.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          {a.gaps.length > 0 && <p className="text-xs text-amber-700">Gaps: {a.gaps.join(" · ")}</p>}
          {a.shared.skills.length > 0 && <div className="flex flex-wrap gap-1">{a.shared.skills.slice(0, 10).map((s) => <Badge key={s}>{s}</Badge>)}</div>}
          {a.shared.message && <p className="rounded-lg bg-slate-50 p-2.5 text-sm italic text-slate-600">“{a.shared.message}”</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={a.status === "shortlisted"} onClick={() => void set(a, "shortlisted")}><CheckCircle2 className="h-4 w-4" />Shortlist</Button>
            <Button size="sm" variant="secondary" disabled={a.status === "hired"} onClick={() => void set(a, "hired")}>Selected</Button>
            <Button size="sm" variant="ghost" disabled={a.status === "rejected"} onClick={() => void set(a, "rejected")}><XCircle className="h-4 w-4" />Not a fit</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Employer({ me }: { me: Me }) {
  const toast = useToast();
  const [data, setData] = useState<{ employer: EmployerT | null; jobs: Row[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api<{ employer: EmployerT | null; jobs: Row[] }>("/employer/me").then(setData).catch((e) => setError(errMsg(e))); }, []);
  useEffect(load, [load]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;
  if (!data.employer) return <div className="space-y-5"><PageHeader title="For employers" subtitle="Find the right people, free." /><Register me={me} onDone={load} /></div>;
  const e = data.employer;
  return (
    <div className="space-y-6">
      <PageHeader title={e.company} subtitle="Your jobs and the people who applied." actions={<Badge tone={e.status === "verified" ? "green" : e.status === "blocked" ? "red" : "amber"}>{e.status === "verified" ? "Verified company" : e.status === "blocked" ? "Blocked" : "Pending verification"}</Badge>} />
      <PostJob employer={e} onPosted={load} />
      <Section title="Your jobs">
        {data.jobs.length === 0 ? <Empty title="No jobs yet" hint="Post your first job above. It takes about a minute." /> : (
          <div className="space-y-3">
            {data.jobs.map((j) => (
              <Card key={j.id} className="p-0">
                <div className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{j.title}</p>
                    <p className="text-xs text-slate-500">{j.location} · posted {timeAgo(j.createdAt)}{j.status === "live" ? ` · open until ${new Date(j.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}</p>
                    {j.reasons.length > 0 && <p className="mt-1 flex items-start gap-1 text-xs text-amber-700"><Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />{j.reasons.join(" ")}</p>}
                  </div>
                  <Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge>
                  <Button size="sm" variant="secondary" onClick={() => setOpen(open === j.id ? null : j.id)}><Users className="h-4 w-4" />{j.applicants} applicant{j.applicants === 1 ? "" : "s"}{j.newApplicants > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] text-white">{j.newApplicants} new</span>}<ChevronDown className={cn("h-4 w-4 transition", open === j.id && "rotate-180")} /></Button>
                  {(j.status === "live" || j.status === "pending_review") && <Button size="sm" variant="ghost" onClick={async () => { if (!window.confirm("Close this job? Candidates won't be able to apply.")) return; try { await api(`/employer/jobs/${j.id}/close`, { body: {} }); load(); } catch (err) { toast("error", errMsg(err)); } }}>Close</Button>}
                </div>
                {open === j.id && <div className="border-t border-slate-100"><Candidates job={j} /></div>}
              </Card>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
