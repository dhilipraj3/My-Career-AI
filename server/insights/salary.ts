// Salary benchmarks from live postings: what employers are actually offering for a role, and how many postings say so.
import type { SalaryBenchmark } from "../../shared/interview.js";
import { searchJobs } from "../search/index.js";

const PUBLIC = "__public__";
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };

/** Annual pay in LPA for one posting, or null when it doesn't state one (or the figure isn't a plausible annual salary). */
export function midLPA(min?: number, max?: number): number | null {
  const lo = min ?? max, hi = max ?? min;
  if (!lo || !hi) return null;
  const mid = (lo + hi) / 2;
  return mid > 0 && mid < 500 ? mid : null;
}

/** Needs at least 3 postings with a stated salary: fewer would make the numbers meaningless. */
export async function salaryBenchmark(role: string, city?: string): Promise<SalaryBenchmark | null> {
  const attempt = async (cities?: string[]) => {
    const r = await searchJobs(PUBLIC, { q: role, ...(cities ? { cities } : {}), pageSize: 50, sort: "relevance" });
    const pays = r.hits.flatMap(({ job }) => { const m = midLPA(job.salaryMinLPA, job.salaryMaxLPA); return m ? [m] : []; });
    return { pays, total: r.total };
  };
  if (city && !/anywhere|remote/i.test(city)) {
    const c = await attempt([city]);
    if (c.pays.length >= 3) return { role, city, scope: "city", lowLPA: round1(pct(c.pays, 0.25)), medianLPA: round1(pct(c.pays, 0.5)), highLPA: round1(pct(c.pays, 0.75)), samples: c.pays.length, postings: c.total };
  }
  const a = await attempt();
  if (a.pays.length < 3) return null;
  return { role, city: undefined, scope: "india", lowLPA: round1(pct(a.pays, 0.25)), medianLPA: round1(pct(a.pays, 0.5)), highLPA: round1(pct(a.pays, 0.75)), samples: a.pays.length, postings: a.total };
}
