import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { cn, timeAgo } from "../ui";

interface SyncStatus { lastSyncAt: string | null; nextRunAt: string | null; paused: boolean; running: boolean; liveJobs: number }

const until = (iso: string) => {
  const min = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  return min <= 0 ? "shortly" : min < 60 ? `in ${min} min` : `in ${Math.round(min / 60)} h`;
};

/** "Jobs updated 12 min ago · next check in 48 min" — so people can trust the listings are live. */
export default function SyncBadge({ className }: { className?: string }) {
  const [s, setS] = useState<SyncStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api<SyncStatus>("/sync-status").then((d) => alive && setS(d)).catch(() => undefined);
    void load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!s) return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-slate-500", className)} title={`${s.liveJobs.toLocaleString("en-IN")} live jobs`}>
      <RefreshCw className={cn("h-3.5 w-3.5", s.running && "animate-spin text-brand-600")} aria-hidden />
      {s.running ? "Checking for new jobs now…" : (
        <>
          {s.lastSyncAt ? `Jobs updated ${timeAgo(s.lastSyncAt)}` : "Jobs not synced yet"}
          {!s.paused && s.nextRunAt && ` · next check ${until(s.nextRunAt)}`}
        </>
      )}
    </span>
  );
}
