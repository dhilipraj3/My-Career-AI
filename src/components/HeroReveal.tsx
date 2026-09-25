import { BadgeCheck, FileText, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CompanyMark, ScoreRing } from "../ui";
import type { HeroJob } from "./HeroBrain";

// Illustrative match profiles (score/skills/gap) cycled against real, live jobs. Never a real person's data —
// labelled as an example, same honesty rule as the rest of the app (no invented per-user claims).
interface Slot { score: number; skills: number; experience: number; location: number; gap: string }
const SLOTS: Slot[] = [
  { score: 86, skills: 92, experience: 100, location: 100, gap: "One skill on the posting isn't on this resume yet" },
  { score: 78, skills: 74, experience: 90, location: 65, gap: "Wants on-site; this profile is looking for hybrid" },
  { score: 91, skills: 96, experience: 85, location: 100, gap: "A certification the posting asks for isn't confirmed" },
];

const RESUME_MS = 1100;
const REVEAL_MS = 3600;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The hero's "show, don't tell": a plain resume turns into an honest, scored match in a few seconds, then loops with
 * the next real job. Demonstrates the product's core promise (a match score that explains itself) before anyone
 * reads a word of copy.
 */
export default function HeroReveal({ jobs }: { jobs: HeroJob[] }) {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<"resume" | "reveal">("resume");
  const [shown, setShown] = useState(0); // the score ring counts up to this
  const [filled, setFilled] = useState(false); // skill bars animate to full width once true

  const job = jobs.length ? jobs[i % jobs.length] : null;
  const slot = SLOTS[i % SLOTS.length];

  // Advance through resume → reveal → next job, on a loop.
  useEffect(() => {
    if (!jobs.length) return;
    if (reducedMotion()) { setPhase("reveal"); setShown(slot.score); setFilled(true); return; }
    setPhase("resume");
    const toReveal = setTimeout(() => setPhase("reveal"), RESUME_MS);
    const toNext = setTimeout(() => setI((x) => x + 1), RESUME_MS + REVEAL_MS);
    return () => { clearTimeout(toReveal); clearTimeout(toNext); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, jobs.length]);

  // Count the score ring up, and let the skill bars fill in, right as the card flips to "reveal".
  useEffect(() => {
    if (phase !== "reveal" || reducedMotion()) return;
    setShown(0); setFilled(false);
    const grow = requestAnimationFrame(() => requestAnimationFrame(() => setFilled(true)));
    const t0 = performance.now();
    let raf: number;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 900);
      setShown(Math.round(slot.score * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(grow); cancelAnimationFrame(raf); };
  }, [phase, i, slot.score]);

  if (!job) return <div className="mx-auto aspect-[4/5] w-full max-w-[400px] animate-pulse rounded-3xl bg-slate-100" aria-hidden />;

  const bars: Array<[string, number]> = [["Skills", slot.skills], ["Experience", slot.experience], ["Location", slot.location]];

  return (
    <div className="relative mx-auto w-full max-w-[420px] select-none" aria-hidden>
      <div className="grid-bg absolute -inset-6 rounded-[2.5rem] opacity-50" />
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[var(--shadow-pop)] sm:p-6">
        {phase === "resume" ? (
          <div key={`r${i}`} className="animate-fade-in space-y-4 py-8 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><FileText className="h-6 w-6" /></span>
            <p className="font-display font-semibold text-ink">Reading a resume…</p>
            <div className="mx-auto max-w-[220px] space-y-1.5">{[90, 70, 82, 55].map((w, k) => <div key={k} className="h-2 rounded-full bg-slate-100" style={{ width: `${w}%` }} />)}</div>
          </div>
        ) : (
          <div key={`m${i}`} className="animate-slide-up space-y-4">
            <div className="flex items-start gap-3">
              <CompanyMark name={job.company} size={44} />
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="truncate font-display text-base font-bold text-ink">{job.title}</p>
                <p className="truncate text-sm text-slate-500">{job.company} · {job.location}</p>
              </div>
              <ScoreRing score={shown} size={56} />
            </div>
            <div className="space-y-2">
              {bars.map(([label, pct]) => (
                <div key={label}>
                  <div className="mb-1 flex justify-between text-xs"><span className="text-slate-500">{label}</span><span className="font-medium text-ink">{filled ? pct : 0}%</span></div>
                  <div className="h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-[width] duration-700 ease-out" style={{ width: `${filled ? pct : 0}%` }} /></div>
                </div>
              ))}
            </div>
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{slot.gap}
            </div>
            <p className="flex items-center gap-1 text-[11px] text-slate-400"><BadgeCheck className="h-3 w-3" />A real, live job · score shown is an example — sign in for yours</p>
          </div>
        )}
      </div>
    </div>
  );
}
