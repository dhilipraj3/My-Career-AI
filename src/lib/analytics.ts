// Google Analytics for Firebase — only after the visitor agrees (India's DPDP Act asks for consent).
// Events never carry names, emails, resume text or job descriptions: just what happened and coarse context.
import type { Analytics } from "firebase/analytics";
import { firebaseApp } from "./firebase";

const CONSENT_KEY = "mc_analytics_consent";
export type Consent = "granted" | "denied" | null;

let analytics: Analytics | null = null;
let loading: Promise<void> | null = null;
const queue: Array<[string, Record<string, unknown>]> = [];

export function getConsent(): Consent {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

function start(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const { initializeAnalytics, isSupported, logEvent } = await import("firebase/analytics");
      if (!(await isSupported())) return;
      // Page views are sent by trackPage (the app uses #routes, which GA can't see on its own).
      analytics = initializeAnalytics(firebaseApp, { config: { send_page_view: false } });
      for (const [name, params] of queue.splice(0)) logEvent(analytics, name as string, params);
    } catch (err) {
      console.warn("[analytics] unavailable", err);
    }
  })();
  return loading;
}

export function setConsent(granted: boolean) {
  try { localStorage.setItem(CONSENT_KEY, granted ? "granted" : "denied"); } catch { /* private mode */ }
  // Also stops/starts Firebase's own automatic events (session start, engagement) once it's loaded.
  if (analytics) void import("firebase/analytics").then(({ setAnalyticsCollectionEnabled }) => setAnalyticsCollectionEnabled(analytics!, granted));
  else if (granted) void start();
  window.dispatchEvent(new Event("mc-consent"));
}

/** Call once at startup: begins collecting only if the visitor already agreed. */
export function initAnalytics() {
  if (getConsent() === "granted") void start();
}

const clean = (params: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 100) : v]));

/** Log one event. Dropped silently without consent. */
export function track(name: EventName, params: Record<string, unknown> = {}) {
  if (getConsent() !== "granted") return;
  const p = clean(params);
  if (!analytics) { queue.push([name, p]); void start(); return; }
  void import("firebase/analytics").then(({ logEvent }) => logEvent(analytics!, name as string, p));
}

/** A page view for the app's #routes, with ids stripped out of the address. */
export function trackPage(page: string, title: string) {
  track("page_view", { page_title: title, page_location: `${location.origin}/${page}`, page_path: `/${page}` });
}

/**
 * Every event the app sends. Mark the placement journey ones as **key events** in Google Analytics
 * (Admin → Data display → Events): sign_up, resume_uploaded, onboarding_complete, apply_click, application_applied,
 * application_interview, application_offer, ai_key_added.
 */
export type EventName =
  | "page_view" | "sign_up" | "login" | "resume_uploaded" | "onboarding_complete" | "ai_key_added"
  | "search" | "filter_used" | "job_view" | "job_save" | "apply_click" | "application_applied" | "application_interview" | "application_offer" | "application_status"
  | "assistant_open" | "assistant_message" | "assistant_feedback" | "assistant_undo" | "assistant_action" | "share"
  | "onboarding_answer" | "understanding_answer" | "role_targeted" | "resume_built" | "plan_tick" | "placed";
