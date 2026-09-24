// Role discovery: which roles could this person target, how big is each market, what does it pay, and how well do
// they already fit? Built from live jobs, so every number is real.
import type { CandidateProfile, JobSearchResult } from "../../shared/types.js";
import type { RolePath } from "../../shared/career.js";
import { feedSummary } from "../matching/feed.js";
import { displayName } from "../nlp/skills.js";
import { searchJobs } from "../search/index.js";

const PUBLIC = "__public__";

/** Neighbouring roles people commonly move into, keyed by words in the current/target role. */
const ADJACENT: Array<[RegExp, string[]]> = [
  [/project manag|program manag|delivery manag/i, ["Program Manager", "Delivery Manager", "Scrum Master", "Product Owner"]],
  [/scrum|agile coach/i, ["Project Manager", "Agile Coach", "Product Owner"]],
  [/product manag|product owner/i, ["Product Owner", "Program Manager", "Business Analyst"]],
  [/software|developer|programmer|engineer.*(backend|frontend|full)/i, ["Full Stack Developer", "Backend Developer", "DevOps Engineer", "QA Automation Engineer"]],
  [/devops|cloud|sre|site reliab/i, ["Cloud Engineer", "Site Reliability Engineer", "Platform Engineer"]],
  [/data analyst|business intelligence|bi\b|mis/i, ["Business Analyst", "Data Engineer", "Product Analyst", "BI Developer"]],
  [/data scien|machine learning|ml\b|ai engineer/i, ["Machine Learning Engineer", "Data Engineer", "Data Analyst"]],
  [/business analyst/i, ["Product Analyst", "Product Owner", "Data Analyst", "Implementation Consultant"]],
  [/qa|test|quality assurance/i, ["QA Automation Engineer", "Business Analyst", "Implementation Consultant"]],
  [/support|help ?desk|service desk|customer service|bpo|call cent/i, ["Customer Success Executive", "Implementation Consultant", "QA Tester", "Business Analyst"]],
  [/sales|business develop|account (manag|exec)/i, ["Business Development Executive", "Account Manager", "Inside Sales", "Customer Success Manager"]],
  [/marketing|seo|social media|content/i, ["Digital Marketing Executive", "Content Writer", "Brand Executive", "Performance Marketing"]],
  [/account|finance|audit|tax|gst|bookkeep/i, ["Accounts Executive", "Finance Analyst", "Audit Associate", "GST Consultant"]],
  [/\bhr\b|human resource|recruit|talent/i, ["Recruiter", "HR Generalist", "Talent Acquisition Specialist"]],
  [/teach|tutor|faculty|lecturer|trainer/i, ["Corporate Trainer", "Instructional Designer", "Academic Counsellor", "Content Writer"]],
  [/nurse|nursing/i, ["Medical Coder", "Patient Care Coordinator", "Clinical Research Associate"]],
  [/electric/i, ["Maintenance Technician", "Solar Technician", "Electrical Supervisor", "HVAC Technician"]],
  [/mechanic|technician|fitter|machin/i, ["Maintenance Technician", "Service Engineer", "Production Supervisor"]],
  [/deliver|rider|courier/i, ["Warehouse Associate", "Driver", "Store Associate", "Field Executive"]],
  [/driver/i, ["Delivery Executive", "Logistics Coordinator", "Fleet Supervisor"]],
  [/retail|store|cashier|shop/i, ["Store Manager", "Sales Associate", "Customer Service Executive"]],
  [/design|ui|ux|graphic/i, ["UI/UX Designer", "Product Designer", "Visual Designer"]],
  [/operations|ops\b|admin|office/i, ["Operations Executive", "Office Administrator", "Operations Manager"]],
];

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const round1 = (n: number) => Math.round(n * 10) / 10;

async function market(role: string, cities: string[]): Promise<{ india: JobSearchResult; near: number }> {
  const india = await searchJobs(PUBLIC, { q: role, pageSize: 50, sort: "relevance" });
  const wantsAnywhere = !cities.length || cities.some((c) => /anywhere/i.test(c));
  const near = wantsAnywhere ? india.total : (await searchJobs(PUBLIC, { q: role, cities: cities.filter((c) => !/anywhere/i.test(c)), pageSize: 1 })).total;
  return { india, near };
}

export async function rolePaths(p: CandidateProfile, limit = 4): Promise<{ paths: RolePath[]; cities: string[] }> {
  const pr = p.preferences;
  const candidates: Array<{ role: string; source: RolePath["source"] }> = [];
  const add = (role: string, source: RolePath["source"]) => {
    const r = role.trim();
    if (r && !candidates.some((c) => c.role.toLowerCase() === r.toLowerCase())) candidates.push({ role: r, source });
  };
  for (const r of pr.targetRoles) add(r, "your target");
  if (p.currentRole) add(p.currentRole, "your current role");
  for (const r of p.insights.targetRoleSuggestions) add(r, "suggested");
  const summary = await feedSummary(p.uid).catch(() => null);
  for (const r of summary?.roleSuggestions || []) add(r.role, "suggested");
  const seeds = [...pr.targetRoles, p.currentRole].filter(Boolean).join(" ");
  for (const [re, roles] of ADJACENT) if (re.test(seeds)) for (const r of roles) add(r, "similar role");

  const mySkills = new Set(p.skills.filter((s) => s.source !== "ai_derived").map((s) => s.key));
  const cities = pr.locations.length ? pr.locations : p.city ? [p.city] : [];
  const out: RolePath[] = [];
  for (const c of candidates.slice(0, 9)) {
    const { india, near } = await market(c.role, cities);
    if (!india.total && c.source === "similar role") continue;
    const pays = india.hits.flatMap(({ job }) => (job.salaryMinLPA || job.salaryMaxLPA ? [((job.salaryMinLPA ?? job.salaryMaxLPA!) + (job.salaryMaxLPA ?? job.salaryMinLPA!)) / 2] : [])).filter((n) => n > 0 && n < 500);
    const skillCounts = new Map<string, number>();
    for (const { job } of india.hits) for (const s of job.skills) skillCounts.set(s, (skillCounts.get(s) || 0) + 1);
    const common = [...skillCounts.entries()].filter(([, n]) => n >= Math.max(2, india.hits.length * 0.15)).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k);
    const have = common.filter((k) => mySkills.has(k));
    const missing = common.filter((k) => !mySkills.has(k));
    let note: string | undefined;
    const where = cities.filter((x) => !/anywhere/i.test(x)).join(", ");
    if (india.total === 0) note = "No live openings right now — I'll tell you when some appear.";
    else if (where && near < 5 && india.total >= 10) note = `Only ${near} opening${near === 1 ? "" : "s"} in ${where} right now, but ${india.total.toLocaleString("en-IN")} across India${india.facets.workMode.remote ? ` (${india.facets.workMode.remote} remote)` : ""}. Consider remote work or relocating.`;
    out.push({
      role: c.role, source: c.source, jobsIndia: india.total, jobsNearYou: near,
      salaryLPA: pays.length >= 3 ? { low: round1(pct(pays, 0.25)), median: round1(median(pays)), high: round1(pct(pays, 0.75)), samples: pays.length } : undefined,
      fitPct: common.length ? Math.round((have.length / common.length) * 100) : 0,
      have: have.map((k) => displayName(k)), missing: missing.slice(0, 6).map((k) => displayName(k)), note,
      targeted: pr.targetRoles.some((r) => r.toLowerCase() === c.role.toLowerCase()),
    });
  }
  // Targets first, then the best combination of fit and market size.
  const rank = (r: RolePath) => (r.targeted ? 1e6 : 0) + r.fitPct * 10 + Math.min(500, r.jobsNearYou);
  return { paths: out.sort((a, b) => rank(b) - rank(a)).slice(0, Math.max(limit, out.filter((r) => r.targeted).length)), cities };
}
