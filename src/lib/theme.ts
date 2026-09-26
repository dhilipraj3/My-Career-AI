import { useCallback, useEffect, useState } from "react";

// Theme: "system" follows the device, "dark" and "light" are the user's choice. Stored on this device only.
export type ThemeChoice = "system" | "dark" | "light";
const KEY = "mc_theme";

export const getThemeChoice = (): ThemeChoice => {
  const q = typeof location !== "undefined" ? /[?&]theme=(dark|light)/.exec(location.search)?.[1] : undefined; // ?theme=dark previews without saving
  if (q === "dark" || q === "light") return q;
  try { const v = localStorage.getItem(KEY); return v === "dark" || v === "light" ? v : "system"; } catch { return "system"; }
};
const systemDark = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches);
export const resolveTheme = (c: ThemeChoice): "dark" | "light" => (c === "system" ? (systemDark() ? "dark" : "light") : c);

export function applyTheme(c: ThemeChoice = getThemeChoice()) {
  const t = resolveTheme(c);
  document.documentElement.setAttribute("data-theme", t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#060c13" : "#0a7399");
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(getThemeChoice);
  const [resolved, setResolved] = useState(() => resolveTheme(getThemeChoice()));
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const on = () => { applyTheme(); setResolved(resolveTheme(getThemeChoice())); };
    mq?.addEventListener?.("change", on);
    return () => mq?.removeEventListener?.("change", on);
  }, []);
  const set = useCallback((c: ThemeChoice) => {
    try { if (c === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, c); } catch { /* private mode */ }
    setChoice(c); applyTheme(c); setResolved(resolveTheme(c));
  }, []);
  /** One tap flips between dark and light (and leaves "system" behind, since the user just chose). */
  const toggle = useCallback(() => set(resolved === "dark" ? "light" : "dark"), [resolved, set]);
  return { choice, resolved, set, toggle };
}
