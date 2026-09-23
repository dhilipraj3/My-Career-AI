import { ArrowRight, Home, KeyRound, MessageCircle, Sparkles } from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { Button, cn } from "../ui";

const KEY = "mc_tour_v1_done";

const STEPS: Array<{ icon: ComponentType<{ className?: string }>; tone: string; title: string; text: string }> = [
  { icon: Home, tone: "from-brand-500 to-brand-700", title: "Your job search, at a glance", text: "Home shows where you are, what's new, and the next best thing to do today." },
  { icon: Sparkles, tone: "from-emerald-500 to-emerald-700", title: "Jobs matched to you — honestly", text: "“For you” scores every live job against your profile and explains why. No great matches yet? It tells you exactly what to change." },
  { icon: MessageCircle, tone: "from-accent-500 to-accent-700", title: "An assistant that does the work", text: "Ask it to find jobs, explain a match, prepare an application or open a page. It always asks before anything important." },
  { icon: KeyRound, tone: "from-amber-500 to-orange-600", title: "Unlock unlimited AI for free", text: "Everyone gets a daily AI allowance. Add your own free Google key any time for unlimited help — it takes a minute." },
];

const seen = () => {
  if (new URLSearchParams(location.search).has("notour")) return true; // screenshots & demos
  try { return localStorage.getItem(KEY) === "1"; } catch { return true; }
};
const markSeen = () => { try { localStorage.setItem(KEY, "1"); } catch { /* private mode: just don't remember */ } };

/** A short first-run tour so new users understand what the app does and where things are. */
export default function WelcomeTour({ name, onAiSetup }: { name: string; onAiSetup: () => void }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  useEffect(() => { if (!seen()) { const t = setTimeout(() => setOpen(true), 700); return () => clearTimeout(t); } }, []);
  if (!open) return null;
  const close = () => { markSeen(); setOpen(false); };
  const s = STEPS[i];
  const last = i === STEPS.length - 1;
  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center scrim p-4 animate-fade-in sm:items-center" role="dialog" aria-modal="true" aria-label="Welcome tour">
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-[var(--shadow-pop)] animate-slide-up">
        <div className={cn("relative flex h-40 items-center justify-center bg-gradient-to-br", s.tone)}>
          <div className="grid-bg absolute inset-0 opacity-30" />
          <span key={i} className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-white/20 text-white ring-1 ring-white/40 backdrop-blur animate-slide-up"><s.icon className="h-10 w-10" /></span>
        </div>
        <div className="space-y-3 p-6">
          {i === 0 && <p className="text-sm font-semibold text-brand-600">Welcome{name ? `, ${name}` : ""} 👋</p>}
          <h2 key={`t${i}`} className="text-xl font-bold animate-fade-in">{s.title}</h2>
          <p key={`p${i}`} className="text-slate-600 animate-fade-in">{s.text}</p>
          <div className="flex items-center justify-between pt-3">
            <div className="flex gap-1.5">{STEPS.map((_, k) => <span key={k} className={cn("h-1.5 rounded-full transition-all", k === i ? "w-6 bg-brand-600" : "w-1.5 bg-slate-200")} />)}</div>
            <div className="flex gap-2">
              {!last && <Button variant="ghost" size="sm" onClick={close}>Skip</Button>}
              {last ? (
                <>
                  <Button variant="secondary" size="sm" onClick={() => { close(); onAiSetup(); }}>Add my key</Button>
                  <Button size="sm" onClick={close}>Let's go</Button>
                </>
              ) : <Button size="sm" onClick={() => setI(i + 1)}>Next<ArrowRight className="h-4 w-4" /></Button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
