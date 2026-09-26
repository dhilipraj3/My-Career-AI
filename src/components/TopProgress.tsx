import { useEffect, useState } from "react";
import { useLoading } from "../lib/api";

/** A thin bar across the top while data loads. Waits 150 ms, so quick answers never flash it. */
export default function TopProgress() {
  const loading = useLoading();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!loading) { const t = setTimeout(() => setShown(false), 200); return () => clearTimeout(t); }
    const t = setTimeout(() => setShown(true), 150);
    return () => clearTimeout(t);
  }, [loading]);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-0.5 overflow-hidden">
      <div className={shown ? "top-progress h-full w-1/3 bg-gradient-to-r from-brand-400 via-accent-400 to-gold-400" : "hidden"} />
    </div>
  );
}
