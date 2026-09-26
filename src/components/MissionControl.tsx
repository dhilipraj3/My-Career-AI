import { Bell, Briefcase, CalendarClock, CheckCircle2, ChevronRight, FileEdit, KeyRound, MessageSquare, PartyPopper, Sparkles, Target, UserCheck } from "lucide-react";
import { useState, type ComponentType } from "react";
import type { ActivityItem, Journey, NextAction, Placement, WeeklyPlan } from "@shared/career";
import { api, errMsg } from "../lib/api";
import { useNav, type Page } from "../lib/nav";
import { Badge, Button, Card, ErrorNote, Modal, Progress, Section, cn, timeAgo } from "../ui";

export interface CompanionData { journey: Journey | null; plan: WeeklyPlan; activity: ActivityItem[] }

const ICONS: Record<NextAction["kind"], ComponentType<{ className?: string }>> = {
  interview: CalendarClock, offer: PartyPopper, follow_up: Bell, finish_application: FileEdit, new_matches: Sparkles, question: UserCheck, outcome: Target,
  resume: FileEdit, skill: Target, plan: Target, ai_key: KeyRound, apply: Briefcase,
};
const TONE: Partial<Record<NextAction["kind"], string>> = { interview: "bg-emerald-50 text-emerald-600", offer: "bg-emerald-50 text-emerald-600", follow_up: "bg-amber-50 text-amber-600" };

export function NextActions({ actions }: { actions: NextAction[] }) {
  const nav = useNav();
  const run = (a: NextAction) => {
    if (a.cta.chat) return nav.openChat(a.cta.chat);
    if (a.cta.jobId) return nav.openJob(a.cta.jobId);
    if (a.cta.page) return nav.go(a.cta.page as Page);
  };
  return (
    <Section title="What to do today">
      <Card className="divide-y divide-slate-100 p-0">
        {actions.length === 0 && <p className="p-5 text-sm text-slate-500">You're all caught up. 🎉</p>}
        {actions.slice(0, 5).map((a) => {
          const Icon = ICONS[a.kind] || Sparkles;
          return (
            <button key={a.id} onClick={() => run(a)} className="flex w-full items-start gap-3 p-4 text-left transition hover:bg-slate-50">
              <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", TONE[a.kind] || "bg-brand-50 text-brand-600")}><Icon className="h-[18px] w-[18px]" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{a.title}</span><span className="mt-0.5 block text-xs text-slate-500">{a.detail}</span></span>
              <span className="mt-1.5 flex shrink-0 items-center gap-0.5 text-xs font-medium text-brand-700">{a.cta.label}<ChevronRight className="h-4 w-4 text-slate-300" /></span>
            </button>
          );
        })}
      </Card>
    </Section>
  );
}

export function WeeklyPlanCard({ plan, onChange }: { plan: WeeklyPlan; onChange: (p: WeeklyPlan) => void }) {
  const total = plan.goals.reduce((n, g) => n + Math.min(g.target, g.done), 0);
  const max = plan.goals.reduce((n, g) => n + g.target, 0);
  async function tick(goal: string, done: number) {
    try { onChange((await api<{ plan: WeeklyPlan }>("/companion/plan/tick", { body: { goal, done: Math.max(0, done) } })).plan); } catch { /* non-critical */ }
  }
  return (
    <Section title="This week's plan" action={<Badge tone={total >= max ? "green" : "slate"}>{total}/{max}</Badge>}>
      <Card className="space-y-3 p-4">
        <Progress value={(total / Math.max(1, max)) * 100} tone={total >= max ? "green" : "brand"} />
        <ul className="space-y-3">
          {plan.goals.map((g) => {
            const done = g.done >= g.target;
            return (
              <li key={g.id} className="flex items-start gap-3">
                <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300")}>{done && <CheckCircle2 className="h-4 w-4" />}</span>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium", done ? "text-slate-400 line-through" : "text-ink")}>{g.title}</p>
                  <p className="text-xs text-slate-500">{g.detail}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
                  {g.auto ? <span>{g.done}/{g.target}</span> : (
                    <><button aria-label="Less" className="h-6 w-6 rounded border border-slate-200 hover:bg-slate-50" onClick={() => void tick(g.id, g.done - 1)}>−</button><span className="w-8 text-center">{g.done}/{g.target}</span><button aria-label="More" className="h-6 w-6 rounded border border-slate-200 hover:bg-slate-50" onClick={() => void tick(g.id, g.done + 1)}>+</button></>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </Section>
  );
}

export function PulseCard({ journey }: { journey: Journey }) {
  const p = journey.pulse;
  const cell = (label: string, value: number | string) => <div><p className="font-display text-xl font-bold text-ink">{value}</p><p className="text-[11px] text-slate-500">{label}</p></div>;
  return (
    <Section title="Your application pulse">
      <Card className="space-y-3 p-4">
        <div className="grid grid-cols-4 gap-2 text-center">{cell("Applied", p.applied)}{cell("Replies", p.responses)}{cell("Interviews", p.interviews)}{cell("Offers", p.offers)}</div>
        <p className="text-xs text-slate-500">{p.responseRate === null ? "Reply rate appears after your 5th application, so it isn't misleading." : `${p.responseRate}% of your applications got a reply.`}</p>
      </Card>
    </Section>
  );
}

export function ActivityCard({ activity }: { activity: ActivityItem[] }) {
  if (!activity.length) return null;
  return (
    <Section title="What's been happening">
      <Card className="p-4">
        <ul className="space-y-2.5">
          {activity.slice(0, 6).map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", a.who === "you" ? "bg-brand-500" : a.who === "assistant" ? "bg-accent-500" : "bg-slate-300")} />
              <span className="flex-1 text-slate-700">{a.text}</span>
              <span className="shrink-0 text-xs text-slate-400">{timeAgo(a.at)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Section>
  );
}

export function PlacedBanner({ placement, onUndo }: { placement: Placement; onUndo: () => void }) {
  const nav = useNav();
  return (
    <Card className="flex flex-wrap items-center gap-4 border-emerald-200 bg-gradient-to-br from-emerald-50 to-brand-50 p-5">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-white"><PartyPopper className="h-6 w-6" /></span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-lg font-bold text-ink">Congratulations, you're placed! 🎉</p>
        <p className="text-sm text-slate-600">{placement.role} at {placement.company}{placement.joiningDate ? ` · joining ${placement.joiningDate}` : ""}. I've paused job alerts. I'm here for your first 90 days and your next step.</p>
      </div>
      <Button variant="secondary" size="sm" onClick={() => nav.openChat("I just got placed. Help me prepare for my first 90 days.")}><MessageSquare className="h-4 w-4" />First 90 days</Button>
      <button className="text-xs text-slate-500 underline" onClick={onUndo}>Not placed yet? Resume my search</button>
    </Card>
  );
}

export function PlacedModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ company: "", role: "", joiningDate: "", salaryLPA: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try {
      await api("/companion/placed", { body: { company: f.company, role: f.role, ...(f.joiningDate ? { joiningDate: f.joiningDate } : {}), ...(f.salaryLPA ? { salaryLPA: Number(f.salaryLPA) } : {}) } });
      onDone();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";
  return (
    <Modal open={open} onClose={onClose} title="I got placed 🎉" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.company.trim() || !f.role.trim()} onClick={() => void submit()}>Confirm</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Congratulations! Tell me a little so I can celebrate properly. I'll pause job alerts, and you can resume any time.</p>
        <label className="block text-sm font-medium">Company<input className={input} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></label>
        <label className="block text-sm font-medium">Role<input className={input} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">Joining date <span className="font-normal text-slate-400">(optional)</span><input type="date" className={input} value={f.joiningDate} onChange={(e) => setF({ ...f, joiningDate: e.target.value })} /></label>
          <label className="block text-sm font-medium">Salary, LPA <span className="font-normal text-slate-400">(optional)</span><input inputMode="decimal" className={input} value={f.salaryLPA} onChange={(e) => setF({ ...f, salaryLPA: e.target.value.replace(/[^\d.]/g, "") })} /></label>
        </div>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
