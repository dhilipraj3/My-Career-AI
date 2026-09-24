import { Check, Compass, MapPin, Target, TrendingUp, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { RolePath } from "@shared/career";
import { track } from "../lib/analytics";
import { api, errMsg } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Badge, Button, Card, ErrorNote, Skeleton, cn, useToast } from "../ui";

const SOURCE_LABEL: Record<RolePath["source"], string> = { "your target": "Your target", "your current role": "Current role", suggested: "Suggested for you", "similar role": "Similar role" };

/** Role discovery: roles this person could target, with live openings, typical pay and skill fit. */
export default function RolePaths({ onChanged }: { onChanged?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [data, setData] = useState<{ paths: RolePath[]; cities: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await api("/career/role-paths")); } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function target(role: string, on: boolean) {
    setBusy(role);
    try {
      await api("/career/role-paths/target", { body: { role, target: on } });
      if (on) { track("role_targeted", { source: data?.paths.find((p) => p.role === role)?.source }); toast("success", `Now targeting ${role} — I'll rescore your matches.`); }
      await load(); onChanged?.();
    } catch (e) { toast("error", errMsg(e)); } finally { setBusy(null); }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink"><Compass className="h-5 w-5 text-brand-600" />{t("rp.title")}</h2>
        <p className="text-sm text-slate-600">{t("rp.sub")}</p>
      </div>
      <ErrorNote error={error} />
      {!data ? <div className="grid gap-3 md:grid-cols-2">{[0, 1].map((i) => <Card key={i} className="space-y-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></Card>)}</div> : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.paths.map((p) => (
            <Card key={p.role} className={cn("flex flex-col gap-3", p.targeted && "ring-2 ring-brand-200")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-display text-base font-bold text-ink">{p.role}</p>
                  <Badge tone={p.targeted ? "brand" : p.source === "similar role" ? "sky" : "slate"} className="mt-1">{SOURCE_LABEL[p.source]}</Badge>
                </div>
                {p.fitPct > 0 && (
                  <div className="text-right">
                    <p className={cn("font-display text-xl font-bold tabular-nums", p.fitPct >= 60 ? "text-emerald-600" : p.fitPct >= 35 ? "text-brand-600" : "text-amber-600")}>{p.fitPct}%</p>
                    <p className="text-[11px] text-slate-500">{t("rp.fit")}</p>
                  </div>
                )}
              </div>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-50 p-2"><dt className="flex items-center justify-center gap-1 text-[11px] text-slate-500"><TrendingUp className="h-3 w-3" />India</dt><dd className="font-semibold tabular-nums text-ink">{p.jobsIndia.toLocaleString("en-IN")}</dd></div>
                <div className="rounded-xl bg-slate-50 p-2"><dt className="flex items-center justify-center gap-1 text-[11px] text-slate-500"><MapPin className="h-3 w-3" />{t("rp.near")}</dt><dd className="font-semibold tabular-nums text-ink">{p.jobsNearYou.toLocaleString("en-IN")}</dd></div>
                <div className="rounded-xl bg-slate-50 p-2"><dt className="flex items-center justify-center gap-1 text-[11px] text-slate-500"><Wallet className="h-3 w-3" />{t("rp.pay")}</dt><dd className="font-semibold text-ink">{p.salaryLPA ? `₹${p.salaryLPA.low}–${p.salaryLPA.high} L` : "—"}</dd></div>
              </dl>
              {p.have.length > 0 && <p className="text-xs text-slate-600"><span className="font-semibold text-emerald-700">{t("rp.have")}:</span> {p.have.slice(0, 6).join(", ")}</p>}
              {p.missing.length > 0 && <p className="text-xs text-slate-600"><span className="font-semibold text-amber-700">{t("rp.missing")}:</span> {p.missing.join(", ")}</p>}
              {p.note && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{p.note}</p>}
              <div className="mt-auto">
                {p.targeted
                  ? <Button size="sm" variant="secondary" loading={busy === p.role} onClick={() => void target(p.role, false)}><Check className="h-4 w-4 text-emerald-600" />{t("rp.targeted")}</Button>
                  : <Button size="sm" loading={busy === p.role} onClick={() => void target(p.role, true)}><Target className="h-4 w-4" />{t("rp.target")}</Button>}
              </div>
            </Card>
          ))}
          {data.paths.length === 0 && <Card className="text-sm text-slate-600 md:col-span-2">Add your current role or a target role and I'll map out paths for you.</Card>}
        </div>
      )}
    </section>
  );
}
