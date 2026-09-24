import { ArrowLeft, Check, Mic, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "../App";
import { track } from "../lib/analytics";
import { api, errMsg } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { speechSupported, useDictation } from "../lib/speech";
import { Button, Card, ErrorNote, cn } from "../ui";

interface Prompt { step: "about" | "skills" | "education" | "work"; text: string; hint: string; choices: string[] }
interface Turn { q: string; a: string; changed: string[] }

/** No resume? Build the profile from four short answers, typed or spoken, in English or Hindi. */
export default function InterviewFlow({ onDone, onBack }: { onDone: () => Promise<void>; onBack: () => void }) {
  const { lang, setLang, t } = useI18n();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [asked, setAsked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const dictation = useDictation(setText);

  useEffect(() => {
    void api<{ next: Prompt | null }>(`/career/interview?lang=${lang}`).then((r) => setPrompt(r.next)).catch((e) => setError(errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns, prompt]);

  async function send(choice?: string) {
    if (!prompt || busy) return;
    const answer = choice || text.trim();
    if (!answer) return;
    if (dictation.listening) dictation.stop();
    setBusy(true); setError(null);
    try {
      const r = await api<{ changed: string[]; next: Prompt | null }>("/career/interview", { body: { step: prompt.step, text: choice ? undefined : answer, choices: choice ? [choice] : undefined, lang, asked } });
      setTurns((ts) => [...ts, { q: prompt.text, a: answer, changed: r.changed }]);
      setAsked((a) => [...a, prompt.step]);
      setText("");
      track("onboarding_answer", { step: prompt.step, voice: dictation.listening });
      if (r.next) setPrompt(r.next);
      else { setPrompt(null); track("resume_uploaded", { method: "conversation", where: "onboarding" }); await onDone(); }
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  const stepNo = Math.min(4, turns.length + 1);
  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <button onClick={onBack} aria-label="Back" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /></button>
        <p className="flex-1 font-display font-semibold text-ink">{t("iv.title")}</p>
        <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold" role="group" aria-label="Language">
          {(["en", "hi"] as const).map((l) => <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l} className={cn("rounded-md px-2.5 py-1", lang === l ? "bg-white text-brand-700 shadow-sm" : "text-slate-500")}>{l === "en" ? "EN" : "हिं"}</button>)}
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100"><div className="bg-peacock h-full rounded-full transition-all" style={{ width: `${((prompt ? stepNo - 1 : 4) / 4) * 100}%` }} /></div>

      <div className="max-h-[46vh] space-y-4 overflow-y-auto pr-1">
        {turns.map((tn, i) => (
          <div key={i} className="space-y-2">
            <div className="flex gap-2"><Logo className="h-6 w-6 shrink-0" /><p className="text-sm text-slate-700">{tn.q}</p></div>
            <div className="flex justify-end"><p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-50 px-3.5 py-2 text-sm text-ink ring-1 ring-brand-100">{tn.a}</p></div>
            {tn.changed.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pl-8">
                <span className="text-xs font-medium text-emerald-700">{t("iv.understood")}:</span>
                {tn.changed.map((c) => <span key={c} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs text-emerald-800 ring-1 ring-emerald-100"><Check className="h-3 w-3" />{c}</span>)}
              </div>
            )}
          </div>
        ))}
        {prompt && (
          <div className="flex gap-2 animate-slide-up" key={prompt.step}>
            <Logo className="h-6 w-6 shrink-0" />
            <div><p className="font-medium text-ink">{prompt.text}</p><p className="mt-0.5 text-xs text-slate-500">{prompt.hint}</p></div>
          </div>
        )}
        {!prompt && turns.length > 0 && <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700"><Sparkles className="h-4 w-4" />{t("iv.done")}</p>}
        <div ref={end} />
      </div>

      {prompt && (
        <>
          {prompt.choices.length > 0 && (
            <div className="flex flex-wrap gap-2">{prompt.choices.map((c) => <button key={c} disabled={busy} onClick={() => void send(c)} className="h-9 rounded-full border border-slate-200 bg-white px-3.5 text-sm transition hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50">{c}</button>)}</div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="space-y-2">
            <div className={cn("rounded-2xl border bg-white transition focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-100", dictation.listening ? "border-red-300" : "border-slate-200")}>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} aria-label={t("common.typeAnswer")} placeholder={dictation.listening ? "…" : t("common.typeAnswer")}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                className="block w-full resize-none bg-transparent px-3.5 pt-3 text-sm outline-none" />
              <div className="flex items-center justify-between px-2 pb-2">
                {speechSupported ? (
                  <button type="button" onClick={() => (dictation.listening ? dictation.stop() : dictation.start(lang === "hi" ? "hi-IN" : "en-IN"))}
                    className={cn("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium", dictation.listening ? "animate-pulse bg-red-50 text-red-600" : "text-brand-700 hover:bg-brand-50")}>
                    <Mic className="h-4 w-4" />{t("common.speak")}
                  </button>
                ) : <span />}
                <Button type="submit" size="sm" loading={busy} disabled={!text.trim()}>{t("common.send")}</Button>
              </div>
            </div>
            {dictation.error && <p className="text-xs text-red-600">{dictation.error}</p>}
          </form>
        </>
      )}
      <ErrorNote error={error} />
    </Card>
  );
}
