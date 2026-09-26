import { CheckCircle2, ListChecks, Mic, MicOff, Play, Plus, RefreshCw, Trash2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApplicationRecord } from "@shared/types";
import type { AnswerFeedback, InterviewPrep, MockSession, OfferComparison, OfferInput, PrepQuestion, SalaryBenchmark } from "@shared/interview";
import { api, errMsg } from "../lib/api";
import { canSpeak, speak, stopSpeaking, useI18n } from "../lib/i18n";
import { useNav } from "../lib/nav";
import { speechSupported, useDictation } from "../lib/speech";
import { Badge, Button, Card, Empty, ErrorNote, PageHeader, Progress, ScoreRing, Section, Spinner, Tabs, cn, timeAgo } from "../ui";

type Tab = "prep" | "mock" | "offers";
const KIND_LABEL: Record<PrepQuestion["kind"], string> = { technical: "Technical", behavioural: "Behavioural", role: "About the role", gap: "Skill gap" };
const KIND_TONE: Record<PrepQuestion["kind"], "brand" | "amber" | "slate" | "sky"> = { technical: "brand", behavioural: "sky", role: "slate", gap: "amber" };
const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";

// ---------------------------------------------------------------- prep
function PrepView({ jobId, onPractise }: { jobId: string; onPractise: () => void }) {
  const [prep, setPrep] = useState<InterviewPrep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPrep(null); setError(null); api<{ prep: InterviewPrep }>(`/interview/prep/${jobId}`).then((r) => setPrep(r.prep)).catch((e) => setError(errMsg(e))); }, [jobId]);
  if (error) return <ErrorNote error={error} />;
  if (!prep) return <Spinner label="Preparing your questions…" />;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-semibold">{prep.role} · {prep.company}</h2>
        <Badge tone={prep.generatedBy === "ai" ? "brand" : "slate"}>{prep.generatedBy === "ai" ? "AI-tailored questions" : "Standard questions"}</Badge>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" loading={busy} onClick={async () => { setBusy(true); try { setPrep((await api<{ prep: InterviewPrep }>(`/interview/prep/${jobId}/regenerate`, { body: {} })).prep); } finally { setBusy(false); } }}><RefreshCw className="h-4 w-4" />Refresh</Button>
          <Button onClick={onPractise}><Play className="h-4 w-4" />Practise these</Button>
        </div>
      </div>

      <Section title="Likely questions">
        <div className="space-y-3">
          {prep.questions.map((q) => (
            <Card key={q.id} className="space-y-1.5 p-4">
              <div className="flex items-start gap-2"><Badge tone={KIND_TONE[q.kind]}>{KIND_LABEL[q.kind]}</Badge><p className="text-sm font-semibold text-ink">{q.question}</p></div>
              <p className="text-sm text-slate-600">{q.tip}</p>
            </Card>
          ))}
        </div>
      </Section>

      {prep.stories.length > 0 && (
        <Section title="Your stories (STAR)">
          <p className="mb-2 text-sm text-slate-500">Built from things on your own resume. Fill in the parts only you know; keep numbers true.</p>
          <div className="grid gap-3 md:grid-cols-2">
            {prep.stories.map((s) => (
              <Card key={s.id} className="space-y-2 p-4">
                <div><Badge>{s.skill}</Badge> <span className="text-xs text-slate-500">{s.source}</span></div>
                <p className="text-sm font-medium text-ink">“{s.fact}”</p>
                <dl className="space-y-1 text-xs text-slate-600">{(["situation", "task", "action", "result"] as const).map((k) => <div key={k}><dt className="inline font-semibold capitalize text-slate-700">{k}: </dt><dd className="inline">{s.prompts[k]}</dd></div>)}</dl>
              </Card>
            ))}
          </div>
        </Section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Questions to ask them"><Card className="p-4"><ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">{prep.askEmployer.map((x) => <li key={x}>{x}</li>)}</ul></Card></Section>
        <Section title="Day-before checklist"><Card className="p-4"><ul className="space-y-2 text-sm text-slate-700">{prep.checklist.map((x) => <li key={x} className="flex gap-2"><ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{x}</li>)}</ul></Card></Section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- mock interview
function FeedbackCard({ fb }: { fb: AnswerFeedback }) {
  return (
    <Card className="space-y-3 border-brand-200 bg-brand-50/40 p-4">
      <div className="flex items-center gap-3"><ScoreRing score={fb.score} size={52} /><div><p className="text-sm font-semibold text-ink">Score {fb.score}/100</p><p className="text-xs text-slate-500">{fb.by === "ai" ? "Rules plus AI coaching" : "Scored on structure, evidence, clarity, length and relevance"}</p></div></div>
      {fb.strengths.length > 0 && <div><p className="text-xs font-semibold text-emerald-700">What worked</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">{fb.strengths.map((s) => <li key={s}>{s}</li>)}</ul></div>}
      {fb.improvements.length > 0 && <div><p className="text-xs font-semibold text-amber-700">To improve</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">{fb.improvements.map((s) => <li key={s}>{s}</li>)}</ul></div>}
      {fb.flags.length > 0 && <div className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900"><p className="font-semibold">Be ready to explain</p><ul className="list-disc pl-5">{fb.flags.map((s) => <li key={s}>{s}</li>)}</ul></div>}
    </Card>
  );
}

function MockRunner({ session: initial, onDone }: { session: MockSession; onDone: () => void }) {
  const { lang } = useI18n();
  const [session, setSession] = useState(initial);
  const [text, setText] = useState("");
  const [fb, setFb] = useState<AnswerFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = useRef("");
  const dict = useDictation((t) => setText(`${base.current}${base.current && t ? " " : ""}${t}`));
  const idx = session.answers.length;
  const q = session.questions[Math.min(idx, session.questions.length - 1)];
  const finished = session.status === "done";
  const showing = fb ? session.questions[idx - 1] : q;

  async function submit() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ session: MockSession; feedback: AnswerFeedback }>(`/interview/mock/${session.id}/answer`, { body: { text } });
      setSession(r.session); setFb(r.feedback); setText(""); base.current = "";
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (finished && !fb) {
    return (
      <Card className="space-y-4 p-6 text-center">
        <ScoreRing score={session.score || 0} size={84} showLabel />
        <h2 className="font-display text-xl font-bold">Practice complete: {session.score}/100</h2>
        <ul className="mx-auto max-w-lg space-y-2 text-left text-sm">{session.answers.map((a, i) => <li key={a.questionId} className="flex items-start gap-2"><span className="w-10 shrink-0 font-semibold text-brand-700">{a.feedback.score}</span><span className="text-slate-700">{session.questions[i].question}</span></li>)}</ul>
        <Button onClick={onDone}>Back to practice</Button>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3"><Progress value={(idx / session.questions.length) * 100} className="flex-1" /><span className="text-xs text-slate-500">{Math.min(idx + (fb ? 0 : 1), session.questions.length)} / {session.questions.length}</span></div>
      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-2"><Badge tone={KIND_TONE[showing.kind]}>{KIND_LABEL[showing.kind]}</Badge>{canSpeak && <button aria-label="Read the question aloud" className="text-slate-400 hover:text-brand-600" onClick={() => speak(showing.question)}><Volume2 className="h-4 w-4" /></button>}</div>
        <p className="font-display text-lg font-semibold text-ink">{showing.question}</p>
        {!fb && <details className="text-sm text-slate-500"><summary className="cursor-pointer">Need a hint?</summary><p className="mt-1">{showing.tip}</p></details>}
      </Card>
      {fb ? (
        <>
          <FeedbackCard fb={fb} />
          <div className="flex justify-end"><Button onClick={() => { setFb(null); stopSpeaking(); }}>{session.status === "done" ? "See results" : "Next question"}</Button></div>
        </>
      ) : (
        <>
          <textarea value={text} onChange={(e) => { setText(e.target.value); base.current = e.target.value; }} rows={7} className={input} placeholder="Type your answer, or use the microphone and speak it. Aim for about a minute." aria-label="Your answer" />
          <ErrorNote error={error || dict.error} />
          <div className="flex items-center gap-2">
            {speechSupported && <Button variant="secondary" onClick={() => { if (dict.listening) dict.stop(); else { base.current = text; dict.start(lang === "hi" ? "hi-IN" : "en-IN"); } }}>{dict.listening ? <><MicOff className="h-4 w-4" />Stop</> : <><Mic className="h-4 w-4" />Speak</>}</Button>}
            <span className="text-xs text-slate-400">{(text.trim().match(/\S+/g) || []).length} words</span>
            <Button className="ml-auto" loading={busy} disabled={!text.trim()} onClick={() => void submit()}>Get feedback</Button>
          </div>
        </>
      )}
    </div>
  );
}

function MockView({ jobId, apps }: { jobId: string | null; apps: ApplicationRecord[] }) {
  const [history, setHistory] = useState<Array<Omit<MockSession, "answers" | "questions"> & { answered: number; total: number }> | null>(null);
  const [session, setSession] = useState<MockSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<{ sessions: any[] }>("/interview/mocks").then((r) => setHistory(r.sessions)).catch(() => setHistory([])); }, []);
  useEffect(load, [load]);
  async function start(job?: string | null) {
    setBusy(true); setError(null);
    try { setSession((await api<{ session: MockSession }>("/interview/mock", { body: job ? { jobId: job } : {} })).session); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  const startedFromLink = useRef(false);
  useEffect(() => { if (jobId && !startedFromLink.current && new URLSearchParams(location.hash.split("?")[1] || "").get("start") === "1") { startedFromLink.current = true; void start(jobId); } }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (session) return <MockRunner session={session} onDone={() => { setSession(null); load(); }} />;
  const trend = (history || []).filter((h) => h.status === "done" && h.score !== undefined).slice(0, 6).reverse();
  return (
    <div className="space-y-5">
      <ErrorNote error={error} />
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white"><Mic className="h-6 w-6" /></span>
        <div className="min-w-0 flex-1"><p className="font-display font-semibold text-ink">Practise out loud</p><p className="text-sm text-slate-600">One question at a time, feedback on structure, evidence, clarity and length. Speak or type.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={busy} onClick={() => void start(null)}>General practice</Button>
          {jobId && <Button loading={busy} onClick={() => void start(jobId)}>For {apps.find((a) => a.jobId === jobId)?.company || "this job"}</Button>}
        </div>
      </Card>
      {trend.length > 1 && (
        <Section title="Your progress">
          <Card className="flex items-end gap-2 p-4">{trend.map((s) => <div key={s.id} className="flex flex-1 flex-col items-center gap-1"><div className="w-full rounded-t bg-brand-500" style={{ height: `${Math.max(6, (s.score || 0) * 0.9)}px` }} /><span className="text-[11px] tabular-nums text-slate-500">{s.score}</span></div>)}</Card>
        </Section>
      )}
      <Section title="Past sessions">
        {history === null ? <Spinner /> : history.length === 0 ? <Empty title="No practice yet" hint="Your first session takes about five minutes." /> : (
          <Card className="divide-y divide-slate-100 p-0">{history.map((h) => <div key={h.id} className="flex items-center gap-3 p-3 text-sm"><span className="w-10 font-semibold text-brand-700">{h.status === "done" ? h.score : "–"}</span><span className="min-w-0 flex-1 truncate">{h.role}{h.company ? ` · ${h.company}` : ""}</span><span className="text-xs text-slate-400">{h.answered}/{h.total} · {timeAgo(h.createdAt)}</span></div>)}</Card>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- offers & salary
type OfferRow = { company: string; role: string; fixedLPA: string; variableLPA: string; joiningBonusLakh: string; commuteMinutes: string; wfhDaysPerWeek: string; growth: string };
const blank = (): OfferRow => ({ company: "", role: "", fixedLPA: "", variableLPA: "", joiningBonusLakh: "", commuteMinutes: "", wfhDaysPerWeek: "", growth: "" });
const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? undefined : Number(s));
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function OffersView() {
  const [rows, setRows] = useState<OfferRow[]>([blank(), blank()]);
  const [cmp, setCmp] = useState<OfferComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState(""); const [city, setCity] = useState("");
  const [bench, setBench] = useState<{ b: SalaryBenchmark | null } | null>(null);
  const set = (i: number, k: keyof OfferRow, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const valid = useMemo(() => rows.filter((r) => r.company.trim() && num(r.fixedLPA)), [rows]);

  async function compare() {
    setError(null);
    const offers: OfferInput[] = valid.map((r) => ({ company: r.company.trim(), role: r.role.trim(), fixedLPA: num(r.fixedLPA)!, variableLPA: num(r.variableLPA), joiningBonusLakh: num(r.joiningBonusLakh), commuteMinutes: num(r.commuteMinutes), wfhDaysPerWeek: num(r.wfhDaysPerWeek), growth: num(r.growth) }));
    try { setCmp(await api<OfferComparison>("/offers/compare", { body: { offers } })); } catch (e) { setError(errMsg(e)); }
  }
  async function check() {
    try { setBench({ b: (await api<{ benchmark: SalaryBenchmark | null }>(`/insights/salary?role=${encodeURIComponent(role)}${city ? `&city=${encodeURIComponent(city)}` : ""}`)).benchmark }); } catch (e) { setError(errMsg(e)); }
  }

  return (
    <div className="space-y-8">
      <Section title="Compare offers">
        <div className="space-y-3">
          {rows.map((r, i) => (
            <Card key={i} className="space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Company<input className={input} value={r.company} onChange={(e) => set(i, "company", e.target.value)} /></label><label className="text-sm font-medium">Role<input className={input} value={r.role} onChange={(e) => set(i, "role", e.target.value)} /></label></div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                {([["fixedLPA", "Fixed (LPA)"], ["variableLPA", "Variable (LPA)"], ["joiningBonusLakh", "Joining bonus (₹ lakh)"], ["commuteMinutes", "Commute (min)"], ["wfhDaysPerWeek", "WFH days/week"], ["growth", "Growth (1–5)"]] as const).map(([k, label]) => (
                  <label key={k} className="text-xs font-medium text-slate-600">{label}<input inputMode="decimal" className={input} value={r[k]} onChange={(e) => set(i, k, e.target.value.replace(/[^\d.]/g, ""))} /></label>
                ))}
              </div>
              {rows.length > 1 && <button aria-label="Remove offer" className="text-xs text-slate-400 hover:text-red-600" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="inline h-3.5 w-3.5" /> Remove</button>}
            </Card>
          ))}
          <div className="flex gap-2">{rows.length < 4 && <Button variant="ghost" onClick={() => setRows([...rows, blank()])}><Plus className="h-4 w-4" />Add offer</Button>}<Button className="ml-auto" disabled={valid.length === 0} onClick={() => void compare()}>Compare</Button></div>
          <ErrorNote error={error} />
        </div>
        {cmp && (
          <div className="mt-4 space-y-3">
            <div className="overflow-x-auto"><Card className="p-0"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-b border-slate-100 text-left text-xs text-slate-500"><th className="p-3">Company</th><th className="p-3">Monthly in-hand*</th><th className="p-3">First-year total</th><th className="p-3">Commute</th><th className="p-3">WFH</th><th className="p-3">Growth</th></tr></thead>
              <tbody>{cmp.offers.map((o) => <tr key={o.company} className="border-b border-slate-50 last:border-0"><td className="p-3 font-medium">{o.company}<span className="block text-xs font-normal text-slate-500">{o.role}</span></td><td className="p-3 tabular-nums">{inr(o.monthlyInHand)}</td><td className="p-3 tabular-nums">₹{o.totalFirstYearLPA} LPA</td><td className="p-3">{o.commuteMinutes ?? "–"}{o.commuteMinutes !== undefined && " min"}</td><td className="p-3">{o.wfhDaysPerWeek ?? "–"}</td><td className="p-3">{o.growth ? "★".repeat(o.growth) : "–"}</td></tr>)}</tbody></table></Card></div>
            <div className="flex flex-wrap gap-2">{cmp.highlights.map((h) => <Badge key={h.label} tone="green"><CheckCircle2 className="mr-1 h-3 w-3" />{h.label}: {h.company}</Badge>)}</div>
            <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">{cmp.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            <p className="text-xs text-slate-400">*Estimate from fixed pay: new tax regime, employee PF and professional tax. Your payslip will differ.</p>
          </div>
        )}
      </Section>

      <Section title="Is this salary fair?">
        <Card className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><label className="text-sm font-medium">Role<input className={input} value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Project Manager" /></label><label className="text-sm font-medium">City <span className="font-normal text-slate-400">(optional)</span><input className={input} value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Chennai" /></label><Button className="self-end" disabled={role.trim().length < 2} onClick={() => void check()}>Check</Button></div>
          {bench && (bench.b ? (
            <div className="rounded-xl bg-slate-50 p-4 text-sm"><p className="font-display text-lg font-bold text-ink">₹{bench.b.lowLPA} – ₹{bench.b.highLPA} LPA <span className="text-sm font-normal text-slate-500">(median ₹{bench.b.medianLPA} LPA)</span></p><p className="mt-1 text-xs text-slate-500">From {bench.b.samples} live postings that state a salary{bench.b.scope === "city" ? ` in ${bench.b.city}` : " across India"} ({bench.b.postings.toLocaleString("en-IN")} matching postings in total). Posted ranges are a guide, not what everyone is paid.</p></div>
          ) : <p className="text-sm text-slate-600">Not enough postings with a stated salary to give a reliable range. I'd rather show nothing than guess.</p>)}
        </Card>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- page
export default function Interview() {
  const nav = useNav();
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || (params.get("job") ? "prep" : "prep"));
  const [jobId, setJobId] = useState<string | null>(params.get("job"));
  const [apps, setApps] = useState<ApplicationRecord[] | null>(null);
  useEffect(() => { api<{ applications: ApplicationRecord[] }>("/applications").then((r) => setApps(r.applications)).catch(() => setApps([])); }, []);
  const withPrep = (apps || []).filter((a) => !["expired"].includes(a.status));
  useEffect(() => { if (!jobId && withPrep.length) setJobId(withPrep[0].jobId); }, [apps]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      <PageHeader title="Interview prep" subtitle="Know what they'll ask, practise your answers, and compare offers with clear eyes." />
      <Tabs value={tab} onChange={setTab} items={[{ id: "prep", label: "Prepare" }, { id: "mock", label: "Practise" }, { id: "offers", label: "Offers & pay" }]} />
      {tab !== "offers" && apps && withPrep.length > 0 && (
        <label className="block text-sm font-medium text-slate-700">For which job?
          <select className={cn(input, "mt-1 max-w-md")} value={jobId || ""} onChange={(e) => setJobId(e.target.value)}>{withPrep.map((a) => <option key={a.id} value={a.jobId}>{a.role} · {a.company}</option>)}</select>
        </label>
      )}
      {tab === "prep" && (jobId ? <PrepView jobId={jobId} onPractise={() => setTab("mock")} /> : apps ? <Empty title="Prepare for a specific job" hint="Prepare an application for a job you like and its questions will appear here." action={<Button onClick={() => nav.go("matches")}>See my matches</Button>} /> : <Spinner />)}
      {tab === "mock" && <MockView jobId={jobId} apps={apps || []} />}
      {tab === "offers" && <OffersView />}
    </div>
  );
}
