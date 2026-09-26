import { Check, ChevronDown, Info, Mic, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Understanding } from "@shared/career";
import { api, errMsg } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { speechSupported, useDictation } from "../lib/speech";
import { Button, Card, ErrorNote, Skeleton, cn, useToast } from "../ui";

/** A peacock-gradient ring for the understanding score. */
export function UnderstandingRing({ score, size = 72 }: { score: number; size?: number }) {
  const stroke = size / 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Understanding ${score}%`} className="shrink-0">
      <defs><linearGradient id="ur-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0a7399" /><stop offset="1" stopColor="#07a384" /></linearGradient></defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: "var(--color-slate-100)" }} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#ur-grad)" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)" }} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-ink font-display font-bold" fontSize={size / 4}>{score}%</text>
    </svg>
  );
}

export default function UnderstandingCard({ onChanged, className }: { onChanged?: () => void; className?: string }) {
  const { lang, t } = useI18n();
  const toast = useToast();
  const [u, setU] = useState<Understanding | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const dictation = useDictation(setText);

  const load = useCallback(async () => {
    try { setU(await api<Understanding>(`/career/understanding?lang=${lang}`)); } catch (e) { setError(errMsg(e)); }
  }, [lang]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPicked([]); setText(""); setError(null); }, [u?.next?.id]);

  async function submit(choices: string[] = picked) {
    if (!u?.next || busy) return;
    if (!choices.length && !text.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ changed: string[]; understanding: Understanding }>("/career/understanding/answer", { body: { questionId: u.next.id, choices, text: text.trim() || undefined, lang } });
      setU(r.understanding);
      if (r.changed.length) toast("success", `${t("common.gotIt")}: ${r.changed.join(" · ")}`);
      onChanged?.();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  async function resolve(kind: "skill" | "role", key: string, confirm: boolean) {
    try {
      const r = await api<{ understanding: Understanding }>("/career/guess", { body: { kind, key, confirm } });
      setU(r.understanding);
      onChanged?.();
    } catch (e) { toast("error", errMsg(e)); }
  }

  if (!u) return <Card className={cn("space-y-3", className)}>{error ? <ErrorNote error={error} /> : <><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></>}</Card>;
  const q = u.next;
  const toggle = (v: string) => setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));

  return (
    <Card className={cn("space-y-4 overflow-hidden", className)}>
      <div className="flex items-center gap-3">
        <UnderstandingRing score={u.score} size={56} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-brand-700">{t("u.score")}</p>
          <h3 className="font-display text-base font-bold leading-snug text-ink sm:text-lg">{t("u.title")}</h3>
        </div>
      </div>
      <div className="space-y-1.5 text-sm leading-relaxed text-slate-700">
        {(u.summary || "…").split(/(?<=\.)\s+(?=[A-Z])/).map((line, i) => <p key={i}>{line}</p>)}
      </div>
      {u.areas.some((a) => a.gaps.length) && (
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="mb-1.5 text-xs font-semibold text-slate-600">What I don't know yet</p>
          <ul className="flex flex-wrap gap-1.5">
            {u.areas.flatMap((a) => a.gaps).slice(0, 8).map((g) => <li key={g} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{g}</li>)}
          </ul>
        </div>
      )}
      <p className={cn("flex items-start gap-1.5 text-xs font-medium", u.ready ? "text-emerald-700" : "text-amber-700")}>
        {u.ready ? <Check className="mt-px h-3.5 w-3.5 shrink-0" /> : <Sparkles className="mt-px h-3.5 w-3.5 shrink-0" />}{u.ready ? t("u.ready") : t("u.notReady")}
      </p>

      {u.guesses.length > 0 && (
        <div className="rounded-xl bg-amber-50/70 p-3 ring-1 ring-amber-100">
          <p className="mb-2 text-xs font-semibold text-amber-800">{t("u.guesses")}</p>
          <div className="flex flex-wrap gap-1.5">
            {u.guesses.map((g) => (
              <span key={`${g.kind}-${g.key}`} className="inline-flex items-center gap-1 rounded-full bg-white py-1 pl-3 pr-1 text-sm ring-1 ring-amber-200">
                {g.kind === "role" ? "🎯 " : ""}{g.label}
                <button aria-label={`Yes, ${g.label}`} title={t("common.yes")} onClick={() => void resolve(g.kind, g.key, true)} className="rounded-full p-1 text-emerald-600 hover:bg-emerald-50"><Check className="h-3.5 w-3.5" /></button>
                <button aria-label={`No, not ${g.label}`} title={t("common.no")} onClick={() => void resolve(g.kind, g.key, false)} className="rounded-full p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
              </span>
            ))}
          </div>
        </div>
      )}

      {q ? (
        <div key={q.id} className="space-y-3 rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50/80 to-accent-50/60 p-4 animate-slide-up">
          <p className="text-xs font-semibold text-brand-700">{t("u.nextQuestion")}</p>
          <p className="font-display text-base font-semibold text-ink">{q.text}</p>
          <p className="flex items-start gap-1.5 text-xs text-slate-500"><Info className="mt-px h-3.5 w-3.5 shrink-0" />{q.why}</p>
          {q.choices.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {q.choices.map((c) => {
                const on = picked.includes(c.value);
                return (
                  <button key={c.value} disabled={busy} aria-pressed={q.multi ? on : undefined}
                    onClick={() => (q.multi ? toggle(c.value) : void submit([c.value]))}
                    className={cn("h-9 rounded-full border px-3.5 text-sm transition disabled:opacity-50", on ? "border-brand-500 bg-brand-600 text-white" : "border-slate-200 bg-white hover:border-brand-400 hover:bg-brand-50")}>
                    {on && <Check className="-ml-0.5 mr-1 inline h-3.5 w-3.5" />}{c.label}
                  </button>
                );
              })}
            </div>
          )}
          {(q.allowText || q.multi) && (
            <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="flex gap-2">
              {q.allowText && (
                <div className="flex flex-1 items-center rounded-xl border border-slate-200 bg-white focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-100">
                  <input value={text} onChange={(e) => setText(e.target.value)} placeholder={dictation.listening ? "…" : q.placeholder || t("common.typeAnswer")} aria-label={t("common.typeAnswer")}
                    className="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" />
                  {speechSupported && (
                    <button type="button" onClick={() => (dictation.listening ? dictation.stop() : dictation.start(lang === "hi" ? "hi-IN" : "en-IN"))} aria-label={t("common.speak")} title={t("common.speak")}
                      className={cn("mr-1 rounded-lg p-2", dictation.listening ? "animate-pulse bg-red-50 text-red-600" : "text-slate-400 hover:text-brand-600")}><Mic className="h-4 w-4" /></button>
                  )}
                </div>
              )}
              <Button type="submit" loading={busy} disabled={!picked.length && !text.trim()} className={cn(!q.allowText && "w-full")}>{t("common.send")}</Button>
            </form>
          )}
          <ErrorNote error={error} />
        </div>
      ) : <p className="flex items-center gap-1.5 text-sm text-emerald-700"><Check className="h-4 w-4" />{t("u.allDone")}</p>}

      <button onClick={() => setDetails(!details)} className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-700" aria-expanded={details}>
        {details ? t("u.hideDetails") : t("u.details")}<ChevronDown className={cn("h-3.5 w-3.5 transition", details && "rotate-180")} />
      </button>
      {details && (
        <ul className="grid gap-3 sm:grid-cols-2 animate-fade-in">
          {u.areas.map((a) => (
            <li key={a.id} className="space-y-1">
              <div className="flex justify-between text-xs"><span className="font-semibold text-ink">{a.label}</span><span className="tabular-nums text-slate-500">{a.score}%</span></div>
              <div className="h-1.5 rounded-full bg-slate-100"><div className="bg-peacock h-full rounded-full transition-all" style={{ width: `${a.score}%` }} /></div>
              {a.evidence.map((e) => <p key={e} className="text-xs text-slate-600">✓ {e}</p>)}
              {a.gaps.map((g) => <p key={g} className="text-xs text-amber-700">• {g}</p>)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
