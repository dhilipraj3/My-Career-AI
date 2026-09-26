import { Flag, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { Job } from "@shared/types";
import { api, errMsg } from "../lib/api";
import { celebrate } from "../lib/motion";
import { Button, ErrorNote, Modal, useToast } from "../ui";

/** Apply inside the app to a job an employer posted directly. The candidate sees exactly what is shared and confirms. */
export function DirectApply({ job, disabled, onApplied }: { job: Job; disabled?: boolean; onApplied: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function show() {
    setError(null);
    try { setFields((await api<{ willShare: string[] }>(`/jobs/${job.id}/direct`)).willShare); setOpen(true); } catch (e) { toast("error", errMsg(e)); }
  }
  async function apply() {
    setBusy(true); setError(null);
    try {
      await api(`/jobs/${job.id}/apply-direct-share`, { body: { confirm: true, message: message.trim() || undefined } });
      setOpen(false); celebrate(); toast("success", "Applied! The employer can now see your profile."); onApplied();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <Button className="w-full" size="lg" disabled={disabled} onClick={() => void show()}>Apply with my profile</Button>
      <p className="text-center text-xs text-slate-500">This employer posted the job here. You choose what to share, and nothing is sent until you confirm.</p>
      <Modal open={open} onClose={() => setOpen(false)} title={`Apply to ${job.company}`} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={() => void apply()}>Share and apply</Button></>}>
        <div className="space-y-4 text-sm">
          <div className="flex items-start gap-2 rounded-xl bg-slate-50 p-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><div><p className="font-medium text-ink">The employer will see</p><ul className="mt-1 list-disc pl-5 text-slate-600">{fields.map((f) => <li key={f}>{f}</li>)}</ul></div></div>
          <label className="block font-medium">A short message <span className="font-normal text-slate-400">(optional)</span><textarea rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Why you're interested, when you can start…" /></label>
          <ErrorNote error={error} />
        </div>
      </Modal>
    </div>
  );
}

const REASONS: Array<[string, string]> = [["scam", "It looks like a scam"], ["fee_requested", "They asked for money or a deposit"], ["fake_company", "The company seems fake"], ["misleading", "The job isn't what it says"], ["discriminatory", "It's discriminatory"], ["other", "Something else"]];

export function ReportJob({ jobId }: { jobId: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("scam");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try { await api(`/jobs/${jobId}/report`, { body: { reason, note: note.trim() || undefined } }); setOpen(false); toast("success", "Thanks. We'll look at it."); } catch (e) { toast("error", errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-slate-500 hover:text-red-600"><Flag className="h-3 w-3" />Report this job</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Report this job" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={() => void send()}>Send report</Button></>}>
        <div className="space-y-3 text-sm">
          {REASONS.map(([v, l]) => <label key={v} className="flex items-center gap-2"><input type="radio" name="reason" checked={reason === v} onChange={() => setReason(v)} />{l}</label>)}
          <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything else we should know? (optional)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
      </Modal>
    </>
  );
}
