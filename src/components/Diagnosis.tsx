import { Lightbulb, MapPin, Plus, SlidersHorizontal, Target, Wrench } from "lucide-react";
import { useState } from "react";
import type { CandidateProfile, FeedSummary } from "@shared/types";
import { api, errMsg } from "../lib/api";
import { Button, cn, useToast } from "../ui";

const ICON = { preferences: SlidersHorizontal, location: MapPin, roles: Target, skills: Wrench };

/** "Why you're not seeing excellent matches" — each finding comes with one-tap fixes that re-score the feed. */
export default function Diagnosis({ summary, profile, onChanged }: { summary: FeedSummary; profile: CandidateProfile; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  if (!summary.diagnosis.length) return null;

  const act = async (id: string, fn: () => Promise<unknown>, message: string) => {
    setBusy(id);
    try { await fn(); setDone((d) => new Set(d).add(id)); toast("success", message); setTimeout(onChanged, 2500); } catch (e) { toast("error", errMsg(e)); } finally { setBusy(null); }
  };
  const prefs = (patch: object) => api("/profile/preferences", { method: "PUT", body: patch });
  const pr = profile.preferences;

  const actions = (kind: string, d: FeedSummary["diagnosis"][number]) => {
    if (kind === "preferences") return [
      ...(d.employmentTypes || []).map((t) => ({ id: `type:${t}`, label: `Include ${t.replace("_", " ")}`, run: () => prefs({ employmentTypes: [...pr.employmentTypes, t] }), msg: `Now including ${t.replace("_", " ")} jobs. Re-scoring…` })),
      ...(d.workModes || []).map((m) => ({ id: `mode:${m}`, label: `Include ${m === "onsite" ? "on-site" : m}`, run: () => prefs({ workModes: [...pr.workModes, m] }), msg: `Now including ${m} jobs. Re-scoring…` })),
    ];
    if (kind === "location") return [
      ...(d.cities || []).map((c) => ({ id: `city:${c}`, label: c, run: () => prefs({ locations: [...pr.locations, c] }), msg: `Added ${c}. Re-scoring your matches…` })),
      ...(!pr.willingToRelocate ? [{ id: "relocate", label: "I'd relocate", run: () => prefs({ willingToRelocate: true }), msg: "Noted — you're open to relocating. Re-scoring…" }] : []),
      ...(!pr.workModes.includes("remote") ? [{ id: "remote", label: "Include remote", run: () => prefs({ workModes: [...pr.workModes, "remote"] }), msg: "Remote jobs included. Re-scoring…" }] : []),
    ];
    if (kind === "roles") return summary.roleSuggestions.map((r) => ({
      id: `role:${r.role}`, label: `${r.role} · ${r.jobs}`, run: () => prefs({ targetRoles: [...pr.targetRoles, r.role].slice(0, 10) }), msg: `Added “${r.role}”. Re-scoring your matches…`,
    }));
    return (d.skills || []).map((s) => ({ id: `skill:${s}`, label: `I have ${s}`, run: () => api("/profile", { method: "PATCH", body: { addSkills: [s] } }), msg: `Added ${s} to your skills. Re-scoring…` }));
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50 to-white shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 border-b border-amber-100 px-5 py-3">
        <Lightbulb className="h-5 w-5 text-amber-600" />
        <p className="font-display font-semibold text-ink">{summary.diagnosis[0]?.kind === "preferences" ? "Why the list is short" : summary.bands.excellent === 0 ? "Why you're not seeing excellent matches yet" : "Ways to get better matches"}</p>
      </div>
      <div className="grid divide-y divide-amber-100 md:grid-cols-3 md:divide-x md:divide-y-0">
        {summary.diagnosis.map((d) => {
          const Icon = ICON[d.kind];
          return (
            <div key={d.kind} className="space-y-2.5 p-5">
              <p className="flex items-start gap-2 text-sm font-semibold text-ink"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />{d.title}</p>
              <p className="text-sm text-slate-600">{d.detail}</p>
              <div className="flex flex-wrap gap-1.5">
                {actions(d.kind, d).map((a) => (
                  <button key={a.id} disabled={done.has(a.id) || busy !== null} onClick={() => void act(a.id, a.run, a.msg)}
                    className={cn("inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium transition", done.has(a.id) ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:text-brand-700", busy === a.id && "opacity-60")}>
                    {done.has(a.id) ? "✓" : <Plus className="h-3.5 w-3.5" />}{a.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end border-t border-amber-100 px-5 py-2.5">
        <Button variant="ghost" size="sm" onClick={() => (location.hash = "#profile")}>Edit all preferences</Button>
      </div>
    </section>
  );
}
