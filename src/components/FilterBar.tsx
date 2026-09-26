import { MapPin, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { EducationLevel, JobCategory, JobQuery, JobSearchResult, WorkMode } from "@shared/types";
import { api } from "../lib/api";
import { CATEGORY_LABELS, EDUCATION_LABELS, POPULAR_CITIES } from "../lib/labels";
import { Button, Chip, cn } from "../ui";

const MODES: Array<[WorkMode, string]> = [["remote", "Remote"], ["hybrid", "Hybrid"], ["onsite", "On-site"]];
const POSTED: Array<[number, string]> = [[1, "Last 24h"], [7, "Last 7 days"], [30, "Last 30 days"]];
const SALARY: Array<[number, string]> = [[2.4, "₹20k+/month"], [3.6, "₹30k+/month"], [6, "6+ LPA"], [10, "10+ LPA"], [20, "20+ LPA"], [35, "35+ LPA"]];

export const SORTS: Array<[NonNullable<JobQuery["sort"]>, string]> = [["match", "Best match"], ["newest", "Newest"], ["salary", "Highest pay"], ["relevance", "Most relevant"]];

export function toParams(q: JobQuery): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === "" || v === false || (Array.isArray(v) && !v.length)) continue;
    p.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return p.toString();
}

const Select = ({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) => (
  <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-500">{label}
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-2.5 text-sm font-normal text-slate-800 hover:border-slate-300">{children}</select>
  </label>
);

/** Search box + city chips + filters + sort. Used by "For you" and "Search". */
export default function FilterBar({ query, set: setRaw, facets, searchBox = true, reset }: {
  query: JobQuery; set: (patch: Partial<JobQuery>) => void; facets?: JobSearchResult["facets"]; searchBox?: boolean; reset: () => void;
}) {
  const [text, setText] = useState(query.q || "");
  const [cityInput, setCityInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<number>();
  useEffect(() => { setText(query.q || ""); }, [query.q]); // a reset or a chip elsewhere changes the query: keep the box in step
  /** Whatever is typed but not yet applied (title box, city box) travels with every change, so nothing looks applied while it is not. */
  const pendingText = text.trim() !== (query.q || "") ? { q: text.trim() || undefined } : {};
  const pendingCity = cityInput.trim() && !query.cities?.includes(cityInput.trim()) ? { cities: [...(query.cities || []), cityInput.trim()] } : {};
  const set = (patch: Partial<JobQuery>) => { setRaw({ ...pendingText, ...pendingCity, ...patch }); if (pendingCity.cities && !patch.cities) setCityInput(""); };

  const toggle = <T,>(list: T[] | undefined, v: T) => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list || []), v]);
  const addCity = (c: string) => { const v = c.trim(); if (v && !query.cities?.includes(v)) set({ cities: [...(query.cities || []), v] }); setCityInput(""); };
  const submit = (v = text) => { setSuggestions([]); setRaw({ ...pendingCity, q: v.trim() || undefined }); if (pendingCity.cities) setCityInput(""); };
  const onType = (v: string) => {
    setText(v);
    window.clearTimeout(timer.current);
    if (v.trim().length < 2) return setSuggestions([]);
    timer.current = window.setTimeout(() => void api<{ suggestions: string[] }>(`/jobs/suggest?q=${encodeURIComponent(v)}`).then((r) => setSuggestions(r.suggestions)).catch(() => undefined), 200);
  };
  const active = [query.workModes?.length, query.freshersOnly, query.postedWithinDays, query.categories?.length, query.minSalaryLPA, query.maxEducation, query.experienceYears !== undefined].filter(Boolean).length;

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-[var(--shadow-card)] sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        {searchBox && (
          <form className="relative flex-1" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
            <input value={text} onChange={(e) => onType(e.target.value)} onBlur={() => setTimeout(() => setSuggestions([]), 150)} aria-label="Job title, skill or company"
              placeholder="Job title, skill or company" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-10 pr-3 text-sm focus:border-brand-400 focus:bg-white focus:outline-none" />
            {suggestions.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[var(--shadow-pop)]" role="listbox">
                {suggestions.map((s) => <li key={s}><button type="button" onMouseDown={() => { setText(s); submit(s); }} className="block w-full px-3.5 py-2 text-left text-sm hover:bg-brand-50">{s}</button></li>)}
              </ul>
            )}
          </form>
        )}
        <div className={cn("relative", !searchBox && "flex-1")}>
          <MapPin className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <input value={cityInput} onChange={(e) => { const v = e.target.value; if (POPULAR_CITIES.includes(v)) addCity(v); else setCityInput(v); }} onBlur={() => { if (cityInput.trim()) addCity(cityInput); }} onKeyDown={(e) => { if (e.key === "Enter" && cityInput.trim()) { e.preventDefault(); addCity(cityInput); } }}
            list="city-list" placeholder="Add a city" aria-label="City" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-10 pr-3 text-sm focus:border-brand-400 focus:bg-white focus:outline-none sm:w-44" />
          <datalist id="city-list">{POPULAR_CITIES.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div className="flex gap-2">
          {searchBox && <Button onClick={() => submit()} className="flex-1 sm:flex-none"><Search className="h-4 w-4" />Search</Button>}
          <Button variant={open || active ? "soft" : "secondary"} onClick={() => setOpen(!open)} className="flex-1 sm:flex-none"><SlidersHorizontal className="h-4 w-4" />Filters{active ? ` · ${active}` : ""}</Button>
          <select aria-label="Sort by" value={query.sort || "match"} onChange={(e) => set({ sort: e.target.value as JobQuery["sort"] })} className="h-10 flex-1 rounded-xl border border-slate-200 bg-white px-2.5 text-sm sm:flex-none">
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      {(query.cities?.length || 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {query.cities!.map((c) => (
            <span key={c} className="inline-flex h-7 items-center gap-1 rounded-full bg-brand-50 pl-3 pr-1.5 text-sm text-brand-700">{c}
              <button aria-label={`Remove ${c}`} onClick={() => set({ cities: query.cities!.filter((x) => x !== c) })} className="-mr-1 flex h-7 w-7 items-center justify-center rounded-full hover:bg-brand-100"><X className="h-3.5 w-3.5" /></button></span>
          ))}
          <label className="ml-1 flex min-h-9 cursor-pointer items-center gap-2 text-xs text-slate-600"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!query.strictCity} onChange={(e) => set({ strictCity: !e.target.checked })} />Include remote & Pan-India</label>
        </div>
      )}

      {open && (
        <div className="space-y-3 border-t border-slate-100 pt-3 animate-fade-in">
          <div className="flex flex-wrap gap-2">
            {MODES.map(([m, l]) => <Chip key={m} on={Boolean(query.workModes?.includes(m))} onClick={() => set({ workModes: toggle(query.workModes, m) })}>{l}</Chip>)}
            <Chip on={Boolean(query.freshersOnly)} onClick={() => set({ freshersOnly: !query.freshersOnly || undefined })}>Freshers welcome</Chip>
            {POSTED.map(([d, l]) => <Chip key={d} on={query.postedWithinDays === d} onClick={() => set({ postedWithinDays: query.postedWithinDays === d ? undefined : d })}>{l}</Chip>)}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Select label="Category" value={query.categories?.[0] || ""} onChange={(v) => set({ categories: v ? [v as JobCategory] : undefined })}>
              <option value="">All categories</option>
              {(Object.keys(CATEGORY_LABELS) as JobCategory[]).filter((c) => c !== "other").map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}{facets?.category[c] ? ` (${facets.category[c]})` : ""}</option>)}
            </Select>
            <Select label="My experience" value={query.experienceYears === undefined ? "" : String(query.experienceYears)} onChange={(v) => set({ experienceYears: v === "" ? undefined : Number(v) })}>
              <option value="">Any</option><option value="0">Fresher</option>{[1, 2, 3, 5, 8, 10, 15].map((y) => <option key={y} value={y}>{y} years</option>)}
            </Select>
            <Select label="Minimum pay" value={query.minSalaryLPA ? String(query.minSalaryLPA) : ""} onChange={(v) => set({ minSalaryLPA: v ? Number(v) : undefined })}>
              <option value="">Any (incl. not disclosed)</option>{SALARY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <Select label="My education" value={query.maxEducation || ""} onChange={(v) => set({ maxEducation: (v || undefined) as EducationLevel | undefined })}>
              <option value="">Any</option>{(Object.keys(EDUCATION_LABELS) as EducationLevel[]).filter((e) => e !== "none").map((e) => <option key={e} value={e}>{EDUCATION_LABELS[e]}</option>)}
            </Select>
          </div>
          {active > 0 && <button className="text-sm font-medium text-brand-600 hover:underline" onClick={reset}>Clear all filters</button>}
        </div>
      )}
    </div>
  );
}
