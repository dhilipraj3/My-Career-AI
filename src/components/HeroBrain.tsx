import { BadgeCheck, FileText, MapPin, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { CompanyMark } from "../ui";

export interface HeroJob { title: string; company: string; location: string; pay?: string }

const STEPS = (jobs: number) => ["Reading your resume", "Understanding your skills & goals", `Scanning ${jobs.toLocaleString("en-IN")} live jobs`, "Explaining every match honestly"];

/** Resume → AI core → matched jobs. Jobs shown are real ones from the live index (no invented scores). */
export default function HeroBrain({ jobs, liveJobs }: { jobs: HeroJob[]; liveJobs: number }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 2800); return () => clearInterval(t); }, []);
  const steps = STEPS(liveJobs || 3000);
  const slots = [0, 1, 2].map((i) => (jobs.length ? jobs[(tick + i) % jobs.length] : null));

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
        {[95, 200, 305].map((y) => <path key={y} d={`M270 200 C 320 200, 320 ${y}, 360 ${y}`} stroke="url(#hb-line)" strokeWidth="2.5" fill="none" className="animate-flow" />)}
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

      {/* Matched jobs */}
      {slots.map((j, i) => (
        <div key={i} className="absolute right-[1%] w-[36%] -translate-y-1/2" style={{ top: `${[24, 50, 76][i]}%` }}>
        <div key={tick} className="rounded-2xl border border-slate-200 bg-white p-2.5 shadow-[var(--shadow-lift)]" style={{ animation: "card-in 2.8s ease both", animationDelay: `${i * 0.12}s` }}>
          {j ? (
            <div className="flex items-start gap-2">
              <CompanyMark name={j.company} size={28} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold text-ink sm:text-xs">{j.title}</p>
                <p className="truncate text-[10px] text-slate-500 sm:text-[11px]">{j.company}</p>
                <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-slate-500"><MapPin className="h-2.5 w-2.5 shrink-0" />{j.location}</p>
              </div>
              <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-500" />
            </div>
          ) : <div className="h-12 skeleton" />}
        </div>
        </div>
      ))}

      {/* Live status ticker */}
      <div className="absolute bottom-[3%] left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-brand-100 bg-white/90 px-3.5 py-1.5 text-[11px] font-medium text-brand-700 shadow-sm backdrop-blur sm:text-xs">
        <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
        <span key={tick} className="animate-fade-in">{steps[tick % steps.length]}…</span>
      </div>
    </div>
  );
}
