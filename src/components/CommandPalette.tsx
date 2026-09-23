import { ArrowRight, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { cn, Kbd } from "../ui";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: ComponentType<{ className?: string }>;
  run: () => void;
}

/** Ctrl/⌘+K: jump anywhere or search jobs without leaving the keyboard. */
export default function CommandPalette({ open, onClose, commands, onSearch }: { open: boolean; onClose: () => void; commands: Command[]; onSearch: (q: string) => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setQ(""); setActive(0); setTimeout(() => input.current?.focus(), 10); } }, [open]);

  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = commands.filter((c) => !t || c.label.toLowerCase().includes(t) || c.hint?.toLowerCase().includes(t));
    return t ? [{ id: "__search", label: `Search jobs for “${q.trim()}”`, icon: Search, run: () => onSearch(q.trim()) } as Command, ...list] : list;
  }, [q, commands, onSearch]);

  if (!open) return null;
  const run = (c: Command) => { onClose(); c.run(); };
  return (
    <div className="scrim fixed inset-0 z-[55] flex items-start justify-center px-4 pt-[12vh] animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="glass-strong w-full max-w-xl overflow-hidden rounded-2xl border animate-slide-up">
        <div className="flex items-center gap-3 border-b border-slate-200/60 px-4">
          <Search className="h-5 w-5 text-slate-400" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} placeholder="Search jobs or jump to a page…" className="h-14 flex-1 bg-transparent text-base outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              if (e.key === "Enter" && items[active]) run(items[active]);
            }} />
          <Kbd>Esc</Kbd>
        </div>
        <ul className="max-h-80 overflow-auto p-2" role="listbox">
          {items.map((c, i) => (
            <li key={c.id}>
              <button onMouseEnter={() => setActive(i)} onClick={() => run(c)} className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm", i === active ? "bg-brand-50 text-brand-800" : "text-slate-700")}>
                <c.icon className="h-4 w-4 shrink-0" /><span className="flex-1">{c.label}</span>{c.hint && <span className="text-xs text-slate-400">{c.hint}</span>}{i === active && <ArrowRight className="h-4 w-4" />}
              </button>
            </li>
          ))}
          {!items.length && <li className="px-3 py-6 text-center text-sm text-slate-500">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
