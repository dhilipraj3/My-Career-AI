// One-time: copy this computer's data (data/store.json) into the live site's Firestore backup, so the live app starts
// with the same accounts, profiles, applications and jobs. Google sign-in gives the same user id on both.
//
// Usage (needs FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS in your local .env):
//   npx tsx scripts/upload-local-data.ts            # dry run: shows what would be uploaded
//   npx tsx scripts/upload-local-data.ts --yes      # uploads (replaces the live backup)
// Then add the same Firebase variable (and APP_SECRET) on Render and redeploy: the new instance restores this data.
//
// Not copied: AI and source API keys (they're encrypted with this computer's secret and can't be read on the live
// site — add them again there), the AI response cache, and local test accounts (dev:… users).
import fs from "node:fs";
import path from "node:path";
import { config } from "../server/config.js";
import { FileStore, type Collection } from "../server/db/store.js";
import { SnapshotWriter, firestoreBackend } from "../server/db/snapshot.js";

const file = path.join(config.dataDir, "store.json");
if (!fs.existsSync(file)) { console.error(`No local data at ${file}.`); process.exit(1); }
if (!config.firebaseServiceAccountJson && !config.googleCredentialsPath) {
  console.error("Add FIREBASE_SERVICE_ACCOUNT_JSON (or GOOGLE_APPLICATION_CREDENTIALS) to your local .env first — the same service account the live site uses.");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Record<string, any>>;
const SKIP_COLLECTIONS = new Set(["userKeys", "aiCache"]);
// Firebase user ids are 28 characters; the local dev bypass uses short names like "alice".
const isTestUser = (uid: unknown) => typeof uid === "string" && uid.length < 20;
const encrypted = (doc: unknown) => /"v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\./.test(JSON.stringify(doc));

const mem = new FileStore(); // in memory
const backend = firestoreBackend((await import("../server/db/firebaseAdmin.js")).getFirestoreDb());
const writer = new SnapshotWriter(mem, backend);
const summary: Record<string, number> = {};
let skipped = 0;
for (const [col, docs] of Object.entries(data)) {
  if (SKIP_COLLECTIONS.has(col)) { skipped += Object.keys(docs).length; continue; }
  for (const [id, doc] of Object.entries(docs)) {
    const uid = doc?.uid ?? (col === "profiles" ? id : undefined);
    if (isTestUser(uid)) { skipped++; continue; }
    if (col === "settings" && encrypted(doc)) { skipped++; continue; }
    await mem.put(col as Collection, id, doc);
    summary[col] = (summary[col] || 0) + 1;
  }
}

console.log("Will upload:");
for (const [c, n] of Object.entries(summary).sort((a, b) => b[1] - a[1])) console.log(`  ${c.padEnd(16)} ${n}`);
console.log(`Skipped ${skipped} records (API keys, AI cache, local test users).`);
const people = await mem.query<{ uid: string; email?: string }>("profiles", { readOnly: true });
console.log(`Accounts: ${people.map((p) => p.email || p.uid).join(", ") || "none"}`);

if (!process.argv.includes("--yes")) {
  console.log("\nDry run only. Re-run with --yes to upload (this replaces the live site's backup).");
  process.exit(0);
}
await writer.flushAll();
if (writer.lastError) { console.error(`Upload failed: ${writer.lastError}`); process.exit(1); }
console.log("\nUploaded. Now set FIREBASE_SERVICE_ACCOUNT_JSON and APP_SECRET on Render and redeploy — the live site will start with this data.");
console.log("Then add your AI key again in the live app (keys can't be copied between servers).");
process.exit(0);
