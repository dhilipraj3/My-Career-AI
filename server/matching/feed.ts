// The honest picture behind "For you": how many matches exist per band, what's new, and — when there are no strong
// matches — why, with one-tap fixes (roles to add, cities to consider, skills that keep coming up).
import type { ApplicationRecord, CandidateProfile, FeedDiagnosis, FeedSummary, Job, JobMatch } from "../../shared/types.js";
import { getStore } from "../db/store.js";
import { roleFamily } from "../nlp/skills.js";
import { getProfile } from "../profile/service.js";
import { liveJobIds, searchJobs } from "../search/index.js";
import { scoreBand } from "./engine.js";

/** Common role titles per role family, used to suggest related roles worth targeting. */
const FAMILY_ROLES: Record<string, string[]> = {
  project_management: ["Project Manager", "Program Manager", "Delivery Manager", "Technical Project Manager", "PMO Lead", "Scrum Master"],
  product: ["Product Manager", "Product Owner", "Associate Product Manager"],
  business_analysis: ["Business Analyst", "Functional Consultant", "Product Analyst"],
  data: ["Data Analyst", "Data Engineer", "Data Scientist", "BI Developer"],
  devops: ["DevOps Engineer", "Site Reliability Engineer", "Cloud Engineer"],
  qa: ["QA Engineer", "Test Engineer", "SDET", "Automation Tester"],
  design: ["Product Designer", "UI/UX Designer", "Graphic Designer"],
  security: ["Security Engineer", "SOC Analyst", "Security Analyst"],
  software_engineering: ["Software Engineer", "Backend Developer", "Frontend Developer", "Full Stack Developer"],
  sales: ["Sales Executive", "Business Development Executive", "Account Manager", "Inside Sales"],
  marketing: ["Digital Marketing Executive", "Marketing Manager", "Content Writer", "SEO Specialist"],
  hr: ["HR Executive", "Recruiter", "Talent Acquisition Specialist", "HR Business Partner"],
  finance: ["Accountant", "Financial Analyst", "Accounts Executive"],
  operations: ["Operations Executive", "Operations Manager", "Process Associate"],
  support: ["Customer Support Executive", "Customer Success Manager", "Technical Support Engineer"],
  logistics: ["Delivery Partner", "Warehouse Associate", "Logistics Coordinator", "Driver"],
  security_facility: ["Security Guard", "Facility Executive", "Housekeeping Staff"],
  skilled_trades: ["Electrician", "Technician", "Mechanic", "Fitter"],
  healthcare: ["Staff Nurse", "Pharmacist", "Medical Representative"],
  teaching: ["Teacher", "Tutor", "Trainer"],
  hospitality: ["Chef", "Cook", "Front Office Executive", "Steward"],
  retail: ["Store Manager", "Sales Associate", "Cashier"],
};

const wantedCities = (p: CandidateProfile) => p.preferences.locations.filter((l) => !/anywhere|pan india/i.test(l));

/** Related roles with live openings in the user's cities, excluding what they already target. */
export async function suggestRoles(uid: string, p: CandidateProfile, limit = 5): Promise<Array<{ role: string; jobs: number }>> {
  const have = new Set([...p.preferences.targetRoles, p.currentRole].map((r) => r.toLowerCase()));
  // The family of what they do now / say they want is what counts; families guessed from the whole resume
  // (a side project, a tool name like "Salesforce") only fill in if that yields too few ideas.
  const primary = new Set([...p.preferences.targetRoles, p.currentRole].filter(Boolean).map(roleFamily).filter((f) => f !== "other"));
  const secondary = p.insights.jobFamilies.filter((f) => !primary.has(f));
  const fromHistory = p.experience.map((e) => e.designation.trim()).filter((d) => d.length >= 4 && d.length <= 40 && /^[A-Za-z][A-Za-z &/-]+$/.test(d) && primary.has(roleFamily(d)));
  const tiers = [[...fromHistory, ...[...primary].flatMap((f) => FAMILY_ROLES[f] || [])], secondary.flatMap((f) => FAMILY_ROLES[f] || [])];
  const cities = wantedCities(p);
  const out: Array<{ role: string; jobs: number }> = [];
  const seen = new Set(have);
  for (const tier of tiers) {
    if (out.length >= 3) break;
    const counted: Array<{ role: string; jobs: number }> = [];
    for (const role of tier) {
      if (seen.has(role.toLowerCase())) continue;
      seen.add(role.toLowerCase());
      const r = await searchJobs(uid, { q: role, cities: cities.length ? cities : undefined, pageSize: 1, sort: "relevance" });
      if (r.total > 0) counted.push({ role, jobs: r.total });
    }
    out.push(...counted.sort((a, b) => b.jobs - a.jobs));
  }
  return out.slice(0, limit);
}

export async function feedSummary(uid: string): Promise<FeedSummary> {
  const store = await getStore();
  const profile = await getProfile(uid);
  const live = await liveJobIds();
  const applied = new Set((await store.query<ApplicationRecord>("applications", { where: { uid } })).map((a) => a.jobId));
  const matches = (await store.query<JobMatch>("matches", { where: { uid } })).filter((m) => !m.hidden && live.has(m.jobId) && !applied.has(m.jobId));
  const usable = matches.filter((m) => !m.hardFailures.length);
  const bands = { excellent: 0, good: 0, fair: 0, low: 0 };
  for (const m of usable) bands[scoreBand(m.score)]++;
  const since = profile?.lastSeenFeedAt || "";
  // On a first visit everything is "new", which says nothing; only count once there is a previous visit.
  const newSinceLastVisit = since ? usable.filter((m) => scoreBand(m.score) !== "low" && m.createdAt > since).length : 0;

  const diagnosis: FeedDiagnosis[] = [];
  let roleSuggestions: Array<{ role: string; jobs: number }> = [];
  // Jobs the person's own preferences rule out. If that is most of what we found, say so: an empty screen with the wrong reason is worse than a short list.
  const blocked = matches.filter((m) => m.hardFailures.length);
  if (profile?.status === "ready" && blocked.length >= 3 && blocked.length >= usable.length) {
    const types = new Map<string, number>(), modes = new Map<string, number>();
    let pay = 0;
    for (const m of blocked) {
      for (const f of m.hardFailures) {
        const t = /^Employment type is (.+)$/.exec(f)?.[1], w = /^Work mode is (w+);/.exec(f)?.[1];
        if (t) types.set(t.replace(" ", "_"), (types.get(t.replace(" ", "_")) || 0) + 1);
        if (w) modes.set(w, (modes.get(w) || 0) + 1);
        if (/^Salary up to/.test(f)) pay++;
      }
    }
    const parts = [
      types.size ? `job type (${[...types.entries()].map(([t, n]) => `${t.replace("_", " ")}: ${n}`).join(", ")})` : "",
      modes.size ? `work mode (${[...modes.entries()].map(([t, n]) => `${t}: ${n}`).join(", ")})` : "",
      pay ? `minimum pay (${pay})` : "",
    ].filter(Boolean);
    if (parts.length) diagnosis.push({
      kind: "preferences", hidden: blocked.length, title: `${blocked.length} jobs are hidden by your preferences`,
      detail: `They don't fit your ${parts.join(", ")}. Add one back to see them.`,
      employmentTypes: [...types.keys()], workModes: [...modes.keys()],
    });
  }
  if (profile?.status === "ready" && bands.excellent < 3 && usable.length > 0) {
    // Why so few strong matches? Look at what capped the scores.
    const outside = usable.filter((m) => m.breakdown.location < 50 && m.breakdown.skills >= 60 && m.breakdown.roleAlignment >= 50);
    if (outside.length >= 3) {
      const byCity = new Map<string, number>();
      for (const m of outside) {
        const j = await store.get<Job>("jobs", m.jobId);
        const c = j?.cities?.[0] || j?.city;
        if (c) byCity.set(c, (byCity.get(c) || 0) + 1);
      }
      const top = [...byCity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      diagnosis.push({
        kind: "location", title: `${outside.length} good-fit jobs are outside ${wantedCities(profile).join(", ") || "your cities"}`,
        detail: `Mostly in ${top.map(([c, n]) => `${c} (${n})`).join(", ")}. Add a city, say you'd relocate, or include remote work to see them as strong matches.`,
        cities: top.map(([c]) => c),
      });
    }
    if (profile.preferences.targetRoles.length <= 1) {
      roleSuggestions = await suggestRoles(uid, profile);
      if (roleSuggestions.length) diagnosis.push({
        kind: "roles", title: profile.preferences.targetRoles.length ? `You're only targeting "${profile.preferences.targetRoles[0]}"` : "You haven't chosen target roles yet",
        detail: "People with your background also get hired as these. Add the ones you'd take:",
      });
    }
    const missing = new Map<string, number>();
    for (const m of usable.filter((x) => x.breakdown.roleAlignment >= 60)) for (const s of m.missingSkills.slice(0, 4)) missing.set(s, (missing.get(s) || 0) + 1);
    const topMissing = [...missing.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (topMissing.length) diagnosis.push({
      kind: "skills", title: "Skills that keep coming up in jobs you fit",
      detail: `${topMissing.map(([s, n]) => `${s} (${n} jobs)`).join(", ")}. If you have any of these, add them to your profile — each one lifts every job that asks for it.`,
      skills: topMissing.map(([s]) => s),
    });
  }
  return {
    total: usable.filter((m) => scoreBand(m.score) !== "low").length, bands, newSinceLastVisit, lastSeenAt: since || undefined,
    saved: matches.filter((m) => m.saved).length, belowFair: bands.low, diagnosis, roleSuggestions,
  };
}

export async function markFeedSeen(uid: string): Promise<void> {
  const store = await getStore();
  if (await store.get("profiles", uid)) await store.update<CandidateProfile>("profiles", uid, { lastSeenFeedAt: new Date().toISOString() });
}
