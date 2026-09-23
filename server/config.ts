import dotenv from "dotenv";
import { BRAND } from "../shared/brand.js";

dotenv.config();

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : d;
};
const list = (v: string | undefined) => (v || "").split(",").map((s) => s.trim()).filter(Boolean);

export const config = {
  port: num(process.env.PORT, 3000),
  /** Public address used in canonical links, sitemaps and share tags. */
  siteUrl: (process.env.SITE_URL || BRAND.defaultUrl).replace(/\/+$/, ""),
  isProd: process.env.NODE_ENV === "production",
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || "my-career-ai",
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "",
  googleCredentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || "",
  devAuthBypass: process.env.DEV_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production",
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
    boardsPerRun: num(process.env.BOARDS_PER_RUN, 40),
    maxJobsPerBoard: num(process.env.MAX_JOBS_PER_BOARD, 120),
    registryTimeoutMs: num(process.env.REGISTRY_CONNECTOR_TIMEOUT_MS, 240_000),
  },
  discoveryIntervalMinutes: num(process.env.DISCOVERY_INTERVAL_MINUTES, 60),
  dataDir: process.env.DATA_DIR || "data",
  /** "snapshot" (default with Firebase credentials): local file + compressed Firestore backup. "firestore": every read/write
   *  hits Firestore (needs a paid plan at any real volume). "file": local only. */
  storeMode: (["snapshot", "firestore", "file"].includes(process.env.STORE_MODE || "") ? process.env.STORE_MODE : "") as "" | "snapshot" | "firestore" | "file",
  userRateLimitPerMin: num(process.env.USER_RATE_LIMIT_PER_MIN, 20),
  adminEmails: list(process.env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
};
