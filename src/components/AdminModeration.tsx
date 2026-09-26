import { useCallback, useEffect, useState } from "react";
import type { Employer, EmployerJob, JobReport } from "@shared/employer";
import { api, errMsg } from "../lib/api";
import { Badge, Button, Card, ErrorNote, Section, Spinner, timeAgo, useToast } from "../ui";

interface Queue { jobs: Array<EmployerJob & { employer: Employer | null }>; employers: Employer[]; reports: JobReport[] }

/** Employer jobs waiting for a human decision, companies to verify, and candidate reports. */
export default function AdminModeration() {
  const toast = useToast();
  const [q, setQ] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api<Queue>("/admin/moderation").then(setQ).catch((e) => setError(errMsg(e))); }, []);
  useEffect(load, [load]);
  const run = async (fn: () => Promise<unknown>, done: string) => { try { await fn(); toast("success", done); load(); } catch (e) { toast("error", errMsg(e)); } };

  if (error) return <ErrorNote error={error} />;
  if (!q) return <Spinner />;
  const empty = !q.jobs.length && !q.employers.length && !q.reports.length;
  return (
    <Section title={`Employer moderation${empty ? "" : ` (${q.jobs.length + q.employers.length + q.reports.length})`}`}>
      {empty ? <Card className="text-sm text-slate-500">Nothing waiting. 🎉</Card> : (
        <div className="space-y-3">
          {q.jobs.map((j) => (
            <Card key={j.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-ink">{j.title}</p><span className="text-sm text-slate-500">· {j.company} · {j.location}</span><Badge tone={j.employer?.status === "verified" ? "green" : "amber"}>{j.employer?.status || "unknown"}</Badge><span className="ml-auto text-xs text-slate-400">{timeAgo(j.createdAt)}</span></div>
              <p className="text-xs text-slate-500">{j.employer?.contactName} · {j.employer?.contactEmail} · {j.employer?.website}</p>
              {j.reasons.length > 0 && <ul className="list-disc pl-5 text-sm text-amber-800">{j.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
              <details className="text-sm text-slate-600"><summary className="cursor-pointer">Read the posting</summary><p className="mt-1 whitespace-pre-line">{j.description}</p></details>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void run(() => api(`/admin/employer-jobs/${j.id}`, { body: { decision: "approve" } }), "Approved and live")}>Approve</Button>
                <Button size="sm" variant="secondary" onClick={() => { const reason = window.prompt("Reason shown to the employer", "It didn't meet our posting guidelines.") || undefined; void run(() => api(`/admin/employer-jobs/${j.id}`, { body: { decision: "reject", reason } }), "Rejected"); }}>Reject</Button>
                {j.employer && <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Block ${j.employer!.company}? All their jobs come down.`)) void run(() => api(`/admin/employers/${j.employerUid}`, { body: { status: "blocked" } }), "Employer blocked"); }}>Block employer</Button>}
              </div>
            </Card>
          ))}
          {q.employers.map((e) => (
            <Card key={e.uid} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1"><p className="font-semibold text-ink">{e.company}</p><p className="text-xs text-slate-500">{e.website} · {e.contactName} · {e.contactEmail}</p></div>
              <Badge tone="amber">Not verified</Badge>
              <Button size="sm" onClick={() => void run(() => api(`/admin/employers/${e.uid}`, { body: { status: "verified" } }), "Company verified")}>Verify</Button>
              <Button size="sm" variant="ghost" onClick={() => void run(() => api(`/admin/employers/${e.uid}`, { body: { status: "blocked" } }), "Blocked")}>Block</Button>
            </Card>
          ))}
          {q.reports.length > 0 && (
            <Card className="p-4"><p className="mb-2 text-sm font-semibold">Unhandled reports ({q.reports.length})</p>
              <ul className="divide-y divide-slate-100 text-sm">{q.reports.slice(0, 10).map((r) => <li key={r.id} className="py-1.5"><Badge tone="red">{r.reason.replace(/_/g, " ")}</Badge> <span className="text-slate-600">{r.note}</span> <span className="text-xs text-slate-400">job {r.jobId.slice(0, 12)} · {timeAgo(r.at)}</span></li>)}</ul></Card>
          )}
        </div>
      )}
    </Section>
  );
}
