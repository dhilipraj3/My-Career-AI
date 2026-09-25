import { FileText, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CompanyMark, ScoreRing } from "../ui";

export interface HeroJob { title: string; company: string; location: string; pay?: string }

const STEPS = (jobs: number) => ["Reading your resume", "Understanding your skills & goals", `Scanning ${jobs.toLocaleString("en-IN")} live jobs`, "Explaining every match honestly"];

// Illustrative match profiles (score/skills/gap) cycled against real, live jobs. Never a real person's data — the
// card says so — same honesty rule the rest of the app follows.
interface Slot { score: number; skills: number; experience: number; location: number; gap: string }
const SLOTS: Slot[] = [
  { score: 86, skills: 92, experience: 100, location: 100, gap: "1 skill on the posting isn't on this resume" },
  { score: 78, skills: 74, experience: 90, location: 65, gap: "Wants on-site; this profile wants hybrid" },
  { score: 91, skills: 96, experience: 85, location: 100, gap: "A certification isn't confirmed yet" },
];
// Shown immediately, before the real live-jobs fetch resolves, so the hero never has an empty/loading moment.
const FALLBACK: HeroJob[] = [
  { title: "Senior Project Manager", company: "A hiring company", location: "Chennai" },
  { title: "Data Analyst", company: "A hiring company", location: "Bengaluru" },
  { title: "Software Engineer", company: "A hiring company", location: "Remote" },
];
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Resume → AI core → one real, live job scored and explained. The brain is the centrepiece (as before); the card on
 * the right now shows what the AI actually does with a job — score, skill fit, one honest gap — instead of a plain
 * title card, cycling through real jobs. Every element the card occupies is a fixed percentage of this component's
 * own box (which has a fixed aspect ratio), so cycling never changes anything's size — nothing on the page reflows.
 */
export default function HeroBrain({ jobs, liveJobs }: { jobs: HeroJob[]; liveJobs: number }) {
  const [tick, setTick] = useState(0);
  const [shown, setShown] = useState(SLOTS[0].score);
  const from = useRef(SLOTS[0].score);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 2800); return () => clearInterval(t); }, []);

  const steps = STEPS(liveJobs || 3000);
  const list = jobs.length ? jobs : FALLBACK;
  const job = list[tick % list.length];
  const slot = SLOTS[tick % SLOTS.length];
  const bars: Array<[string, number]> = [["Skills", slot.skills], ["Experience", slot.experience], ["Location", slot.location]];

  // Tween the score number toward the new job's score each cycle; the ring's own stroke and the bar widths animate
  // via CSS transitions reacting to the props below, so this is the only per-frame JS needed.
  useEffect(() => {
    if (reducedMotion()) { setShown(slot.score); return; }
    const start = from.current;
    const t0 = performance.now();
    let raf: number;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 700);
      setShown(Math.round(start + (slot.score - start) * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = slot.score;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [tick, slot.score]);

  return (
    <div className="relative mx-auto aspect-[5/4] w-full max-w-[560px] select-none" aria-hidden>
      <div className="grid-bg absolute inset-0 rounded-[2rem]" />

      {/* Connection lines */}
      <svg viewBox="0 0 500 400" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="hb-line" x1="0" x2="1"><stop offset="0" stopColor="#0b8db3" stopOpacity=".15" /><stop offset=".5" stopColor="#0b8db3" stopOpacity=".7" /><stop offset="1" stopColor="#07a384" stopOpacity=".5" /></linearGradient>
          <radialGradient id="hb-core" cx=".35" cy=".3"><stop offset="0" stopColor="#34abc8" /><stop offset=".6" stopColor="#0a7399" /><stop offset="1" stopColor="#0d4b66" /></radialGradient>
        </defs>
        <path d="M150 200 C 190 200, 200 200, 240 200" stroke="url(#hb-line)" strokeWidth="2.5" fill="none" className="animate-flow" />
        <path d="M270 200 C 320 200, 320 200, 360 200" stroke="url(#hb-line)" strokeWidth="2.5" fill="none" className="animate-flow" />
        {/* orbiting neurons */}
        {[[215, 150], [290, 150], [205, 245], [300, 250], [250, 130], [255, 272]].map(([x, y], i) => (
          <g key={i}>
            <line x1="255" y1="200" x2={x} y2={y} stroke="#0b8db3" strokeOpacity=".25" strokeWidth="1.2" />
            <circle cx={x} cy={y} r="4" fill="#6cc9dd" className="animate-blink" style={{ animationDelay: `${i * 0.25}s` }} />
          </g>
        ))}
        <circle cx="255" cy="200" r="38" fill="#0b8db3" opacity=".25" className="animate-ring" />
        <circle cx="255" cy="200" r="38" fill="#0b8db3" opacity=".18" className="animate-ring" style={{ animationDelay: "1.2s" }} />
        <circle cx="255" cy="200" r="34" fill="url(#hb-core)" className="animate-pulse-core" />
      </svg>

      {/* AI core icon */}
      <div className="absolute left-[51%] top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
        <Sparkles className="h-7 w-7 text-white" />
      </div>

      {/* Resume card */}
      <div className="animate-float absolute left-[1%] top-1/2 w-[28%] -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-3 shadow-[var(--shadow-lift)]">
        <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><FileText className="h-4 w-4" /></span><span className="text-[11px] font-semibold text-ink sm:text-xs">Your resume</span></div>
        <div className="mt-2.5 space-y-1.5">{[90, 70, 80, 55].map((w, i) => <div key={i} className="h-1.5 rounded-full bg-slate-100" style={{ width: `${w}%` }} />)}</div>
        <div className="mt-2.5 flex flex-wrap gap-1">{["Skills", "Experience", "Goals"].map((t) => <span key={t} className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 sm:text-[10px]">{t}</span>)}</div>
      </div>

      {/* One real, live job — scored and explained. A fixed box (top/bottom/left/right in %, not by content), so
          cycling through jobs only ever changes text/numbers inside it, never its size. */}
      <div className="absolute left-[57%] right-[1%] top-[9%] bottom-[11%] overflow-hidden rounded-2xl border border-slate-200 bg-white p-2.5 shadow-[var(--shadow-lift)]" key={tick} style={{ animation: "card-in 2.8s ease both" }}>
        <div className="flex h-full flex-col justify-center gap-2">
          <div className="flex items-start gap-2">
            <CompanyMark name={job.company} size={30} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-ink sm:text-xs">{job.title}</p>
              <p className="truncate text-[10px] text-slate-500">{job.company} · {job.location}</p>
            </div>
            <ScoreRing score={shown} size={38} />
          </div>
          <div className="space-y-1.5">
            {bars.map(([label, pct]) => (
              <div key={label}>
                <div className="flex justify-between text-[9px] text-slate-500"><span>{label}</span><span className="font-medium text-ink">{pct}%</span></div>
                <div className="mt-0.5 h-1 rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} /></div>
              </div>
            ))}
          </div>
          <p className="flex items-center gap-1 truncate text-[9px] font-medium text-amber-700"><TriangleAlert className="h-2.5 w-2.5 shrink-0" />{slot.gap}</p>
        </div>
      </div>

      {/* Live status ticker */}
      <div className="absolute bottom-[3%] left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-brand-100 bg-white/90 px-3.5 py-1.5 text-[11px] font-medium text-brand-700 shadow-sm backdrop-blur sm:text-xs">
        <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
        <span key={tick} className="animate-fade-in">{steps[tick % steps.length]}…</span>
      </div>
    </div>
  );
}
