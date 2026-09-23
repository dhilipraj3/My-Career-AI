import { CheckCircle2, ExternalLink, KeyRound, ShieldAlert } from "lucide-react";
import { useState } from "react";
import type { AiState } from "../App";
import { api, errMsg } from "../lib/api";
import { track } from "../lib/analytics";
import { Button, ErrorNote, Modal, useToast } from "../ui";

const AI_STUDIO_URL = "https://aistudio.google.com/app/apikey";

const STEPS = [
  { title: "Open Google AI Studio", body: <>Open <a href={AI_STUDIO_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 underline underline-offset-2">aistudio.google.com/app/apikey</a> and sign in with the <strong>same Google account</strong> you use here. Accept the terms if asked.</> },
  { title: "Create your free key", body: <>Click <strong>“Create API key”</strong>. If it asks for a project, choose any (or let it create one). Then click <strong>Copy</strong> to copy the whole key.</> },
  { title: "Paste it here and test", body: <>Paste the key below and press <strong>Save & test</strong>. We check it works before saving it.</> },
];

/** Guided flow for a user to add their own free Google AI Studio key. */
export default function AiKeyWizard({ open, onClose, ai, onChanged }: { open: boolean; onClose: () => void; ai: AiState; onChanged: (ai: AiState) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const toast = useToast();

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ ai: AiState }>("/me/ai-key", { method: "PUT", body: { key: key.trim() } });
      setKey(""); onChanged(r.ai); track("ai_key_added"); toast("success", "Your AI key works. Smart assistant unlocked."); onClose();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError(null);
    try { const r = await api<{ ai: AiState }>("/me/ai-key", { method: "DELETE" }); onChanged(r.ai); toast("info", "Your AI key was removed."); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={<span className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-brand-600" />Unlock unlimited AI — free</span>}
      footer={ai.ownKey ? <Button variant="secondary" onClick={onClose}>Done</Button> : <>
        <Button variant="ghost" onClick={onClose}>Not now</Button>
        <Button loading={busy} disabled={key.trim().length < 20 || !agree} onClick={save}>Save & test</Button>
      </>}>
      {ai.ownKey ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <p className="font-semibold">Your own key is connected (…{ai.ownKey.last4})</p>
              <p className="mt-0.5">{ai.ownKey.status === "ok" ? "All your AI requests use it first, so you're not limited by the shared daily allowance." : ai.ownKey.lastError}</p>
            </div>
          </div>
          <ErrorNote error={error} />
          <Button variant="secondary" loading={busy} onClick={remove}>Remove my key</Button>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-slate-600">Everyone gets a small free AI allowance each day. Add your own free Google key and the assistant, resume reading and tailoring use <strong>your</strong> free quota instead — no daily limit from us. It takes about a minute.</p>
          <ol className="space-y-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
                <div className="text-sm"><p className="font-semibold text-ink">{s.title}</p><p className="mt-0.5 text-slate-600">{s.body}</p></div>
              </li>
            ))}
          </ol>
          <a href={AI_STUDIO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-50 px-4 text-sm font-medium text-brand-700 hover:bg-brand-100">
            Open Google AI Studio <ExternalLink className="h-4 w-4" />
          </a>
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your Google AI Studio key" autoComplete="off" spellCheck={false}
            className="h-11 w-full rounded-xl border border-slate-300 px-3 font-mono text-sm focus:border-brand-500 focus:outline-none" />
          <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p>Your key is encrypted and never shown again, and you can remove it any time. <strong>Please note:</strong> Google may use data sent through <em>free</em> AI Studio keys to improve its products. Your resume and job questions would go through this key.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="h-4 w-4 accent-brand-600" />I understand and want to use my own key</label>
          <ErrorNote error={error} />
        </div>
      )}
    </Modal>
  );
}
