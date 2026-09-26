// One way to say things everywhere in the app, so the same fact never reads differently on two screens.

/** Whole years, rounded down: 12.3 → 12, 0.6 → 0. Used for every display and every claim about experience. */
export const wholeYears = (years: number | undefined | null): number => Math.max(0, Math.floor(Number(years) || 0));

/**
 * Total experience as people say it: "12 years", "1 year", "Less than a year", "Fresher".
 * `fresher` is true when the person told us they have no work experience.
 */
export function experienceText(years: number | undefined | null, opts: { fresher?: boolean; short?: boolean } = {}): string {
  const y = Number(years) || 0;
  if (y <= 0) return opts.fresher === false ? "" : "Fresher";
  if (y < 1) return "Less than a year";
  const n = wholeYears(y);
  return opts.short ? `${n} yr${n === 1 ? "" : "s"}` : `${n} year${n === 1 ? "" : "s"}`;
}

/** The name to greet someone by: "K. Priya" → "Priya" (initials are skipped), "Priya Sharma" → "Priya". One rule for the whole app. */
export function firstName(fullName: string): string {
  const parts = (fullName || "").split(/\s+/).filter(Boolean);
  return parts.find((p) => p.replace(/\./g, "").length > 2) || parts[0] || "";
}
