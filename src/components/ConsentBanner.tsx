import { BarChart3 } from "lucide-react";
import { useEffect, useState } from "react";
import { getConsent, setConsent } from "../lib/analytics";
import { Button } from "../ui";

/** Asks once whether we may use Google Analytics. Nothing is collected until the visitor says yes. */
export default function ConsentBanner() {
  const [show, setShow] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => {
    // Let the page settle first so the banner doesn't compete with the first impression.
    const t = setTimeout(() => setShow(getConsent() === null), 1500);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  const choose = (granted: boolean) => { setConsent(granted); setShow(false); };
  return (
    <div role="dialog" aria-live="polite" aria-label="Analytics consent"
      className="glass-strong fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-[60] mx-auto max-w-md rounded-2xl border p-4 animate-slide-up sm:left-4 sm:right-auto sm:mx-0 lg:bottom-4 lg:left-[272px]">
      <div className="flex gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><BarChart3 className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-ink">Help us improve MyCareer.AI?</p>
          <p className="mt-0.5 text-slate-600">
            We'd like to use Google Analytics to see which features help people get placed. No name, email or resume details are ever sent.
            {!more && <> <button className="font-medium text-brand-600 hover:underline" onClick={() => setMore(true)}>Details</button></>}
          </p>
          {more && (
            <p className="mt-1.5 text-xs text-slate-500">
              We count things like pages opened, searches, jobs saved and applications started, with coarse details (for example a job category or match band).
              Google sets analytics cookies on this site. You can change your mind any time in Settings.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => choose(true)}>Allow</Button>
            <Button size="sm" variant="secondary" onClick={() => choose(false)}>No thanks</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
