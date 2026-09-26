import { Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/theme";
import { cn } from "../ui";

/** Sun/moon button. Shows what you will switch to. */
export default function ThemeToggle({ className }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  const dark = resolved === "dark";
  return (
    <button onClick={toggle} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} title={dark ? "Light theme" : "Dark theme"}
      className={cn("rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-ink", className)}>
      {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
}
