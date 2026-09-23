// MyCareer.AI component library. Light theme, one indigo accent, soft depth.
import { AlertCircle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export const cn = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

// ---------------------------------------------------------------- Button
type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";
export function Button({ variant = "primary", size = "md", loading, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: "bg-peacock text-white shadow-sm shadow-brand-600/25 hover:brightness-110 active:brightness-95 disabled:opacity-50 disabled:shadow-none",
    secondary: "bg-white text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 hover:ring-slate-300 disabled:opacity-50",
    soft: "bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-50",
    ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50",
    danger: "bg-red-600 text-white hover:bg-red-700 disabled:opacity-50",
  };
  const sizes = { sm: "h-8 px-3 text-xs gap-1.5 rounded-lg", md: "h-10 px-4 text-sm gap-2 rounded-xl", lg: "h-12 px-5 text-base gap-2 rounded-xl" };
  return (
    <button {...p} disabled={p.disabled || loading} className={cn("inline-flex shrink-0 items-center justify-center font-medium transition-all duration-150 disabled:cursor-not-allowed", sizes[size], styles[variant], className)}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Surfaces
export const Card = ({ children, className, interactive, ...p }: { children: ReactNode; className?: string; interactive?: boolean } & React.HTMLAttributes<HTMLDivElement>) => (
  <div {...p} className={cn("rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[var(--shadow-card)]", interactive && "transition hover:-translate-y-px hover:border-brand-200 hover:shadow-[var(--shadow-lift)]", className)}>{children}</div>
);

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-brand-600">{eyebrow}</p>}
        <h1 className="text-2xl font-bold sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-2"><h2 className="text-base font-semibold">{title}</h2>{action}</div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- Badges & chips
type Tone = "slate" | "green" | "amber" | "red" | "brand" | "sky";
export function Badge({ children, tone = "slate", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  const t: Record<Tone, string> = {
    slate: "bg-slate-100 text-slate-700", green: "bg-emerald-50 text-emerald-700 ring-emerald-600/10", amber: "bg-amber-50 text-amber-800 ring-amber-600/10",
    red: "bg-red-50 text-red-700 ring-red-600/10", brand: "bg-brand-50 text-brand-700 ring-brand-600/10", sky: "bg-sky-50 text-sky-700 ring-sky-600/10",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-transparent", t[tone], className)}>{children}</span>;
}

export const Chip = ({ on, onClick, children, className }: { on?: boolean; onClick?: () => void; children: ReactNode; className?: string }) => (
  <button type="button" onClick={onClick} aria-pressed={on} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition", on ? "border-brand-600 bg-brand-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50/50", className)}>{children}</button>
);

// ---------------------------------------------------------------- Scores
export type Band = "excellent" | "good" | "fair" | "low";
export const bandOf = (score: number): Band => (score >= 80 ? "excellent" : score >= 65 ? "good" : score >= 50 ? "fair" : "low");
export const BAND_LABEL: Record<Band, string> = { excellent: "Excellent match", good: "Good match", fair: "Fair match", low: "Weak match" };
const BAND_COLOR: Record<Band, string> = { excellent: "#059669", good: "#0a7399", fair: "#d97706", low: "#94a3b8" };
const BAND_TEXT: Record<Band, string> = { excellent: "text-emerald-700", good: "text-brand-700", fair: "text-amber-700", low: "text-slate-500" };

export function ScoreRing({ score, size = 52, showLabel }: { score: number; size?: number; showLabel?: boolean }) {
  const r = (size - 7) / 2;
  const c = 2 * Math.PI * r;
  const band = bandOf(score);
  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }} aria-label={`${score}% — ${BAND_LABEL[band]}`} title={BAND_LABEL[band]}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef1f6" strokeWidth="5" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={BAND_COLOR[band]} strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (score / 100) * c} className="transition-[stroke-dashoffset] duration-700" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-display font-bold" style={{ color: BAND_COLOR[band], fontSize: size * 0.3 }}>{score}</span>
      </div>
      {showLabel && <span className={cn("text-[11px] font-semibold", BAND_TEXT[band])}>{BAND_LABEL[band].replace(" match", "")}</span>}
    </div>
  );
}

export const BandPill = ({ score }: { score: number }) => {
  const b = bandOf(score);
  const tone: Record<Band, Tone> = { excellent: "green", good: "brand", fair: "amber", low: "slate" };
  return <Badge tone={tone[b]}>{BAND_LABEL[b]}</Badge>;
};

// ---------------------------------------------------------------- Company mark
const HUES = [243, 199, 160, 28, 330, 262, 12, 186];
/** Initials on a colour picked from the name — honest (no guessed logos) and instantly scannable. */
export function CompanyMark({ name, size = 44 }: { name: string; size?: number }) {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2)).toUpperCase();
  const hue = HUES[[...name].reduce((s, ch) => s + ch.charCodeAt(0), 0) % HUES.length];
  return (
    <div aria-hidden className="flex shrink-0 items-center justify-center rounded-xl font-display font-bold" style={{ width: size, height: size, fontSize: size * 0.36, background: `hsl(${hue} 85% 95%)`, color: `hsl(${hue} 60% 38%)` }}>
      {initials}
    </div>
  );
}

// ---------------------------------------------------------------- Stats & progress
export function Stat({ label, value, hint, tone = "slate", onClick, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "slate" | "green" | "brand" | "amber"; onClick?: () => void; icon?: ReactNode }) {
  const accent = { slate: "text-ink", green: "text-emerald-600", brand: "text-brand-600", amber: "text-amber-600" }[tone];
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={cn("flex flex-col rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-[var(--shadow-card)]", onClick && "transition hover:border-brand-200 hover:shadow-[var(--shadow-lift)]")}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">{icon}{label}</span>
      <span className={cn("mt-1 font-display text-2xl font-bold tabular-nums", accent)}>{value}</span>
      {hint && <span className="mt-0.5 text-xs text-slate-500">{hint}</span>}
    </Tag>
  );
}

export const Progress = ({ value, tone = "brand", className }: { value: number; tone?: "brand" | "green" | "amber"; className?: string }) => (
  <div className={cn("h-2 overflow-hidden rounded-full bg-slate-100", className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
    <div className={cn("h-full rounded-full transition-all duration-700", { brand: "bg-brand-600", green: "bg-emerald-500", amber: "bg-amber-500" }[tone])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>
);

// ---------------------------------------------------------------- Feedback states
export const Spinner = ({ label, className }: { label?: string; className?: string }) => (
  <div className={cn("flex items-center justify-center gap-2 p-8 text-slate-500", className)}><Loader2 className="h-5 w-5 animate-spin text-brand-600" />{label && <span className="text-sm">{label}</span>}</div>
);

export const Skeleton = ({ className }: { className?: string }) => <div className={cn("skeleton", className)} />;

export const JobCardSkeleton = () => (
  <div className="rounded-2xl border border-slate-200/80 bg-white p-5">
    <div className="flex gap-4"><Skeleton className="h-11 w-11 rounded-xl" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-1/2" /></div><Skeleton className="h-12 w-12 rounded-full" /></div>
  </div>
);

export function ErrorNote({ error }: { error?: string | null }) {
  return error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null;
}

export const Empty = ({ title, hint, action, icon }: { title: string; hint?: ReactNode; action?: ReactNode; icon?: ReactNode }) => (
  <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
    {icon && <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">{icon}</div>}
    <p className="font-display font-semibold text-ink">{title}</p>
    {hint && <p className="mt-1 max-w-md text-sm text-slate-500">{hint}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

// ---------------------------------------------------------------- Modal & sheet
export function Modal({ open, onClose, title, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: "md" | "lg" }) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="scrim fixed inset-0 z-50 flex items-end justify-center p-0 animate-fade-in sm:items-center sm:p-4" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cn("glass-strong flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl border animate-slide-up sm:rounded-3xl", size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg")}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Tabs
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: Array<{ id: T; label: ReactNode; count?: number }> }) {
  return (
    <div role="tablist" className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl bg-slate-100/80 p-1">
      {items.map((it) => (
        <button key={it.id} role="tab" aria-selected={value === it.id} onClick={() => onChange(it.id)}
          className={cn("flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition", value === it.id ? "bg-white text-ink shadow-sm" : "text-slate-600 hover:text-slate-900")}>
          {it.label}{it.count !== undefined && <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", value === it.id ? "bg-brand-50 text-brand-700" : "bg-white/70 text-slate-500")}>{it.count.toLocaleString("en-IN")}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Toasts
type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = next.current++;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const icon = { success: <CheckCircle2 className="h-5 w-5 text-emerald-500" />, error: <AlertCircle className="h-5 w-5 text-red-500" />, info: <Info className="h-5 w-5 text-brand-500" /> };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink/90 px-4 py-3 text-sm text-white shadow-[var(--shadow-pop)] ring-1 ring-white/10 backdrop-blur-md animate-slide-up">{icon[t.kind]}{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-sans text-[11px] font-medium text-slate-500 shadow-sm">{children}</kbd>;

// ---------------------------------------------------------------- Helpers
export const timeAgo = (iso?: string) => {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.max(1, Math.floor(d / 60))}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
