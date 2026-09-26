// How the search is going: reply, interview and offer rates, days to first response, weekly activity, and which
// sources actually get answers. Small samples are labelled instead of turned into misleading percentages.
import type { ApplicationRecord, ApplicationStatus } from "../../shared/types.js";
import type { FunnelStats } from "../../shared/insights.js";

const DAY = 86_400_000;
const RESPONDED: ApplicationStatus[] = ["under_review", "shortlisted", "interview", "offer", "rejected"];
const ever = (a: ApplicationRecord, statuses: ApplicationStatus[]) => statuses.includes(a.status) || a.history.some((h) => statuses.includes(h.status));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const mondayOf = (d: Date) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; };

export function funnelStats(apps: ApplicationRecord[], now = new Date()): FunnelStats {
  const applied = apps.filter((a) => a.appliedAt || ever(a, ["applied", ...RESPONDED]));
  const responded = applied.filter((a) => ever(a, RESPONDED));
  const interviews = applied.filter((a) => ever(a, ["interview"]) || a.interviewDates.length > 0);
  const offers = applied.filter((a) => ever(a, ["offer"]));
  const rate = (n: number) => (applied.length >= 5 ? Math.round((n / applied.length) * 100) : null);

  const days = applied.flatMap((a) => {
    const start = a.appliedAt ? new Date(a.appliedAt).getTime() : NaN;
    const first = a.history.find((h) => RESPONDED.includes(h.status));
    const d = first ? (new Date(first.at).getTime() - start) / DAY : NaN;
    return Number.isFinite(d) && d >= 0 ? [d] : [];
  });

  const thisWeek = mondayOf(now).getTime();
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const start = thisWeek - (7 - i) * 7 * DAY;
    return { weekStart: new Date(start).toISOString().slice(0, 10), applied: applied.filter((a) => a.appliedAt && new Date(a.appliedAt).getTime() >= start && new Date(a.appliedAt).getTime() < start + 7 * DAY).length };
  });

  const src = new Map<string, { applied: number; responses: number }>();
  for (const a of applied) { const k = a.source || "Other"; const r = src.get(k) || { applied: 0, responses: 0 }; r.applied++; if (ever(a, RESPONDED)) r.responses++; src.set(k, r); }
  const bySource = [...src.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.applied - a.applied).slice(0, 6);

  let insight = "Apply to a few jobs and I'll show you what's working.";
  if (applied.length >= 5) {
    const rr = Math.round((responded.length / applied.length) * 100);
    if (responded.length === 0) insight = `${applied.length} applications and no replies yet. Sharpen your resume for each job, and aim a little closer to your experience level.`;
    else if (interviews.length >= 3 && offers.length === 0) insight = "You're getting interviews but no offers yet. Practise mock interviews and tighten your answers.";
    else if (rr < 15) insight = `Only ${rr}% of applications get a reply. Focus on strong matches and tailor each resume.`;
    else insight = `${rr}% of your applications get a reply, which is healthy. Keep going and keep following up.`;
  } else if (applied.length > 0) insight = `${applied.length} application${applied.length === 1 ? "" : "s"} so far. Rates appear after 5, so a couple of quiet weeks don't mislead you.`;

  return {
    applied: applied.length, responses: responded.length, interviews: interviews.length, offers: offers.length, rejected: applied.filter((a) => ever(a, ["rejected"])).length,
    responseRate: rate(responded.length), interviewRate: rate(interviews.length), offerRate: rate(offers.length),
    medianDaysToResponse: days.length >= 2 ? Math.round(median(days) * 10) / 10 : null, weekly, bySource, insight,
  };
}
