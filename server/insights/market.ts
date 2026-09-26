// Market pulse for the person's target role (and city): openings, week-on-week movement, remote/hybrid split, skills
// employers ask for, who is hiring, and pay. Everything comes from live postings.
import type { CandidateProfile } from "../../shared/types.js";
import type { MarketPulse } from "../../shared/insights.js";
import { displayName } from "../nlp/skills.js";
import { searchJobs } from "../search/index.js";
import { salaryBenchmark } from "./salary.js";

const PUBLIC = "__public__";

export async function marketPulse(p: CandidateProfile, override?: { role?: string; city?: string }): Promise<MarketPulse | null> {
  const role = (override?.role || p.preferences.targetRoles[0] || p.currentRole || "").trim();
  if (!role) return null;
  const rawCity = override?.city ?? (p.preferences.locations.find((c) => !/anywhere|remote/i.test(c)) || p.city);
  const city = rawCity && !/anywhere|remote/i.test(rawCity) ? rawCity : undefined;

  const india = await searchJobs(PUBLIC, { q: role, pageSize: 50, sort: "relevance" });
  const near = city ? await searchJobs(PUBLIC, { q: role, cities: [city], pageSize: 1 }) : null;
  const w1 = await searchJobs(PUBLIC, { q: role, pageSize: 1, postedWithinDays: 7 });
  const w2 = await searchJobs(PUBLIC, { q: role, pageSize: 1, postedWithinDays: 14 });

  const skills = new Map<string, number>(), companies = new Map<string, number>();
  for (const { job } of india.hits) {
    for (const k of job.skills) skills.set(k, (skills.get(k) || 0) + 1);
    companies.set(job.company, (companies.get(job.company) || 0) + 1);
  }
  const top = <T,>(m: Map<string, number>, name: (k: string) => T, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, jobs]) => ({ ...(name(k) as object), jobs }));
  const wm = india.facets.workMode;
  const sal = await salaryBenchmark(role, city);
  return {
    role, city, openings: near ? near.total : india.total, openingsInIndia: india.total,
    newThisWeek: w1.total, previousWeek: Math.max(0, w2.total - w1.total),
    workMode: { remote: wm.remote || 0, hybrid: wm.hybrid || 0, onsite: wm.onsite || 0 },
    topSkills: top(skills, (k) => ({ skill: displayName(k) }), 8) as MarketPulse["topSkills"],
    topCompanies: top(companies, (c) => ({ company: c }), 6) as MarketPulse["topCompanies"],
    salary: sal ? { lowLPA: sal.lowLPA, medianLPA: sal.medianLPA, highLPA: sal.highLPA, samples: sal.samples, scope: sal.scope } : null,
  };
}
