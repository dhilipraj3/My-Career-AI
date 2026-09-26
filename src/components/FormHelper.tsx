import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Card, cn, useToast } from "../ui";

interface Field { id: string; label: string; value: string; known: boolean; hint?: string }

/** Copy-ready answers for the questions almost every job form asks. Nothing is submitted for the user. */
export default function FormHelper({ jobId }: { jobId: string }) {
  const toast = useToast();
  const [fields, setFields] = useState<Field[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { api<{ fields: Field[] }>(`/jobs/${jobId}/form-helper`).then((r) => setFields(r.fields)).catch(() => setFields([])); }, [jobId]);
  if (!fields?.length) return null;
  const copy = (f: Field) => { void navigator.clipboard.writeText(f.value); setCopied(f.id); toast("success", `${f.label} copied`); setTimeout(() => setCopied((c) => (c === f.id ? null : c)), 1500); };
  return (
    <Card className="space-y-3">
      <div><h2 className="text-lg font-semibold">Application form helper</h2><p className="text-sm text-slate-500">Copy these into the employer's form. Empty ones are for you to fill in: I never guess your pay or details.</p></div>
      <dl className="divide-y divide-slate-100">
        {fields.map((f) => (
          <div key={f.id} className="flex items-start gap-3 py-2.5">
            <dt className="w-40 shrink-0 text-xs font-medium text-slate-500 sm:w-48">{f.label}</dt>
            <dd className="min-w-0 flex-1 text-sm">{f.known ? <span className="break-words text-ink">{f.value}</span> : <span className="text-slate-400">{f.hint || "Not in your profile yet"}</span>}{f.known && f.hint && <span className="mt-0.5 block text-xs text-slate-400">{f.hint}</span>}</dd>
            {f.known && <button aria-label={`Copy ${f.label}`} onClick={() => copy(f)} className={cn("rounded-lg p-1.5", copied === f.id ? "text-emerald-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700")}>{copied === f.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button>}
          </div>
        ))}
      </dl>
    </Card>
  );
}
