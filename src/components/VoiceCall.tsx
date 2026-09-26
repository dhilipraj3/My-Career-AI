import { Mic, MicOff, PhoneOff, Signal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errMsg } from "../lib/api";
import type { GuidePose } from "../lib/guide";
import { LiveVoiceCall, type CallState, type ToolEffect, type Turn } from "../lib/live/liveVoice";
import { Button, CompanyMark, cn, useToast } from "../ui";
import Asha from "./Asha";

const STATUS: Record<CallState, string> = {
  connecting: "Connecting…", listening: "Listening", thinking: "Thinking…", speaking: "Asha is speaking", reconnecting: "Reconnecting…", ended: "Call ended", error: "Couldn't connect",
};
const POSE: Record<CallState, GuidePose> = { connecting: "idle", listening: "listening", thinking: "thinking", speaking: "talking", reconnecting: "thinking", ended: "waving", error: "idle" };

/** A live voice call with Asha inside the chat panel. */
export default function VoiceCall({ ctx, onEnd, onStepDown, openJob, onNavigate, onActed }: {
  ctx: { page?: string; jobId?: string; lang?: "en" | "hi"; voice?: string; rttMs: number | null };
  onEnd: (turns: Turn[]) => void;
  onStepDown: (reason: string) => void;
  openJob: (id: string) => void;
  onNavigate: (page: string) => void;
  onActed: () => void;
}) {
  const toast = useToast();
  const call = useRef<LiveVoiceCall | null>(null);
  const [state, setState] = useState<CallState>("connecting");
  const [detail, setDetail] = useState<string | undefined>();
  const [caption, setCaption] = useState({ user: "", assistant: "" });
  const [last, setLast] = useState<Turn | null>(null);
  const [effects, setEffects] = useState<ToolEffect[]>([]);
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const c = new LiveVoiceCall(ctx, {
      onState: (s, d) => { setState(s); if (d) setDetail(d); },
      onCaption: setCaption,
      onTurn: (t) => setLast(t),
      onEffect: (e) => {
        if (e.navigate) onNavigate(e.navigate);
        if (e.openUrl) window.open(e.openUrl, "_blank", "noopener,noreferrer");
        if (e.change) onActed();
        if (e.cards.length || e.pending || e.change) setEffects((xs) => [...xs.slice(-3), e]);
      },
      onStepDown: (reason) => onStepDown(reason),
    });
    call.current = c;
    const dbg = (window as unknown as { __callDebug?: boolean }).__callDebug;
    if (dbg) console.info("[call] mount VoiceCall");
    // Start on the next tick: if React mounts this twice (development checks), the first copy is cancelled before it
    // opens a connection, so only one call ever reaches Google.
    let started = false;
    const go = setTimeout(() => { started = true; void c.start(); }, 0);
    let raf = 0;
    const tick = () => { setLevel(c.level); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => { if (dbg) console.info("[call] unmount VoiceCall"); clearTimeout(go); cancelAnimationFrame(raf); if (started) void c.end(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const end = async () => { const turns = await call.current?.end(); onEnd(turns || []); };
  const confirm = async (id: string, approve: boolean) => {
    try {
      const r = await api<{ message: string; openUrl?: string }>("/agent/confirm", { body: { actionId: id, approve } });
      if (r.openUrl) window.open(r.openUrl, "_blank", "noopener,noreferrer");
      toast(approve ? "success" : "info", r.message);
      setEffects((xs) => xs.map((x) => (x.pending?.id === id ? { ...x, pending: undefined } : x)));
      onActed();
    } catch (e) { toast("error", errMsg(e)); }
  };

  const live = state === "listening" || state === "speaking" || state === "thinking";
  const cards = effects.flatMap((e) => e.cards).filter((c, i, a) => a.findIndex((x) => x.jobId === c.jobId) === i).slice(-4);
  const pending = effects.map((e) => e.pending).filter((p): p is NonNullable<ToolEffect["pending"]> => Boolean(p));

  return (
    <div className="flex h-full flex-col items-center gap-3 px-4 pb-3 pt-4 text-center">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Signal className="h-3.5 w-3.5 text-emerald-500" />Live voice{live && <span className="relative ml-1 flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-70" /><span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" /></span>}</p>
      <div className={cn("relative h-48 w-40 shrink-0 transition sm:h-56 sm:w-48", state === "listening" && "scale-[1.02]")}>
        <div className="absolute inset-x-4 bottom-2 top-8 rounded-full bg-brand-400/20 blur-2xl transition" style={{ opacity: 0.35 + level * 0.9 }} />
        <Asha pose={POSE[state]} level={state === "speaking" ? level : 0} className="relative h-full w-full" />
      </div>
      <p className="font-display text-lg font-semibold text-ink" aria-live="polite">{STATUS[state]}</p>
      {detail && (state === "error" || state === "reconnecting") && <p className="max-w-xs text-sm text-slate-600">{detail}</p>}
      {state === "error" && (
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" onClick={() => onEnd([])}>Back to chat</Button>
          <Button onClick={() => onStepDown("")}>Tap to talk instead</Button>
        </div>
      )}

      <div className="min-h-[4.5rem] w-full max-w-sm space-y-1.5 text-sm">
        {caption.user && <p className="text-slate-500">“{caption.user}”</p>}
        {caption.assistant ? <p className="text-ink">{caption.assistant}</p> : last?.role === "assistant" && !caption.user ? <p className="text-slate-600">{last.text}</p> : null}
        {!caption.user && !caption.assistant && !last && live && <p className="text-slate-500">Say hello, or ask anything. You can talk over me any time.</p>}
      </div>

      {pending.map((p) => (
        <div key={p.id} className="w-full max-w-sm rounded-2xl border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-900">
          <p className="font-medium">Asha needs your OK: {p.summary}</p>
          <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => void confirm(p.id, true)}>Confirm</Button><Button size="sm" variant="secondary" onClick={() => void confirm(p.id, false)}>Not now</Button></div>
        </div>
      ))}
      {cards.length > 0 && (
        <ul className="w-full max-w-sm space-y-1.5 text-left">
          {cards.map((c) => (
            <li key={c.jobId}><button onClick={() => openJob(c.jobId)} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-sm hover:border-brand-300">
              <CompanyMark name={c.company} size={32} /><span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{c.title}</span><span className="block truncate text-xs text-slate-500">{c.company}{c.location ? ` · ${c.location}` : ""}</span></span>
              {c.score !== undefined && <span className="text-xs font-semibold text-brand-700">{c.score}%</span>}
            </button></li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex items-center gap-4 pt-2">
        <button onClick={() => { const m = !muted; setMuted(m); call.current?.setMuted(m); }} disabled={!live} aria-pressed={muted} aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          className={cn("flex h-14 w-14 items-center justify-center rounded-full border transition disabled:opacity-40", muted ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}>
          {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
        </button>
        <button onClick={() => void end()} aria-label="End call" className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-600/30 transition hover:bg-red-700">
          <PhoneOff className="h-7 w-7" />
        </button>
      </div>
      <p className="text-[11px] text-slate-400">Your voice goes to Google Gemini on your own key while the call is on.</p>
    </div>
  );
}
