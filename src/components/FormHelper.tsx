import { Check, Copy, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Card, cn, useToast } from "../ui";

interface Field { id: string; label: string; value: string; known: boolean; hint?: string }

/** Copy-ready answers for the questions almost every job form asks. Nothing is submitted for the user. */
export default function FormHelper({ jobId }: { jobId: string }) {
  const toast = useToast();
  const [fields, setFields] = useState<Field[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [sharpening, setSharpening] = useState(false);
  useEffect(() => { api<{ fields: Field[] }>(`/jobs/${jobId}/form-helper`).then((r) => setFields(r.fields)).catch(() => setFields([])); }, [jobId]);
  const sharpen = async () => {
    setSharpening(true);
    try {
      const r = await api<{ text: string }>(`/jobs/${jobId}/why-this-role`, { method: "POST" });
      setFields((fs) => fs && fs.map((f) => (f.id === "whyThisRole" ? { ...f, value: r.text, known: true } : f)));
    } catch {
      toast("error", "Couldn't generate that right now");
    } finally {
      setSharpening(false);
    }
  };
  if (!fields?.length) return null;
  const known = fields.filter((f) => f.known);
  const copy = (f: Field) => { void navigator.clipboard.writeText(f.value); setCopied(f.id); toast("success", `${f.label} copied`); setTimeout(() => setCopied((c) => (c === f.id ? null : c)), 1500); };
  const copyAll = () => {
    void navigator.clipboard.writeText(known.map((f) => `${f.label}: ${f.value}`).join("\n"));
    setCopied("__all__");
    toast("success", "All fields copied");
    setTimeout(() => setCopied((c) => (c === "__all__" ? null : c)), 1500);
  };
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold">Application form helper</h2><p className="text-sm text-slate-500">Copy these into the employer's form. Empty ones are for you to fill in: I never guess your pay or details.</p></div>
        {known.length > 1 && (
          <button onClick={copyAll} className={cn("flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium", copied === "__all__" ? "border-emerald-200 text-emerald-600" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
            {copied === "__all__" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            Copy all
          </button>
        )}
      </div>
      <dl className="divide-y divide-slate-100">
        {fields.map((f) => (
          <div key={f.id} className="flex items-start gap-3 py-2.5">
            <dt className="w-40 shrink-0 text-xs font-medium text-slate-500 sm:w-48">{f.label}</dt>
            <dd className="min-w-0 flex-1 text-sm">{f.known ? <span className="break-words text-ink">{f.value}</span> : <span className="text-slate-400">{f.hint || "Not in your profile yet"}</span>}{f.known && f.hint && <span className="mt-0.5 block text-xs text-slate-400">{f.hint}</span>}</dd>
            {f.id === "whyThisRole" && (
              <button aria-label="Generate a sharper version" title="Generate a sharper, specific version" onClick={sharpen} disabled={sharpening} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50">
                <Sparkles className={cn("h-4 w-4", sharpening && "animate-pulse")} />
              </button>
            )}
            {f.known && <button aria-label={`Copy ${f.label}`} onClick={() => copy(f)} className={cn("rounded-lg p-1.5", copied === f.id ? "text-emerald-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700")}>{copied === f.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button>}
          </div>
        ))}
      </dl>
    </Card>
  );
}
