import { useEffect, useState } from "react";

export interface HeroJob { title: string; company: string; location: string; pay?: string }

// Illustrative match band per pin (which ring it sits in), paired with real, live jobs — same honesty rule as the
// rest of the app (no invented per-user claims; only the band placement is illustrative).
const PINS = [
  { x: 239, y: 222, r: "excellent", color: "#059669" },
  { x: 132, y: 239, r: "good", color: "#0a7399" },
  { x: 200, y: 50, r: "fair", color: "#d97706" },
] as const;
const FALLBACK: HeroJob[] = [
  { title: "Senior Project Manager", company: "A hiring company", location: "Chennai" },
  { title: "Data Analyst", company: "A hiring company", location: "Bengaluru" },
  { title: "Software Engineer", company: "A hiring company", location: "Remote" },
];
const CYCLE_MS = 4500;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The brand's own story, illustrated: an arrow flies in once and lands on the target — "we hit the right job for
 * you" — then real, live jobs land as pins on the rings, closer to the gold centre the better the match. Everything
 * that ever moves after the one-time arrow animation is a small, fixed-size, absolutely-positioned pin; the target
 * itself never changes size, so nothing on the page can ever reflow.
 */
export default function HeroTarget({ jobs }: { jobs: HeroJob[] }) {
  const [landed, setLanded] = useState(reducedMotion());
  const [tick, setTick] = useState(0);
  const list = jobs.length ? jobs : FALLBACK;

  useEffect(() => {
    if (reducedMotion()) return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setLanded(true)));
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    if (reducedMotion() || list.length < 2) return;
    const t = setInterval(() => setTick((x) => x + 1), CYCLE_MS);
    return () => clearInterval(t);
  }, [list.length]);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[440px] select-none" aria-hidden>
      <svg viewBox="0 0 400 400" className="h-full w-full overflow-visible">
        <defs><radialGradient id="ht-gold" cx=".35" cy=".35" r=".75"><stop offset="0" stopColor="#ffe29a" /><stop offset=".6" stopColor="#f0bf4c" /><stop offset="1" stopColor="#d9a431" /></radialGradient></defs>
        {/* The target — the exact brand colours, scaled up */}
        <circle cx="200" cy="200" r="170" fill="#eef7fa" stroke="#0a7399" strokeWidth="2" />
        <circle cx="200" cy="200" r="132" fill="#ffffff" stroke="#0a7399" strokeWidth="2" />
        <circle cx="200" cy="200" r="96" fill="#e8faf4" stroke="#07a384" strokeWidth="2" />
        <circle cx="200" cy="200" r="60" fill="#ffffff" stroke="#07a384" strokeWidth="2" />
        <circle cx="200" cy="200" r="30" fill="url(#ht-gold)" className={landed ? "animate-pulse-core" : ""} style={{ transformOrigin: "200px 200px" }} />

        {/* The arrow: flies in once, then rests. */}
        <g style={{ transform: landed ? "translate(0,0) rotate(0deg) scale(1)" : "translate(64px,-56px) rotate(-10deg) scale(.6)", opacity: landed ? 1 : 0, transformOrigin: "200px 200px", transition: "transform 1.1s cubic-bezier(.2,.85,.25,1), opacity .5s ease-out" }}>
          <path d="M285 110 L200 200" stroke="#0a2230" strokeWidth="5" strokeLinecap="round" />
          <path d="M292 122 L285 110 L279 100" stroke="#f0bf4c" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M200 200 L214 194 L206 186 Z" fill="#0a2230" />
        </g>

        {/* Impact ring, timed to when the arrow visually lands */}
        {landed && <circle cx="200" cy="200" r="30" fill="none" stroke="#f0bf4c" strokeWidth="2" opacity="0" style={{ transformOrigin: "200px 200px", animation: "ring 1s ease-out 1s 1 both" }} />}
      </svg>

      {/* Real, live jobs — landing where a match of that quality would sit. Only the label text swaps on a cycle; the
          pin's position, size and colour never change. */}
      {landed && PINS.map((p, i) => {
        const job = list[(tick + i) % list.length];
        return (
          <div key={i} className="absolute animate-fade-in" style={{ left: `${(p.x / 400) * 100}%`, top: `${(p.y / 400) * 100}%`, transform: "translate(-50%, -50%)", animationDelay: `${1.1 + i * 0.15}s`, animationFillMode: "both" }}>
            <span className="block h-2.5 w-2.5 animate-pulse rounded-full ring-2 ring-white" style={{ background: p.color }} />
            <span key={tick} className="absolute left-1/2 top-full mt-1.5 max-w-[130px] -translate-x-1/2 truncate whitespace-nowrap rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-medium text-ink shadow-sm animate-fade-in">
              {job.title} <span className="text-slate-400">· {job.company}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
