import { Bell, Briefcase, CalendarClock, ChevronDown, MessageSquare, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { APPLICATION_TRANSITIONS, type ApplicationRecord, type ApplicationStatus } from "@shared/types";
import { api, errMsg } from "../lib/api";
import { track } from "../lib/analytics";
import { celebrate } from "../lib/motion";
import { useNav } from "../lib/nav";
import { Badge, Button, CompanyMark, Empty, ErrorNote, Modal, PageHeader, Skeleton, Tabs, cn, timeAgo, titleCase, useToast } from "../ui";

type Column = "preparing" | "applied" | "interviewing" | "offer" | "closed";
const COLUMNS: Array<{ id: Column; label: string; statuses: ApplicationStatus[]; tone: string }> = [
  { id: "preparing", label: "Preparing", statuses: ["recommended", "saved", "preparing"], tone: "bg-slate-400" },
  { id: "applied", label: "Applied", statuses: ["applied", "under_review"], tone: "bg-brand-500" },
  { id: "interviewing", label: "Interviewing", statuses: ["shortlisted", "interview"], tone: "bg-sky-500" },
  { id: "offer", label: "Offer", statuses: ["offer"], tone: "bg-emerald-500" },
  { id: "closed", label: "Closed", statuses: ["rejected", "withdrawn", "expired"], tone: "bg-slate-300" },
];
const columnOf = (s: ApplicationStatus): Column => COLUMNS.find((c) => c.statuses.includes(s))!.id;
const STATUS_TONE = (s: ApplicationStatus) => (s === "offer" ? "green" : ["rejected", "withdrawn", "expired"].includes(s) ? "red" : ["interview", "shortlisted"].includes(s) ? "sky" : s === "preparing" ? "slate" : "brand") as "green" | "red" | "sky" | "slate" | "brand";

function AppCard({ a, onOpen, onMove, onDetails }: { a: ApplicationRecord; onOpen: () => void; onMove: (s: ApplicationStatus) => void; onDetails: () => void }) {
  const next = APPLICATION_TRANSITIONS[a.status];
  const upcoming = a.interviewDates.filter((d) => new Date(d).getTime() > Date.now()).sort()[0];
  const followUp = a.followUpAt && ["applied", "under_review"].includes(a.status) && new Date(a.followUpAt).getTime() <= Date.now();
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-[var(--shadow-card)] transition hover:border-brand-200 hover:shadow-[var(--shadow-lift)]">
      <button onClick={onOpen} className="flex w-full items-start gap-3 text-left">
        <CompanyMark name={a.company} size={36} />
        <span className="min-w-0 flex-1"><span className="line-clamp-2 block text-sm font-semibold text-ink">{a.role}</span><span className="block truncate text-xs text-slate-500">{a.company}</span></span>
      </button>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Badge tone={STATUS_TONE(a.status)}>{titleCase(a.status)}</Badge>
        <span className="text-[11px] text-slate-400">{a.appliedAt ? `Applied ${timeAgo(a.appliedAt)}` : `Started ${timeAgo(a.createdAt)}`}</span>
      </div>
      {upcoming && <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-sky-700"><CalendarClock className="h-3.5 w-3.5" />{new Date(upcoming).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</p>}
      {followUp && <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-700"><Bell className="h-3.5 w-3.5" />Time to follow up</p>}
      <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-2.5">
        {next.length > 0 && (
          <select aria-label="Move to" value="" onChange={(e) => e.target.value && onMove(e.target.value as ApplicationStatus)} className="h-8 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700">
            <option value="">Move to…</option>
            {next.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
        )}
        <button onClick={onDetails} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-slate-500 hover:bg-slate-100"><MessageSquare className="h-3.5 w-3.5" />{a.notes ? a.notes.split("\n").length : "Notes"}</button>
      </div>
    </div>
  );
}

export default function Applications({ openJob }: { openJob: (id: string) => void }) {
  const nav = useNav();
  const toast = useToast();
  const [apps, setApps] = useState<ApplicationRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mobileCol, setMobileCol] = useState<Column>("applied");
  const [showClosed, setShowClosed] = useState(false);
  const [detail, setDetail] = useState<ApplicationRecord | null>(null);
  const [note, setNote] = useState("");
  const [interview, setInterview] = useState<{ a: ApplicationRecord; when: string } | null>(null);

  const load = useCallback(async () => {
    try { setApps((await api<{ applications: ApplicationRecord[] }>("/applications")).applications); } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const move = async (a: ApplicationRecord, status: ApplicationStatus, interviewDate?: string) => {
    if (status === "interview" && !interviewDate) { setInterview({ a, when: "" }); return; }
    try { await api(`/applications/${a.id}/status`, { body: { status, ...(interviewDate ? { interviewDate } : {}) } });
      track("application_status", { status }); if (status === "applied") track("application_applied", { from: "board" }); if (status === "interview") track("application_interview"); if (status === "offer") track("application_offer"); if (["interview", "offer", "shortlisted"].includes(status)) celebrate(status === "offer" ? 140 : 70);
      toast("success", status === "offer" ? "An offer! 🎉 Congratulations!" : status === "interview" ? "Interview scheduled — you've got this! 💪" : `Moved to ${titleCase(status)}`); await load(); } catch (e) { toast("error", errMsg(e)); }
  };
  const addNote = async () => {
    if (!detail || !note.trim()) return;
    try { const r = await api<{ application: ApplicationRecord }>(`/applications/${detail.id}/note`, { body: { note: note.trim() } }); setDetail(r.application); setNote(""); await load(); } catch (e) { toast("error", errMsg(e)); }
  };

  const by = (c: Column) => (apps || []).filter((a) => columnOf(a.status) === c);
  const active = (apps || []).filter((a) => columnOf(a.status) !== "closed");
  const visible = COLUMNS.filter((c) => c.id !== "closed" || showClosed);

  return (
    <div className="space-y-5">
      <PageHeader title="Applications" subtitle={apps ? `${active.length} in progress · ${by("interviewing").length} interviewing · ${by("offer").length} offer${by("offer").length === 1 ? "" : "s"}` : " "}
        actions={by("closed").length > 0 && <Button variant="ghost" onClick={() => setShowClosed(!showClosed)}><ChevronDown className={cn("h-4 w-4 transition", showClosed && "rotate-180")} />{showClosed ? "Hide" : "Show"} closed ({by("closed").length})</Button>} />
      <ErrorNote error={error} />

      {apps === null ? <div className="grid gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}</div> : apps.length === 0 ? (
        <Empty icon={<Briefcase className="h-6 w-6" />} title="No applications yet" hint="Open any job you like and press “Prepare my application”. I'll tailor your resume and track it here." action={<Button onClick={() => nav.go("matches")}><Sparkles className="h-4 w-4" />See my matches</Button>} />
      ) : (
        <>
          <div className="md:hidden"><Tabs value={mobileCol} onChange={setMobileCol} items={COLUMNS.map((c) => ({ id: c.id, label: c.label, count: by(c.id).length }))} /></div>
          <div className={cn("grid gap-4", showClosed ? "md:grid-cols-5" : "md:grid-cols-4")}>
            {visible.map((c) => (
              <section key={c.id} className={cn("space-y-3 rounded-2xl bg-slate-100/70 p-3", c.id !== mobileCol && "hidden md:block")}>
                <h2 className="flex items-center gap-2 px-1 text-sm font-semibold text-ink"><span className={cn("h-2 w-2 rounded-full", c.tone)} />{c.label}<span className="ml-auto rounded-full bg-white px-2 text-xs text-slate-500">{by(c.id).length}</span></h2>
                {by(c.id).length === 0 ? <p className="px-1 py-6 text-center text-xs text-slate-400">Nothing here yet</p> : by(c.id).map((a) => (
                  <AppCard key={a.id} a={a} onOpen={() => openJob(a.jobId)} onMove={(s) => void move(a, s)} onDetails={() => { setDetail(a); setNote(""); }} />
                ))}
              </section>
            ))}
          </div>
        </>
      )}

      <Modal open={Boolean(interview)} onClose={() => setInterview(null)} title="When is the interview?"
        footer={<><Button variant="ghost" onClick={() => setInterview(null)}>Cancel</Button><Button disabled={!interview?.when} onClick={() => { const i = interview!; setInterview(null); void move(i.a, "interview", new Date(i.when).toISOString()); }}>Save</Button></>}>
        <input type="datetime-local" value={interview?.when || ""} onChange={(e) => interview && setInterview({ ...interview, when: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3" />
        <p className="mt-2 text-xs text-slate-500">I'll remind you and help you prepare.</p>
      </Modal>

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail ? `${detail.role} · ${detail.company}` : ""}>
        {detail && (
          <div className="space-y-5 text-sm">
            <div>
              <h3 className="mb-2 font-semibold">Notes</h3>
              {detail.notes ? <p className="whitespace-pre-line rounded-xl bg-slate-50 p-3 text-slate-700">{detail.notes}</p> : <p className="text-slate-500">No notes yet.</p>}
              <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void addNote(); }}>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Spoke to HR, second round next week" className="h-10 flex-1 rounded-xl border border-slate-200 px-3" />
                <Button type="submit" variant="secondary" disabled={!note.trim()}>Add</Button>
              </form>
            </div>
            <div>
              <h3 className="mb-2 font-semibold">Timeline</h3>
              <ol className="relative space-y-3 border-l border-slate-200 pl-4">
                {[...detail.history].reverse().map((h, i) => (
                  <li key={i} className="relative"><span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-white" />
                    <p className="font-medium text-ink">{titleCase(h.status)}{h.note ? <span className="font-normal text-slate-600"> — {h.note}</span> : null}</p>
                    <p className="text-xs text-slate-500">{new Date(h.at).toLocaleString("en-IN")} · {h.actor === "user" ? "you" : h.actor}</p></li>
                ))}
              </ol>
            </div>
            <Button variant="secondary" onClick={() => { setDetail(null); openJob(detail.jobId); }}>Open the job</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
