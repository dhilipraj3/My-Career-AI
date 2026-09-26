import { useEffect } from "react";

const typing = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return Boolean(t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)));
};

/**
 * Keyboard shortcuts for lists of job cards: J / K move, Enter or O opens, S saves, H hides (opens the "why" menu).
 * Works on the cards already on screen (they carry data-job-id and data-action buttons), so any list can use it.
 * Shortcuts never fire while typing, with a modifier key held, or while a window is open.
 */
export function useJobListKeys(open: (jobId: string) => void, help?: (text: string) => void) {
  useEffect(() => {
    const cards = () => [...document.querySelectorAll<HTMLElement>("[data-job-id]")];
    const setActive = (el: HTMLElement | undefined) => {
      if (!el) return;
      cards().forEach((c) => c.removeAttribute("data-active"));
      el.setAttribute("data-active", "true");
      el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    };
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector("[role=dialog]")) return;
      const list = cards();
      if (!list.length) return;
      const i = list.findIndex((c) => c.getAttribute("data-active") === "true");
      const key = e.key.toLowerCase();
      if (key === "j") { e.preventDefault(); setActive(list[Math.min(list.length - 1, i + 1)]); }
      else if (key === "k") { e.preventDefault(); setActive(list[Math.max(0, i - 1)]); }
      else if (i >= 0 && (key === "enter" || key === "o")) { if (key === "o" || document.activeElement === document.body) { e.preventDefault(); open(list[i].getAttribute("data-job-id")!); } }
      else if (i >= 0 && (key === "s" || key === "h")) { e.preventDefault(); list[i].querySelector<HTMLElement>(`[data-action=${key === "s" ? "save" : "hide"}]`)?.click(); }
      else if (key === "?") help?.("Keyboard: J / K move · Enter opens · S saves · H hides");
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [open, help]);
}
