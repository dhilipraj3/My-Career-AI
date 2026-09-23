import type { ApplicationRecord, CandidateProfile, NotificationRecord } from "../shared/types.js";
import { config } from "./config.js";
import { getStore } from "./db/store.js";
import { isDiscoveryRunning, runDiscovery, type RunTrigger } from "./jobs/discovery.js";
import { discoverySettings, onSettingsChange } from "./jobs/settings.js";
import { enrichTop, getFeed, matchCandidate, profileKeywords } from "./matching/service.js";
import { listNotifications, notify } from "./notifications.js";

/** One background cycle: discover → normalise/dedupe → match every active candidate → notify (scope §35). */
export async function runCycle(trigger: RunTrigger = "schedule"): Promise<{ users: number; newJobs: number }> {
  const store = await getStore();
  const profiles = (await store.query<CandidateProfile>("profiles")).filter((p) => p.status === "ready" && !p.discoveryPaused);
  const report = await runDiscovery({ keywords: profileKeywords(profiles), trigger, respectIntervals: trigger === "schedule" });
  for (const p of profiles) {
    try {
      await matchCandidate(p.uid, { notifyNew: true });
      await enrichTop(p.uid, 5);
      await dailySummary(p);
      await followUpReminders(p.uid);
    } catch (err) {
      console.warn(`[scheduler] user cycle failed for ${p.uid}`, err);
    }
  }
  console.log(`[scheduler] cycle done: ${report.newJobIds.length} new jobs, ${profiles.length} candidates`);
  return { users: profiles.length, newJobs: report.newJobIds.length };
}

async function dailySummary(p: CandidateProfile) {
  const today = new Date().toISOString().slice(0, 10);
  const existing = (await listNotifications(p.uid, 30)).some((n) => n.kind === "summary" && n.createdAt.startsWith(today));
  if (existing) return;
  const feed = await getFeed(p.uid, { minScore: 60, limit: 50 });
  const fresh = feed.filter((f) => f.match.createdAt.startsWith(today));
  if (!fresh.length) return;
  const strong = fresh.filter((f) => f.match.score >= 80).length;
  const best = fresh[0];
  await notify(p.uid, { kind: "summary", title: "Today's job-hunting summary", body: `${fresh.length} relevant jobs found, ${strong} strong. Highest: ${best.match.score}% — ${best.job.title} at ${best.job.company}.`, jobId: best.job.id });
}

async function followUpReminders(uid: string) {
  const store = await getStore();
  const apps = await store.query<ApplicationRecord>("applications", { where: { uid } });
  const today = new Date().toISOString().slice(0, 10);
  const existing = await listNotifications(uid, 50);
  for (const a of apps) {
    if (!a.followUpAt || !["applied", "under_review"].includes(a.status)) continue;
    if (new Date(a.followUpAt).getTime() > Date.now()) continue;
    if (existing.some((n: NotificationRecord) => n.kind === "reminder" && n.jobId === a.jobId && n.createdAt.slice(0, 10) >= a.followUpAt!.slice(0, 10))) continue;
    await notify(uid, { kind: "reminder", title: "Time to follow up", body: `It's been a week since you applied to ${a.role} at ${a.company}. Want me to draft a follow-up?`, jobId: a.jobId });
    void today;
  }
}

// ---------------- schedule (interval and pause are live settings from Admin) ----------------

let timer: NodeJS.Timeout | null = null;
let nextRunAt: string | null = null;
let started = false;

/** When the next automatic check will happen (null when paused or not started). */
export const schedulerState = () => ({ started, nextRunAt, paused: discoverySettings().paused, intervalMinutes: discoverySettings().intervalMinutes, running: isDiscoveryRunning() });

function scheduleNext(delayMs: number) {
  if (timer) clearTimeout(timer);
  timer = null;
  if (discoverySettings().paused) { nextRunAt = null; return; }
  nextRunAt = new Date(Date.now() + delayMs).toISOString();
  timer = setTimeout(async () => {
    try { await runCycle("schedule"); } catch (err) { console.error("[scheduler] cycle failed", err); }
    scheduleNext(discoverySettings().intervalMinutes * 60_000);
  }, delayMs);
  timer.unref?.();
}

export function startScheduler() {
  started = true;
  let prev = { paused: discoverySettings().paused, interval: discoverySettings().intervalMinutes };
  onSettingsChange((s) => {
    if (s.paused === prev.paused && s.intervalMinutes === prev.interval) return; // pace changes don't move the schedule
    // Resuming runs soon; a new interval takes effect from now.
    scheduleNext(prev.paused && !s.paused ? 15_000 : s.intervalMinutes * 60_000);
    prev = { paused: s.paused, interval: s.intervalMinutes };
  });
  scheduleNext(15_000);
  console.log(discoverySettings().paused ? "[scheduler] paused (resume it in Admin → Discovery)" : `[scheduler] running every ${discoverySettings().intervalMinutes} min`);
}

export function stopScheduler() {
  if (timer) clearTimeout(timer);
  timer = null;
  nextRunAt = null;
}
