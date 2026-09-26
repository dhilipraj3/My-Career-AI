// Placement companion (Phase 2): where the user is in their search, what to do today, a weekly plan, and an honest
// activity timeline. Everything here is derived from real data (applications, matches, audit log) — nothing invented.
import type { ApplicationRecord, CandidateProfile } from "../../shared/types.js";
import { JOURNEY_STAGES, type ActivityItem, type ApplicationPulse, type Journey, type JourneyStage, type NextAction, type Placement, type PlanGoal, type WeeklyPlan } from "../../shared/career.js";
import { getUserKey } from "../ai/keys.js";
import { listApplications } from "../applications/service.js";
import { audit } from "../audit.js";
import { understand } from "../career/understanding.js";
import { resumeHealth } from "../career/resume.js";
import { getStore } from "../db/store.js";
import { feedSummary } from "../matching/feed.js";
import { getProfile, saveProfile } from "../profile/service.js";

interface AuditRecord { id: string; uid: string; action: string; actor: "user" | "agent" | "system"; at: string }
const DAY = 86_400_000;
const ACTIVE = ["preparing", "applied", "under_review", "shortlisted", "interview", "offer"];
const PAST_APPLIED = ["under_review", "shortlisted", "interview", "offer", "rejected"];

export const placementOf = async (uid: string): Promise<Placement | null> => (await getStore()).get<Placement>("placements", uid);

export function pulseOf(apps: ApplicationRecord[], now = Date.now()): ApplicationPulse {
  const applied = apps.filter((a) => a.appliedAt || ["applied", ...PAST_APPLIED].includes(a.status));
  const responses = applied.filter((a) => PAST_APPLIED.includes(a.status));
  const interviews = apps.filter((a) => a.status === "interview" || a.interviewDates.length > 0 || a.history.some((h) => h.status === "interview"));
  const offers = apps.filter((a) => a.status === "offer" || a.history.some((h) => h.status === "offer"));
  const upcoming = apps
    .flatMap((a) => a.interviewDates.filter((d) => new Date(d).getTime() >= now - 3_600_000).map((at) => ({ applicationId: a.id, jobId: a.jobId, company: a.company, role: a.role, at })))
    .sort((x, y) => x.at.localeCompare(y.at));
  return {
    active: apps.filter((a) => ACTIVE.includes(a.status)).length,
    applied: applied.length, responses: responses.length, interviews: interviews.length, offers: offers.length,
    responseRate: applied.length >= 5 ? Math.round((responses.length / applied.length) * 100) : null,
    upcoming,
  };
}

export function stageOf(profile: CandidateProfile, apps: ApplicationRecord[], placed: boolean): JourneyStage {
  if (placed) return "placed";
  const s = new Set(apps.map((a) => a.status));
  if (s.has("offer")) return "offer";
  if (s.has("interview") || s.has("shortlisted")) return "interviewing";
  if (["preparing", "applied", "under_review"].some((x) => s.has(x as never))) return "applying";
  return profile.status === "ready" ? "searching" : "understanding";
}

export async function nextActions(uid: string, profile: CandidateProfile, apps: ApplicationRecord[], pulse: ApplicationPulse, now = Date.now()): Promise<NextAction[]> {
  const out: NextAction[] = [];
  const push = (a: NextAction) => out.push(a);

  for (const u of pulse.upcoming.slice(0, 3)) {
    const days = Math.max(0, Math.ceil((new Date(u.at).getTime() - now) / DAY));
    push({ id: `iv_${u.applicationId}_${u.at}`, kind: "interview", priority: 100 - Math.min(days, 10), title: `Interview with ${u.company}`, detail: `${u.role} · ${days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}. Prepare answers and practise.`, cta: { label: "Prepare", jobId: u.jobId, page: "applications" } });
  }
  for (const a of apps.filter((x) => x.status === "offer"))
    push({ id: `offer_${a.id}`, kind: "offer", priority: 95, title: `You have an offer from ${a.company}`, detail: "Compare it, negotiate if it makes sense, then tell me when you accept.", cta: { label: "Review offer", page: "applications" } });
  for (const a of apps.filter((x) => x.followUpAt && ["applied", "under_review"].includes(x.status) && new Date(x.followUpAt!).getTime() <= now).slice(0, 3))
    push({ id: `fu_${a.id}`, kind: "follow_up", priority: 80, title: `Follow up with ${a.company}`, detail: `It has been a while since you applied for ${a.role}. A short note keeps you visible.`, cta: { label: "Draft message", chat: `Draft a follow-up message for my ${a.role} application at ${a.company}` } });
  for (const a of apps.filter((x) => x.status === "preparing").slice(0, 2))
    push({ id: `prep_${a.id}`, kind: "finish_application", priority: 70, title: `Finish your application to ${a.company}`, detail: `${a.role} — your tailored resume is waiting for your approval.`, cta: { label: "Continue", jobId: a.jobId } });

  // Outcomes tell us what to fix: no replies → resume/level; interviews without offers → interview coaching.
  if (pulse.applied >= 5 && pulse.responses === 0)
    push({ id: "diag_resume", kind: "resume", priority: 76, title: "Applications aren't getting replies", detail: `${pulse.applied} applications, no responses yet. Improving your resume or aiming at slightly different roles usually helps most.`, cta: { label: "Check my resume", page: "resume" } });
  if (pulse.interviews >= 3 && pulse.offers === 0)
    push({ id: "diag_interview", kind: "plan", priority: 74, title: "Interviews are not turning into offers", detail: "Let's practise with a mock interview and tighten your answers.", cta: { label: "Practise now", page: "applications" } });

  const feed = await feedSummary(uid).catch(() => null);
  const strong = (feed?.bands.excellent || 0) + (feed?.bands.good || 0);
  if (feed && feed.newSinceLastVisit > 0 && strong > 0)
    push({ id: "new_matches", kind: "new_matches", priority: 66, title: `${feed.newSinceLastVisit} new matches since your last visit`, detail: `${feed.bands.excellent} excellent, ${feed.bands.good} good overall.`, cta: { label: "See matches", page: "matches" } });
  if (strong > 0 && pulse.active === 0)
    push({ id: "apply_first", kind: "apply", priority: 68, title: "Apply to your best match", detail: "A tailored, truthful resume takes about a minute.", cta: { label: "Open matches", page: "matches" } });
  const skillGap = feed?.diagnosis.find((d) => d.kind === "skills" && d.skills?.length);
  if (skillGap) push({ id: "skill_gap", kind: "skill", priority: 52, title: skillGap.title, detail: skillGap.detail, cta: { label: "See how", page: "profile" } });

  const u = await understand(profile, profile.language === "hi" ? "hi" : "en").catch(() => null);
  if (u?.next) push({ id: `q_${u.next.id}`, kind: "question", priority: u.ready ? 40 : 62, title: "One quick question", detail: u.next.text, cta: { label: "Answer", page: "profile" } });

  const health = profile.status === "ready" ? await resumeHealth(profile).catch(() => null) : null;
  if (health && health.score < 70) push({ id: "resume_health", kind: "resume", priority: 55, title: `Your resume scores ${health.score}/100`, detail: health.checks.find((c) => !c.ok && c.fix)?.fix || "A few fixes would help it pass employer filters.", cta: { label: "Improve it", page: "resume" } });

  if (!(await getUserKey(uid).catch(() => null))) push({ id: "ai_key", kind: "ai_key", priority: 45, title: "Unlock unlimited AI help", detail: "Add your free Google AI key for tailored resumes, interview practice and chat.", cta: { label: "Set up", page: "settings" } });

  return out.sort((a, b) => b.priority - a.priority);
}

// ---------------- weekly plan ----------------

const mondayOf = (d = new Date()) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};

/** Targets adapt to how the previous week went: nothing done → smaller; everything done → a bit more. */
function goalTargets(prev?: WeeklyPlan): Record<PlanGoal["id"], number> {
  const base = { apply: 5, practise: 2, learn: 1, profile: 1 };
  if (!prev) return base;
  const doneShare = prev.goals.reduce((n, g) => n + Math.min(1, g.done / Math.max(1, g.target)), 0) / Math.max(1, prev.goals.length);
  if (doneShare >= 0.9) return { ...base, apply: Math.min(10, (prev.goals.find((g) => g.id === "apply")?.target ?? 5) + 1) };
  if (doneShare < 0.25) return { ...base, apply: 3 };
  return base;
}

async function autoProgress(uid: string, weekStart: string): Promise<Partial<Record<PlanGoal["id"], number>>> {
  const from = new Date(`${weekStart}T00:00:00Z`).getTime();
  const store = await getStore();
  const apps = await store.query<ApplicationRecord>("applications", { where: { uid } });
  const audits = (await store.query<AuditRecord>("audit", { where: { uid } })).filter((a) => new Date(a.at).getTime() >= from);
  return {
    apply: apps.filter((a) => a.appliedAt && new Date(a.appliedAt).getTime() >= from).length,
    profile: audits.filter((a) => ["profile.edited", "understanding.answered", "understanding.guess_resolved", "profile.built_from_resume", "profile.preferences_updated"].includes(a.action)).length,
  };
}

export async function weeklyPlan(uid: string): Promise<WeeklyPlan> {
  const store = await getStore();
  const weekStart = mondayOf();
  const id = `${uid}_${weekStart}`;
  let plan = await store.get<WeeklyPlan>("plans", id);
  if (!plan) {
    const prev = (await store.query<WeeklyPlan>("plans", { where: { uid } })).sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];
    const t = goalTargets(prev);
    plan = {
      id, uid, weekStart, manual: {}, createdAt: new Date().toISOString(),
      goals: [
        { id: "apply", title: `Apply to ${t.apply} good-fit jobs`, detail: "Quality over quantity: pick strong matches and tailor each one.", target: t.apply, done: 0, auto: true },
        { id: "practise", title: `Practise ${t.practise} mock interviews`, detail: "Short, timed answers out loud beat silent reading.", target: t.practise, done: 0, auto: false },
        { id: "learn", title: "Learn one skill that unlocks more jobs", detail: "Pick the missing skill that appears in the most of your target jobs.", target: t.learn, done: 0, auto: false },
        { id: "profile", title: "Improve your profile once", detail: "Answer a question or add a detail so matches get sharper.", target: t.profile, done: 0, auto: true },
      ],
    };
    await store.put("plans", id, plan);
  }
  const auto = await autoProgress(uid, plan.weekStart);
  return { ...plan, goals: plan.goals.map((g) => ({ ...g, done: g.auto ? auto[g.id] ?? 0 : plan!.manual[g.id] ?? 0 })) };
}

export async function tickGoal(uid: string, goalId: PlanGoal["id"], done: number): Promise<WeeklyPlan> {
  const store = await getStore();
  const plan = await weeklyPlan(uid);
  const goal = plan.goals.find((g) => g.id === goalId);
  if (goal && !goal.auto) {
    const stored = (await store.get<WeeklyPlan>("plans", plan.id))!;
    stored.manual[goalId] = Math.max(0, Math.min(99, Math.round(done)));
    await store.put("plans", plan.id, stored);
  }
  return weeklyPlan(uid);
}

// ---------------- activity timeline ----------------

const LABELS: Record<string, string> = {
  "resume.uploaded": "Uploaded a resume", "profile.built_from_resume": "Built your profile from your resume", "resume.tailored": "Tailored a resume for a job",
  "resume.approved": "Approved a tailored resume", "application.prepared": "Prepared an application", "application.direct_opened": "Opened an employer's application page",
  "application.status_changed": "Updated an application", "profile.edited": "Edited your profile", "understanding.answered": "Answered a question about you", "ai.own_key_added": "Added your own Google AI key", "job.imported": "Added a job you found", "placement.recorded": "Recorded that you got placed",
};

export async function activityFor(uid: string, limit = 25): Promise<ActivityItem[]> {
  const rows = (await (await getStore()).query<AuditRecord>("audit", { where: { uid } })).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit * 2);
  return rows
    .filter((r) => LABELS[r.action])
    .slice(0, limit)
    .map((r) => ({ at: r.at, who: r.actor === "user" ? "you" : r.actor === "agent" ? "assistant" : "system", text: LABELS[r.action] }));
}

// ---------------- the whole picture ----------------

export async function journeyFor(uid: string, now = Date.now()): Promise<Journey | null> {
  const profile = await getProfile(uid);
  if (!profile) return null;
  const apps = await listApplications(uid);
  const placement = await placementOf(uid);
  const stage = stageOf(profile, apps, Boolean(placement));
  const pulse = pulseOf(apps, now);
  const u = await understand(profile, "en").catch(() => null);
  return {
    stage, stageIndex: JOURNEY_STAGES.indexOf(stage), understanding: u?.score ?? profile.completeness.score, pulse,
    actions: placement ? [] : await nextActions(uid, profile, apps, pulse, now),
    placement: placement || undefined,
  };
}

/** "I got placed": record it, stop the job search (no more matches or alerts) and move to career-growth mode. */
export async function markPlaced(uid: string, input: { company: string; role: string; joiningDate?: string; salaryLPA?: number; applicationId?: string }): Promise<Placement> {
  const store = await getStore();
  const placement: Placement = { ...input, at: new Date().toISOString() };
  await store.put("placements", uid, placement);
  const profile = await getProfile(uid);
  if (profile) await saveProfile({ ...profile, discoveryPaused: true });
  if (input.applicationId) {
    const app = await store.get<ApplicationRecord>("applications", input.applicationId);
    if (app && app.uid === uid && app.status !== "offer" && app.status !== "withdrawn") { /* keep history as recorded; placement is separate */ }
  }
  await audit(uid, "placement.recorded", { hasSalary: Boolean(input.salaryLPA) });
  return placement;
}

export async function undoPlaced(uid: string): Promise<void> {
  await (await getStore()).del("placements", uid);
  const profile = await getProfile(uid);
  if (profile) await saveProfile({ ...profile, discoveryPaused: false });
  await audit(uid, "placement.undone", {});
}
