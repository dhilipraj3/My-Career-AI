// Production configuration checks: problems the owner must fix in the hosting settings. Printed loudly at startup
// and listed on /api/health (no secret values, only what's missing).
import { config } from "./config.js";
import { backupStatus } from "./db/store.js";

export function configWarnings(): string[] {
  if (!config.isProd) return [];
  const w: string[] = [];
  if (!config.firebaseServiceAccountJson && !config.googleCredentialsPath)
    w.push("FIREBASE_SERVICE_ACCOUNT_JSON is not set: user accounts, profiles and jobs are lost on every restart or deploy.");
  if (!process.env.APP_SECRET) w.push("APP_SECRET is not set: users can't save their AI keys.");
  if (!config.adminEmails.length) w.push("ADMIN_EMAILS is not set: nobody can open Admin.");
  const b = backupStatus();
  if (b.enabled && b.lastError) w.push(`Firestore backup is failing: ${b.lastError.slice(0, 160)}`);
  return w;
}

export function printConfigWarnings() {
  const w = configWarnings();
  if (!w.length) return;
  console.error("\n==================== CONFIGURATION PROBLEMS ====================");
  for (const x of w) console.error(`  ✗ ${x}`);
  console.error("  Fix these in Render → your service → Environment, then redeploy.");
  console.error("================================================================\n");
}
