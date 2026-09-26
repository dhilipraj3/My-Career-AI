import {
  ArrowUp, Bookmark, BookmarkCheck, Briefcase, Check, ChevronDown, CircleAlert, Copy, KeyRound, Loader2, Maximize2, Mic, Minimize2,
  RotateCcw, Search, Sparkles, Square, SquarePen, Target, ThumbsDown, ThumbsUp, TrendingUp, Undo2, X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import type { ChatMessage, ChatStep, FeedSummary, PendingAction } from "@shared/types";
import type { AiState } from "../App";
import AshaAvatar from "./AshaAvatar";
import { GUIDE_NAME, useGuidePose, useGuideSpeaking } from "../lib/guide";
import { track } from "../lib/analytics";
import { api, clearApiCache, errMsg } from "../lib/api";
import { streamChat } from "../lib/assistantStream";
import type { Page } from "../lib/nav";
import { getGuidePose, guideSpeak, guideStopSpeaking, setGuidePose, speakable } from "../lib/guide";
import { speechSupported, useDictation } from "../lib/speech";
import { Button, CompanyMark, ScoreRing, cn, useToast } from "../ui";

/** A chat message as the panel shows it (adds live streaming state). */
type Msg = ChatMessage & { streaming?: boolean; failed?: string };

export interface AssistantContext { page: string; jobId?: string }

const STARTER_ICONS: ComponentType<{ className?: string }>[] = [Target, TrendingUp, Search, Briefcase];
const DEFAULT_STARTERS = ["What should I do next?", "Show my best job matches", "Find remote jobs for me", "How can I improve my resume?"];

function Steps({ steps, live }: { steps: ChatStep[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  const running = steps.find((s) => s.state === "running");
  const done = steps.filter((s) => s.state !== "running");
  return (
    <div className="mb-1.5 text-xs text-slate-500">
      {running && live ? (
        <p className="flex items-center gap-1.5 font-medium text-brand-700"><Loader2 className="h-3.5 w-3.5 animate-spin" /><span className="shimmer-text">{running.label}…</span></p>
      ) : (
        <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 rounded-md py-0.5 hover:text-slate-700" aria-expanded={open}>
          <Check className="h-3.5 w-3.5 text-emerald-500" />
          <span>{done.map((s) => s.label).join(" · ")}</span>
          {done.length > 1 && <ChevronDown className={cn("h-3.5 w-3.5 transition", open && "rotate-180")} />}
        </button>
      )}
      {open && (
        <ol className="ml-1.5 mt-1 space-y-1 border-l border-slate-200 pl-3">
          {done.map((s) => (
            <li key={s.id} className={cn("flex items-center gap-1.5", s.state === "error" && "text-red-600")}>
              {s.state === "error" ? <CircleAlert className="h-3 w-3" /> : <Check className="h-3 w-3 text-emerald-500" />}{s.label}{s.detail ? ` — ${s.detail}` : ""}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function JobCards({ cards, openJob }: { cards: NonNullable<ChatMessage["cards"]>; openJob: (id: string) => void }) {
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const toast = useToast();
  return (
    <div className="mt-2.5 space-y-1.5">
      {cards.map((c) => (
        <div key={c.jobId} className="group/card flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-2.5 transition hover:border-brand-300 hover:shadow-sm">
          <button onClick={() => { track("job_view", { from: "assistant" }); openJob(c.jobId); }} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
            <CompanyMark name={c.company} size={34} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{c.title}</span>
              <span className="block truncate text-xs text-slate-500">{c.company}{c.location ? ` · ${c.location}` : ""}</span>
            </span>
          </button>
          {c.score !== undefined && <ScoreRing score={c.score} size={36} />}
          <button aria-label={saved[c.jobId] ? "Saved" : "Save job"} title={saved[c.jobId] ? "Saved" : "Save for later"} disabled={saved[c.jobId]}
            onClick={async () => {
              try { await api(`/jobs/${encodeURIComponent(c.jobId)}/save`, { body: { saved: true } }); setSaved((s) => ({ ...s, [c.jobId]: true })); track("job_save", { from: "assistant" }); toast("success", "Saved for later."); }
              catch (e) { toast("error", errMsg(e)); }
            }}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-brand-50 hover:text-brand-600 disabled:text-brand-600">
            {saved[c.jobId] ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
          </button>
        </div>
      ))}
    </div>
  );
}

function Changes({ changes, onUndo }: { changes: NonNullable<ChatMessage["changes"]>; onUndo: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div className="mt-2.5 space-y-1.5">
      {changes.map((c) => (
        <div key={c.id} className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-sm", c.undone ? "border-slate-200 bg-slate-50 text-slate-500" : "border-emerald-200 bg-emerald-50 text-emerald-900")}>
          {c.undone ? <Undo2 className="h-4 w-4 shrink-0" /> : <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
          <span className={cn("min-w-0 flex-1", c.undone && "line-through")}>{c.summary}</span>
          {!c.undone && (
            <button disabled={busy === c.id} onClick={async () => { setBusy(c.id); try { await onUndo(c.id); } finally { setBusy(null); } }}
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">
              {busy === c.id ? "Undoing…" : "Undo"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Pending({ action, busy, decide }: { action: PendingAction; busy: boolean; decide: (a: PendingAction, ok: boolean) => void }) {
  return (
    <div className="mt-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-[11px] font-semibold text-amber-700">Needs your OK</p>
      <p className="mt-0.5 text-sm text-slate-900">{action.summary}</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => decide(action, true)}>Confirm</Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => decide(action, false)}>Not now</Button>
      </div>
    </div>
  );
}

function MessageActions({ m, isLast, onRegenerate, onRate }: { m: Msg; isLast: boolean; onRegenerate: () => void; onRate: (r: "up" | "down") => void }) {
  const [copied, setCopied] = useState(false);
  const btn = "rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700";
  return (
    <div className={cn("mt-1 flex items-center gap-0.5 transition", !isLast && "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100")}>
      <button className={btn} aria-label="Copy answer" title="Copy" onClick={async () => { await navigator.clipboard.writeText(m.text).catch(() => undefined); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {m.id && (
        <>
          <button className={cn(btn, m.rating === "up" && "text-emerald-600")} aria-label="Good answer" aria-pressed={m.rating === "up"} title="Good answer" onClick={() => onRate("up")}><ThumbsUp className="h-3.5 w-3.5" /></button>
          <button className={cn(btn, m.rating === "down" && "text-red-500")} aria-label="Bad answer" aria-pressed={m.rating === "down"} title="Bad answer" onClick={() => onRate("down")}><ThumbsDown className="h-3.5 w-3.5" /></button>
        </>
      )}
      {isLast && <button className={btn} aria-label="Regenerate answer" title="Try again" onClick={onRegenerate}><RotateCcw className="h-3.5 w-3.5" /></button>}
    </div>
  );
}

const md = "text-[14.5px] leading-relaxed text-slate-800 [&_a]:font-medium [&_a]:text-brand-600 [&_a]:underline [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:list-disc [&_ul]:pl-5";

/** The assistant: a panel docked beside the app (the page stays usable), expandable to a focused wide view. */
export default function Assistant({ onClose, initialPrompt, ai, context, openJob, onActed, onNavigate, onAiSetup, name, expanded, setExpanded }: {
  onClose: () => void; initialPrompt?: string; ai: AiState; context: AssistantContext; openJob: (id: string) => void; onActed: () => void;
  onNavigate: (p: Page) => void; onAiSetup: () => void; name: string; expanded: boolean; setExpanded: (v: boolean) => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [starters, setStarters] = useState<string[]>([]);
  const [summary, setSummary] = useState<FeedSummary | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const guidePose = useGuidePose();
  const speakingNow = useGuideSpeaking();
  const [basicReason, setBasicReason] = useState<"no_ai" | "busy" | "quota" | undefined>(ai.available ? undefined : "no_ai");
  const [lang, setLang] = useState<"en-IN" | "hi-IN">("en-IN");
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const box = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();
  const dictation = useDictation((t) => setInput(t));
  useEffect(() => { if (dictation.listening) setGuidePose("listening"); else if (getGuidePose() === "listening") setGuidePose("idle"); }, [dictation.listening]);

  // Load history, starters for this page, and a one-line insight for the empty state.
  useEffect(() => {
    track("assistant_open", { page: context.page });
    api<{ messages: ChatMessage[] }>("/agent/history").then((r) => setMessages(r.messages)).catch(() => undefined).finally(() => setLoaded(true));
    api<FeedSummary>("/feed/summary").then(setSummary).catch(() => undefined);
    setTimeout(() => box.current?.focus(), 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const q = new URLSearchParams({ page: context.page, ...(context.jobId ? { jobId: context.jobId } : {}) });
    api<{ suggestions: string[] }>(`/agent/starters?${q}`).then((r) => setStarters(r.suggestions)).catch(() => undefined);
  }, [context.page, context.jobId]);
  useEffect(() => { if (loaded && initialPrompt) void send(initialPrompt); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [loaded]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { if (expanded) setExpanded(false); else onClose(); } };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [expanded, onClose, setExpanded]);

  // Follow the answer as it streams, unless the user scrolled up to read.
  useLayoutEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [messages]);
  const onScroll = () => { const el = scroller.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };

  // Grow the text box with its content.
  useLayoutEffect(() => { const el = box.current; if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; } }, [input]);

  const patchLast = (fn: (m: Msg) => Msg) => setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? fn(m) : m)));

  const send = useCallback(async (text: string, opts: { regenerate?: boolean } = {}) => {
    const message = text.trim();
    if (!message || busy) return;
    if (dictation.listening) dictation.stop();
    setBusy(true); setInput(""); stick.current = true;
    guideStopSpeaking(); setGuidePose("thinking");
    const now = new Date().toISOString();
    setMessages((ms) => [...(opts.regenerate ? ms.slice(0, -1) : [...ms, { role: "user", text: message, at: now } as Msg]), { role: "assistant", text: "", at: now, streaming: true, steps: [] }]);
    track("assistant_message", { page: context.page, on_job: Boolean(context.jobId), regenerate: Boolean(opts.regenerate), length: message.length });
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const r = await streamChat({ message, context: { page: context.page, jobId: context.jobId }, regenerate: opts.regenerate }, {
        onStep: (s) => patchLast((m) => ({ ...m, steps: [...(m.steps || []).filter((x) => x.id !== s.id), s] })),
        onDelta: (t) => { setGuidePose("talking"); patchLast((m) => ({ ...m, text: m.text + t })); },
        onReset: () => patchLast((m) => ({ ...m, text: "" })),
      }, ctrl.signal);
      setBasicReason(r.mode === "basic" ? r.basicReason : undefined);
      patchLast(() => ({
        id: r.id, role: "assistant", text: r.reply, at: new Date().toISOString(), cards: r.cards.length ? r.cards : undefined, steps: r.steps,
        changes: r.changes.length ? r.changes : undefined, pendingAction: r.pendingAction, suggestions: r.suggestions,
      }));
      guideSpeak(speakable(r.reply));
      if (r.openUrl) window.open(r.openUrl, "_blank", "noopener,noreferrer");
      if (r.navigate) setTimeout(() => onNavigate(r.navigate!), 500);
      if (r.changes.length || r.navigate) onActed();
    } catch (e) {
      if (ctrl.signal.aborted) patchLast((m) => ({ ...m, streaming: false, text: m.text ? `${m.text}\n\n*Stopped.*` : "*Stopped.*", steps: (m.steps || []).filter((s) => s.state !== "running") }));
      else patchLast((m) => ({ ...m, streaming: false, failed: errMsg(e), steps: (m.steps || []).filter((s) => s.state !== "running") }));
    } finally {
      abort.current = null;
      clearApiCache(); // it may have saved jobs or changed preferences
      setGuidePose("idle");
      setBusy(false);
      setTimeout(() => box.current?.focus(), 30);
    }
  }, [busy, context.page, context.jobId, dictation, onActed, onNavigate]);

  async function decide(action: PendingAction, approve: boolean) {
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; message: string; openUrl?: string }>("/agent/confirm", { body: { actionId: action.id, approve } });
      setMessages((ms) => [...ms.map((x) => (x.pendingAction?.id === action.id ? { ...x, pendingAction: undefined } : x)), { role: "assistant", text: r.message, at: new Date().toISOString() }]);
      track("assistant_action", { approved: approve, tool: action.tool });
      if (approve && action.tool === "start_application") track("apply_click", { from: "assistant" });
      if (r.openUrl) window.open(r.openUrl, "_blank", "noopener,noreferrer");
      onActed();
    } catch (e) { toast("error", errMsg(e)); } finally { setBusy(false); }
  }

  async function undo(changeId: string) {
    try {
      const r = await api<{ message: string }>("/agent/undo", { body: { changeId } });
      setMessages((ms) => ms.map((m) => (m.changes?.some((c) => c.id === changeId) ? { ...m, changes: m.changes.map((c) => (c.id === changeId ? { ...c, undone: true } : c)) } : m)));
      toast("success", r.message);
      track("assistant_undo");
      onActed();
    } catch (e) { toast("error", errMsg(e)); }
  }

  async function rate(m: Msg, rating: "up" | "down") {
    if (!m.id) return;
    setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, rating } : x)));
    track("assistant_feedback", { rating });
    try { await api("/agent/feedback", { body: { messageId: m.id, rating } }); if (rating === "down") toast("info", "Thanks — that helps me improve."); } catch { /* non-critical */ }
  }

  async function newChat() {
    abort.current?.abort();
    try { await api("/agent/history", { method: "DELETE" }); } catch { /* keep going */ }
    setMessages([]);
    setTimeout(() => box.current?.focus(), 30);
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastIdx = messages.length - 1;
  const mode = busy ? "Thinking…" : basicReason ? "Basic mode" : ai.ownKey?.status === "ok" ? "Smart · your own AI key" : "Smart";
  const shownStarters = starters.length ? starters : DEFAULT_STARTERS;

  return (
    <>
      {expanded && <div className="scrim fixed inset-0 z-40 hidden animate-fade-in lg:block" onMouseDown={() => setExpanded(false)} />}
      <aside role="complementary" aria-label="AI assistant"
        className={cn("glass-strong fixed inset-0 z-50 flex flex-col animate-slide-in-right lg:inset-y-0 lg:left-auto lg:right-0 lg:border-l",
          expanded ? "lg:w-[min(780px,calc(100vw-2rem))]" : "lg:w-[420px]")}>
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/70 px-4 py-3">
          <AshaAvatar pose={guidePose} mouthOpen={speakingNow} className="h-10 w-10" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[15px] font-bold text-ink">{GUIDE_NAME} <span className="font-sans text-xs font-normal text-slate-500">· your career guide</span></h2>
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className={cn("h-1.5 w-1.5 rounded-full", basicReason ? "bg-amber-400" : "bg-emerald-500")} />{mode}
            </p>
          </div>
          <button onClick={() => void newChat()} disabled={busy || !messages.length} title="New chat" aria-label="New chat" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40"><SquarePen className="h-[18px] w-[18px]" /></button>
          <button onClick={() => setExpanded(!expanded)} title={expanded ? "Dock to the side" : "Expand"} aria-label={expanded ? "Dock to the side" : "Expand"} className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:block">
            {expanded ? <Minimize2 className="h-[18px] w-[18px]" /> : <Maximize2 className="h-[18px] w-[18px]" />}
          </button>
          <button onClick={onClose} title="Close (Esc)" aria-label="Close assistant" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        {basicReason && !ai.ownKey && messages.length > 0 && (
          <div className="mx-4 mt-3 flex items-start gap-3 rounded-2xl border border-brand-100 bg-brand-50 p-3 text-sm">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <div className="flex-1">
              <p className="font-medium text-brand-900">{basicReason === "quota" ? "Today's free AI credits are used up" : basicReason === "busy" ? "The shared AI is busy right now" : "Smart chat isn't switched on yet"}</p>
              <p className="mt-0.5 text-brand-800/80">I can still find jobs and show matches. Add your free Google key for full, unlimited AI.</p>
              <Button size="sm" className="mt-2" onClick={onAiSetup}>Unlock free AI</Button>
            </div>
          </div>
        )}

        {/* Conversation */}
        <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto overscroll-contain">
          <div className={cn("mx-auto flex min-h-full flex-col space-y-6 px-4 py-5", expanded && "max-w-2xl")}>
            {messages.length === 0 && (
              <div className="flex flex-1 animate-fade-in flex-col gap-5 pt-1">
                <div className="flex items-center gap-4">
                  <AshaAvatar pose={loaded ? "waving" : "idle"} className="h-16 w-16" />
                  <div className="min-w-0">
                    <p className="font-display text-xl font-bold text-ink">Hi{name ? ` ${name}` : ""}, I'm {GUIDE_NAME}</p>
                    <p className="text-sm text-slate-600">{context.jobId ? "Ask me anything about this job, or anything else." : "I can find jobs, explain your matches, prepare applications and help you practise."}</p>
                  </div>
                </div>

                {summary && summary.total > 0 && !context.jobId && (
                  <button onClick={() => void send("How can I get more excellent matches?")} className="glass-tint flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left shadow-sm transition hover:border-brand-300">
                    <span className="bg-peacock flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"><Sparkles className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block font-semibold text-ink">{[summary.bands.excellent && `${summary.bands.excellent} excellent`, summary.bands.good && `${summary.bands.good} good`].filter(Boolean).join(" · ") || summary.total} {summary.bands.excellent + summary.bands.good === 1 ? "match" : "matches"}</span>
                      <span className="block text-slate-600">Ask me how to turn more of them into excellent ones</span>
                    </span>
                  </button>
                )}

                <div>
                  <p className="mb-2 text-xs font-semibold text-slate-500">Try asking</p>
                  <div className="grid gap-2 sm:grid-cols-2 sm:[&>*:last-child:nth-child(odd)]:col-span-2">
                    {shownStarters.map((s, i) => {
                      const Icon = STARTER_ICONS[i % STARTER_ICONS.length];
                      return (
                        <button key={s} onClick={() => void send(s)} disabled={!loaded} className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white p-3 text-left text-sm text-slate-700 shadow-sm transition hover:border-brand-300 disabled:opacity-60">
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />{s}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-auto space-y-2">
                  {basicReason && !ai.ownKey && (
                    <p className="flex items-start gap-2 rounded-xl bg-brand-50 px-3 py-2.5 text-xs text-brand-900">
                      <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
                      <span className="flex-1">{basicReason === "quota" ? "Today's free AI credits are used up." : basicReason === "busy" ? "The shared AI is busy right now." : "I'm in basic mode."} I can still search jobs and show your matches. <button onClick={onAiSetup} className="font-semibold text-brand-700 underline">Add your free Google key</button> for natural conversation.</span>
                    </p>
                  )}
                  <p className="text-center text-xs text-slate-500">Tip: tap the microphone and just talk to me, in English or Hindi.</p>
                </div>
              </div>
            )}

            {messages.map((m, i) => m.role === "user" ? (
              <div key={i} className="flex justify-end animate-fade-in">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-50 px-3.5 py-2 text-[14.5px] text-ink ring-1 ring-brand-100">{m.text}</p>
              </div>
            ) : (
              <div key={i} className="group flex gap-2.5 animate-fade-in">
                <AshaAvatar className="mt-0.5 h-7 w-7" />
                <div className="min-w-0 flex-1">
                  <Steps steps={m.steps || []} live={Boolean(m.streaming)} />
                  {m.streaming && !m.text && !(m.steps || []).some((s) => s.state === "running") && (
                    <p className="flex items-center gap-1 py-1" aria-label="Thinking"><span className="typing-dot" /><span className="typing-dot [animation-delay:150ms]" /><span className="typing-dot [animation-delay:300ms]" /></p>
                  )}
                  {m.text && <div className={cn(md, m.streaming && "streaming-caret")}><ReactMarkdown>{m.text}</ReactMarkdown></div>}
                  {m.failed && (
                    <div className="mt-1 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      <CircleAlert className="h-4 w-4 shrink-0" /><span className="flex-1">{m.failed}</span>
                      {lastUser && i === lastIdx && <button className="font-semibold underline" onClick={() => void send(lastUser.text, { regenerate: true })}>Retry</button>}
                    </div>
                  )}
                  {m.cards && <JobCards cards={m.cards} openJob={openJob} />}
                  {m.changes && <Changes changes={m.changes} onUndo={undo} />}
                  {m.pendingAction && <Pending action={m.pendingAction} busy={busy} decide={(a, ok) => void decide(a, ok)} />}
                  {!m.streaming && !m.failed && m.text && (
                    <MessageActions m={m} isLast={i === lastIdx} onRate={(r) => void rate(m, r)} onRegenerate={() => lastUser && void send(lastUser.text, { regenerate: true })} />
                  )}
                  {i === lastIdx && !m.streaming && !busy && m.suggestions && m.suggestions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.suggestions.slice(0, 3).map((s) => (
                        <button key={s} onClick={() => void send(s)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">{s}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Composer */}
        <form onSubmit={(e) => { e.preventDefault(); void send(input); }} className={cn("px-3 pb-3 pt-2", expanded && "mx-auto w-full max-w-2xl")}>
          <div className={cn("rounded-2xl border bg-white/90 shadow-sm transition focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-100", dictation.listening ? "border-red-300" : "border-slate-200")}>
            <textarea ref={box} value={input} onChange={(e) => setInput(e.target.value)} rows={1} maxLength={1500}
              placeholder={dictation.listening ? "Listening…" : context.jobId ? "Ask about this job…" : "Ask anything — e.g. “Remote jobs above 20 LPA”"}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } }}
              aria-label="Message the assistant"
              className="block max-h-40 w-full resize-none bg-transparent px-3.5 pt-3 text-[14.5px] text-ink outline-none placeholder:text-slate-400" />
            <div className="flex items-center gap-1 px-2 pb-2 pt-1">
              {speechSupported && (
                <>
                  <button type="button" onClick={() => (dictation.listening ? dictation.stop() : dictation.start(lang))} aria-label={dictation.listening ? "Stop voice input" : "Speak your message"} title={dictation.listening ? "Stop" : "Speak"}
                    className={cn("rounded-lg p-2 transition", dictation.listening ? "animate-pulse bg-red-50 text-red-600" : "text-slate-500 hover:bg-slate-100")}>
                    <Mic className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setLang(lang === "en-IN" ? "hi-IN" : "en-IN")} title="Voice language" aria-label={`Voice language: ${lang === "en-IN" ? "English" : "Hindi"}`}
                    className="rounded-md px-1.5 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">{lang === "en-IN" ? "EN" : "हिं"}</button>
                </>
              )}
              <span className="ml-auto hidden text-[11px] text-slate-400 sm:block">Enter to send · Shift+Enter for a new line</span>
              {busy ? (
                <button type="button" onClick={() => abort.current?.abort()} aria-label="Stop" title="Stop" className="ml-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[#0f2a3b] text-white hover:bg-slate-700"><Square className="h-3.5 w-3.5 fill-current" /></button>
              ) : (
                <button type="submit" disabled={!input.trim()} aria-label="Send" className="bg-peacock ml-2 flex h-8 w-8 items-center justify-center rounded-lg text-white transition hover:brightness-110 disabled:bg-none disabled:bg-slate-200 disabled:text-slate-400"><ArrowUp className="h-4 w-4" /></button>
              )}
            </div>
          </div>
          {dictation.error && <p className="mt-1 px-1 text-xs text-red-600">{dictation.error}</p>}
          <p className="mt-1.5 text-center text-[11px] text-slate-400">I can make mistakes, and I always ask before doing anything important.</p>
        </form>
      </aside>
    </>
  );
}
