// Privacy centre: everything we hold about a person can be downloaded and erased. One list of where personal data
// lives, so export and erasure can never drift apart.
import type { Job } from "../shared/types.js";
import { deleteUserKey } from "./ai/keys.js";
import { getStore, type Collection } from "./db/store.js";
import { syncJobs } from "./search/index.js";

/** Collections whose rows carry the person's `uid`. */
const BY_UID: Collection[] = [
  "resumes", "resumeVersions", "matches", "applications", "notifications", "aiUsage", "conversations", "pendingActions", "plans",
  "interviewPrep", "mockInterviews", "inbound", "agentFeedback", "agentUndo", "audit",
];

type Row = Record<string, unknown> & { id?: string };

/** A copy of the person's data as plain JSON. Never includes stored AI keys, other people's data or internal caches. */
export async function exportUserData(uid: string): Promise<Record<string, unknown>> {
  const store = await getStore();
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), format: "MyCareer.AI data export v1", profile: await store.get("profiles", uid) };
  for (const col of BY_UID) {
    const rows = await store.query<Row>(col, { where: { uid } });
    // The forwarding address token is a secret: the export says an address exists, not what it is.
    out[col] = col === "inbound" ? rows.map(({ id: _id, ...rest }) => rest) : rows;
  }
  out.publicProfile = await store.query("publicProfiles", { where: { uid } });
  out.placement = await store.get("placements", uid);
  out.employerAccount = await store.get("employers", uid);
  out.employerJobs = await store.query("employerJobs", { where: { employerUid: uid } });
  out.applicationsSharedWithEmployers = await store.query("directApplications", { where: { candidateUid: uid } });
  out.myJobs = await store.query<Job>("jobs", { where: { ownerUid: uid } });
  return out;
}

/** Delete the person's data everywhere. Jobs they posted as an employer are closed, not left live. */
export async function eraseUserData(uid: string): Promise<void> {
  const store = await getStore();
  await deleteUserKey(uid);
  for (const col of BY_UID) for (const row of await store.query<Row>(col, { where: { uid } })) if (row.id) await store.del(col, row.id);

  for (const ej of await store.query<{ id: string; jobId?: string; status: string }>("employerJobs", { where: { employerUid: uid } })) {
    if (ej.jobId) { await store.update<Job>("jobs", ej.jobId, { status: "closed" }).catch(() => undefined); await syncJobs([ej.jobId]).catch(() => undefined); }
    await store.del("employerJobs", ej.id);
  }
  for (const a of await store.query<{ id: string }>("directApplications", { where: { candidateUid: uid } })) await store.del("directApplications", a.id);
  for (const a of await store.query<{ id: string }>("directApplications", { where: { employerUid: uid } })) await store.del("directApplications", a.id);
  for (const r of await store.query<{ id: string }>("reports", { where: { reporterUid: uid } })) await store.del("reports", r.id);
  for (const pp of await store.query<{ id: string }>("publicProfiles", { where: { uid } })) await store.del("publicProfiles", pp.id);
  await store.del("employers", uid);
  await store.del("placements", uid);

  const owned = await store.query<Job>("jobs", { where: { ownerUid: uid } });
  for (const j of owned) await store.del("jobs", j.id);
  await syncJobs(owned.map((j) => j.id));
  await store.del("conversations", uid);
  await store.del("profiles", uid);
}
