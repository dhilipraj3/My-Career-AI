import { useEffect, useRef, useState } from "react";

const reducedMotion = () => typeof window !== "undefined" && (Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) || document.documentElement.classList.contains("low-data"));

/** Fade-and-rise every `.reveal` element inside the container as it scrolls into view. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = [...root.querySelectorAll<HTMLElement>(".reveal")];
    if (reducedMotion() || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("is-visible")); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    els.forEach((e) => io.observe(e));
    // Safety net: content must never stay hidden (slow devices, print, crawlers, unusual scroll containers).
    const fallback = setTimeout(() => els.forEach((e) => e.classList.add("is-visible")), 1500);
    return () => { io.disconnect(); clearTimeout(fallback); };
  });
  return ref;
}

/** A number that counts up from zero the first time it becomes visible. */
export function CountUp({ value, duration = 1200, format = (n: number) => n.toLocaleString("en-IN") }: { value: number; duration?: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(reducedMotion() ? value : 0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  useEffect(() => {
    if (reducedMotion()) { setShown(value); return; }
    const el = ref.current;
    if (!el) return;
    const run = () => {
      started.current = true;
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    if (started.current) { setShown(value); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { run(); io.disconnect(); } });
    io.observe(el);
    // Never leave a real number showing as 0 if the animation can't run.
    const fallback = setTimeout(() => { if (!started.current) { started.current = true; setShown(value); } }, 1500);
    return () => { io.disconnect(); clearTimeout(fallback); };
  }, [value, duration]);
  return <span ref={ref} className="tabular-nums">{format(shown)}</span>;
}

// ---------------------------------------------------------------- Confetti
const COLORS = ["#0a7399", "#07a384", "#f59e0b", "#f0bf4c", "#06b6d4", "#0fb38f"];

/** Celebrate a milestone (applied, interview, offer). Pure CSS; skipped when the user prefers reduced motion. */
export function celebrate(pieces = 70) {
  if (reducedMotion() || typeof document === "undefined") return;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:70;overflow:hidden";
  for (let i = 0; i < pieces; i++) {
    const p = document.createElement("span");
    const size = 6 + Math.random() * 6;
    p.style.cssText = `position:absolute;top:0;left:${Math.random() * 100}%;width:${size}px;height:${size * 0.45}px;border-radius:2px;`
      + `background:${COLORS[i % COLORS.length]};--dx:${(Math.random() - 0.5) * 240}px;--rot:${(Math.random() - 0.5) * 1080}deg;`
      + `animation:confetti-fall ${1.8 + Math.random() * 1.4}s cubic-bezier(.2,.6,.4,1) ${Math.random() * 0.25}s forwards`;
    host.appendChild(p);
  }
  document.body.appendChild(host);
  setTimeout(() => host.remove(), 3800);
}
