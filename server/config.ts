import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { BRAND } from "../shared/brand.js";
import { isSmallServer } from "./memory.js";

const small = isSmallServer();

dotenv.config();

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : d;
};
/**
 * GOOGLE_APPLICATION_CREDENTIALS may point at a file that isn't where it says (e.g. a Render "Secret File" that lives in
 * /etc/secrets). Look in the usual places; if it's nowhere, drop the setting so the Google libraries don't crash on it.
 */
function resolveCredentialsFile(): { path: string; missing: string } {
  const given = process.env.GOOGLE_APPLICATION_CREDENTIALS || "";
  if (!given) return { path: "", missing: "" };
  const name = path.basename(given);
  const found = [given, path.join("/etc/secrets", name), path.resolve(name)].find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  if (found) { process.env.GOOGLE_APPLICATION_CREDENTIALS = found; return { path: found, missing: "" }; }
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  return { path: "", missing: given };
}
const creds = resolveCredentialsFile();

const list = (v: string | undefined) => (v || "").split(",").map((s) => s.trim()).filter(Boolean);

export const config = {
  port: num(process.env.PORT, 3000),
  /** Public address used in canonical links, sitemaps and share tags. */
  siteUrl: (process.env.SITE_URL || BRAND.defaultUrl).replace(/\/+$/, ""),
  isProd: process.env.NODE_ENV === "production",
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || "my-career-ai",
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "",
  googleCredentialsPath: creds.path,
  /** Set when GOOGLE_APPLICATION_CREDENTIALS names a file that doesn't exist (shown as a configuration warning). */
  googleCredentialsMissing: creds.missing,
  devAuthBypass: process.env.DEV_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production",
  /** Forwarding of job-alert emails: needs an inbound address domain (Cloudflare Email Routing) and a shared secret. */
  inboundEmail: { domain: (process.env.INBOUND_EMAIL_DOMAIN || "").trim().toLowerCase(), secret: process.env.INBOUND_WEBHOOK_SECRET || "" },
  /** Gemini Live model for talking with Asha (users' own keys). */
  liveModel: process.env.GEMINI_LIVE_MODEL || "gemini-3.8-live",
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || "",
    models: list(process.env.GEMINI_MODELS).length ? list(process.env.GEMINI_MODELS) : ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
  },
  fallbackAi: {
    baseUrl: process.env.FALLBACK_AI_BASE_URL || "https://api.groq.com/openai/v1",
    apiKey: process.env.FALLBACK_AI_API_KEY || "",
    model: process.env.FALLBACK_AI_MODEL || "llama-3.3-70b-versatile",
  },
  dailyAiCredits: num(process.env.DAILY_AI_CREDITS, 100),
  userAgent: process.env.JOB_DISCOVERY_USER_AGENT || "MyCareer.AI/1.0 (+https://app.tiaslab.in)",
  publicAtsFeeds: list(process.env.PUBLIC_ATS_FEEDS),
  adzuna: { appId: process.env.ADZUNA_APP_ID || "", appKey: process.env.ADZUNA_APP_KEY || "" },
  careerjet: { apiKey: process.env.CAREERJET_API_KEY || "", referer: process.env.CAREERJET_REFERER || "" },
  jooble: { apiKey: process.env.JOOBLE_API_KEY || "" },
  sources: {
    disabled: list(process.env.SOURCES_DISABLED),
    // Company boards fetched per connector per cycle; the registry rotates through the rest on later cycles.
    boardsPerRun: num(process.env.BOARDS_PER_RUN, small ? 20 : 40),
    // How many sources fetch at the same time during a discovery run (memory vs. speed).
    concurrency: num(process.env.DISCOVERY_CONCURRENCY, small ? 1 : 2),
    maxJobsPerBoard: num(process.env.MAX_JOBS_PER_BOARD, 120),
  },
  discoveryIntervalMinutes: num(process.env.DISCOVERY_INTERVAL_MINUTES, 60),
  dataDir: process.env.DATA_DIR || "data",
  /** "snapshot" (default with Firebase credentials): local file + compressed Firestore backup. "firestore": every read/write
   *  hits Firestore (needs a paid plan at any real volume). "file": local only. */
  storeMode: (["snapshot", "firestore", "file"].includes(process.env.STORE_MODE || "") ? process.env.STORE_MODE : "") as "" | "snapshot" | "firestore" | "file",
  userRateLimitPerMin: num(process.env.USER_RATE_LIMIT_PER_MIN, 20),
  adminEmails: list(process.env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
};
