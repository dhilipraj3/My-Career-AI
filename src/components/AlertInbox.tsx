import { Check, Copy, Inbox, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errMsg } from "../lib/api";
import { Badge, Button, Card, ErrorNote, timeAgo, useToast } from "../ui";

interface InboxState {
  enabled: boolean;
  address: string | null;
  verification: { code?: string; link?: string; at: string } | null;
  events: Array<{ at: string; kind: "alerts" | "verification" | "empty" | "ignored" | "limit"; jobs: number; portal?: string; from?: string; subject?: string }>;
  limits: { emailsPerDay: number; jobsPerDay: number };
  emailsToday: number;
  jobsToday: number;
}

const EVENT_TEXT: Record<InboxState["events"][number]["kind"], (e: InboxState["events"][number]) => string> = {
  alerts: (e) => `${e.jobs} job${e.jobs === 1 ? "" : "s"} added from ${e.portal || "an alert"}`,
  verification: () => "Forwarding confirmation received",
  empty: () => "Received, but no jobs found in it",
  ignored: () => "Received. Finish your profile and forward it again",
  limit: () => "Skipped: daily limit reached",
};

/** Forward job-alert emails from Naukri, LinkedIn, Indeed and others to a private address and they land in your feed. */
export default function AlertInbox() {
  const toast = useToast();
  const [s, setS] = useState<InboxState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<InboxState>("/inbox").then(setS).catch((e) => setError(errMsg(e))); }, []);

  if (error) return <ErrorNote error={error} />;
  if (!s) return null;
  if (!s.enabled || !s.address) return <div className="p-5 text-sm text-slate-600"><p className="font-semibold text-ink">Job-alert emails</p><p className="mt-0.5">Email forwarding isn't switched on for this app yet.</p></div>;

  const copy = () => { void navigator.clipboard.writeText(s.address!); setCopied(true); toast("success", "Address copied"); setTimeout(() => setCopied(false), 1500); };
  const rotate = async () => {
    if (!window.confirm("Get a new address? The old one stops working, so update your forwarding rule.")) return;
    setBusy(true);
    try { setS(await api<InboxState>("/inbox/rotate", { body: {} })); } catch (e) { toast("error", errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><Inbox className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">Job-alert emails</p>
          <p className="mt-0.5 text-sm text-slate-600">Forward the job alerts you get from Naukri, LinkedIn, Indeed, Foundit or Instahyre to your private address. The jobs appear in your feed, scored for you.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3">
        <code className="min-w-0 flex-1 break-all text-sm font-semibold text-ink">{s.address}</code>
        <Button variant="secondary" size="sm" onClick={copy}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}Copy</Button>
        <Button variant="ghost" size="sm" loading={busy} onClick={() => void rotate()}><RefreshCw className="h-4 w-4" />New address</Button>
      </div>

      <details className="text-sm text-slate-600">
        <summary className="cursor-pointer font-medium text-brand-700">How to set it up in Gmail</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Gmail → Settings → <em>Forwarding and POP/IMAP</em> → <em>Add a forwarding address</em>, and paste the address above.</li>
          <li>Google sends a confirmation email here. The code shows up below within a minute.</li>
          <li>Enter the code in Gmail, then create a filter (e.g. from: naukri.com OR linkedin.com) that forwards matching emails to this address.</li>
        </ol>
      </details>

      {s.verification && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Gmail confirmation received {timeAgo(s.verification.at)}</p>
          {s.verification.code && <p className="mt-1">Your code: <span className="rounded bg-white px-2 py-0.5 font-mono text-base font-bold tracking-widest">{s.verification.code}</span></p>}
          {s.verification.link && <p className="mt-1"><a className="font-medium underline" href={s.verification.link} target="_blank" rel="noreferrer noopener">Or open the confirmation link</a></p>}
        </div>
      )}

      <div>
        <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-slate-500">Recent emails <Badge>{s.emailsToday}/{s.limits.emailsPerDay} today</Badge></p>
        {s.events.length === 0 ? <p className="text-sm text-slate-500">Nothing received yet.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">{s.events.slice(0, 5).map((e, i) => <li key={i} className="flex items-baseline gap-2 py-1.5"><span className="flex-1 text-slate-700">{EVENT_TEXT[e.kind](e)}</span><span className="text-xs text-slate-400">{timeAgo(e.at)}</span></li>)}</ul>
        )}
      </div>
      <p className="text-xs text-slate-400">Only alert emails are read. Other messages are ignored, and nothing is kept except the jobs found.</p>
    </div>
  );
}
