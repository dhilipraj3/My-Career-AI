// Read-only: when was each part of the Firestore backup last saved? npx tsx scripts/backup-age.ts
import "dotenv/config";
const { getFirestoreDb } = await import("../server/db/firebaseAdmin.js");
const db = getFirestoreDb();
for (const part of ["core", "bulk"]) {
  const d = await db.collection("_snapshots").doc(`manifest-${part}`).get();
  const m = d.data() as { savedAt?: string; docs?: number; chunks?: number } | undefined;
  console.log(part.padEnd(5), m ? `saved ${m.savedAt}, ${m.docs} records, ${m.chunks} piece(s)` : "no backup");
}
process.exit(0);
