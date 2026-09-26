// Durable backup of the local data file, stored as compressed chunks in Firestore.
//
// Why: the app reads its data constantly (search, feeds, public pages). Doing that against Firestore would blow the free
// quota (50k reads/day) within hours. Instead the app works from its fast local file and Firestore only holds a
// compressed copy: a restart restores it with a handful of reads, and changes are saved back in the background.
//   core: people's data (profiles, applications, chats…) — saved within seconds of a change.
//   bulk: jobs, matches, company registry, source health — saved at most every 20 minutes (sooner after a user saves or
//         hides a job), and on shutdown.
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { writeJsonFile, type Collection, type FileStore } from "./store.js";

const gunzip = promisify(zlib.gunzip);

/** Compress {collection: {id: doc}} as JSON, one document at a time (no giant intermediate string). */
async function gzipJson(data: Record<string, Record<string, unknown>>): Promise<Buffer> {
  const z = zlib.createGzip({ level: 6 });
  const out: Buffer[] = [];
  z.on("data", (c: Buffer) => out.push(c));
  const done = new Promise<void>((resolve, reject) => { z.on("end", resolve); z.on("error", reject); });
  let buf = "";
  const write = async (s: string) => {
    buf += s;
    if (buf.length < 256_000) return;
    const ok = z.write(buf);
    buf = "";
    if (!ok) await new Promise((r) => z.once("drain", r));
  };
  await write("{");
  let firstCol = true;
  for (const [col, docs] of Object.entries(data)) {
    await write(`${firstCol ? "" : ","}${JSON.stringify(col)}:{`);
    firstCol = false;
    let firstDoc = true;
    for (const [id, doc] of Object.entries(docs)) {
      await write(`${firstDoc ? "" : ","}${JSON.stringify(id)}:${JSON.stringify(doc)}`);
      firstDoc = false;
    }
    await write("}");
  }
  z.end(buf + "}");
  await done;
  return Buffer.concat(out);
}

/** Firestore documents max out at 1 MiB; stay well under it. */
const CHUNK_BYTES = 900_000;
const AUDIT_KEEP = 3000;

export type SnapshotPart = "core" | "bulk";
export const PARTS: Record<SnapshotPart, { collections: Collection[]; debounceMs: number }> = {
  core: {
    collections: ["profiles", "resumes", "resumeVersions", "applications", "notifications", "aiUsage", "audit", "conversations", "pendingActions", "settings", "userKeys", "agentUndo", "agentFeedback", "plans", "placements", "interviewPrep", "mockInterviews", "inbound", "employers", "employerJobs", "directApplications", "reports", "publicProfiles"],
    debounceMs: 15_000,
  },
  bulk: { collections: ["jobs", "matches", "companies", "connectors", "discoveryRuns"], debounceMs: 20 * 60_000 },
};
// aiCache is deliberately never backed up: it's a cache.
const PART_OF = new Map<string, SnapshotPart>(Object.entries(PARTS).flatMap(([p, v]) => v.collections.map((c) => [c, p as SnapshotPart])));
/** A user saving/hiding a job shouldn't wait 20 minutes to be safe. */
const USER_MATCH_FIELDS = ["saved", "hidden", "feedback"];
const USER_MATCH_DEBOUNCE_MS = 30_000;

/** Where snapshot documents live. Firestore in production; an in-memory map in tests. */
export interface SnapshotBackend {
  get(id: string): Promise<Record<string, any> | null>;
  set(id: string, data: Record<string, any>): Promise<void>;
  delete(id: string): Promise<void>;
}

/** One manifest per part, so saving jobs and saving people's data can never overwrite each other's pointer. */
interface Manifest { version: string; chunks: number; bytes: number; docs: number; savedAt: string }
const manifestId = (part: SnapshotPart) => `manifest-${part}`;
const chunkId = (part: SnapshotPart, version: string, i: number) => `${part}-${version}-${i}`;

export function firestoreBackend(db: FirebaseFirestore.Firestore, collection = "_snapshots"): SnapshotBackend {
  const col = db.collection(collection);
  return {
    async get(id) { const s = await col.doc(id).get(); return s.exists ? (s.data() as Record<string, any>) : null; },
    async set(id, data) { await col.doc(id).set(data); },
    async delete(id) { await col.doc(id).delete(); },
  };
}

/** Fill the local data file from the last backup. Skipped when a local file already exists (it is as new or newer). */
export async function restoreSnapshot(backend: SnapshotBackend, filePath: string): Promise<{ restored: boolean; docs: number }> {
  if (fs.existsSync(filePath)) return { restored: false, docs: 0 };
  const data: Record<string, Record<string, unknown>> = {};
  let docs = 0;
  let found = false;
  for (const part of Object.keys(PARTS) as SnapshotPart[]) {
    const info = (await backend.get(manifestId(part))) as Manifest | null;
    if (!info?.version) { console.log(`[backup] no saved ${part} data yet`); continue; }
    console.log(`[backup] restoring ${part}: ${info.docs} records in ${info.chunks} piece(s), saved ${info.savedAt}`);
    found = true;
    const pieces: Buffer[] = [];
    for (let i = 0; i < info.chunks; i++) {
      const c = await backend.get(chunkId(part, info.version, i));
      if (!c?.data) throw new Error(`Backup is incomplete: ${part} chunk ${i + 1}/${info.chunks} is missing`);
      pieces.push(Buffer.from(c.data));
    }
    const cols = JSON.parse((await gunzip(Buffer.concat(pieces))).toString("utf8")) as Record<string, Record<string, unknown>>;
    for (const [c, rows] of Object.entries(cols)) { data[c] = rows; docs += Object.keys(rows).length; }
  }
  if (!found) return { restored: false, docs: 0 };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJsonFile(filePath, data as Record<string, Record<string, unknown>>);
  return { restored: true, docs };
}

/** Watches the store and saves each part to the backend shortly after it changes. */
export class SnapshotWriter {
  private timers = new Map<SnapshotPart, { at: number; timer: NodeJS.Timeout }>();
  private dirty = new Set<SnapshotPart>();
  private running = new Map<SnapshotPart, Promise<void>>();
  lastError: string | null = null;

  constructor(private store: FileStore, private backend: SnapshotBackend) {
    store.onChange((col, patch) => {
      const part = PART_OF.get(col);
      if (!part) return;
      const urgent = col === "matches" && patch && USER_MATCH_FIELDS.some((f) => f in patch);
      this.markDirty(part, urgent ? USER_MATCH_DEBOUNCE_MS : PARTS[part].debounceMs);
    });
  }

  private markDirty(part: SnapshotPart, delayMs: number) {
    this.dirty.add(part);
    const due = Date.now() + delayMs;
    const t = this.timers.get(part);
    if (t && t.at <= due) return; // an earlier save is already scheduled
    if (t) clearTimeout(t.timer);
    const timer = setTimeout(() => { this.timers.delete(part); void this.save(part); }, delayMs);
    timer.unref?.();
    this.timers.set(part, { at: due, timer });
  }

  /** Save one part now (waits for a save already in progress, then saves again if needed). */
  async save(part: SnapshotPart): Promise<void> {
    const prev = this.running.get(part);
    if (prev) await prev.catch(() => undefined);
    if (!this.dirty.has(part)) return;
    this.dirty.delete(part);
    const run = this.upload(part).catch((err) => {
      this.dirty.add(part); // try again next time
      this.lastError = String(err?.message || err);
      console.error(`[backup] saving ${part} failed:`, this.lastError);
    });
    this.running.set(part, run);
    await run;
    this.running.delete(part);
  }

  /** Save everything that changed — called on shutdown. */
  async flushAll(): Promise<void> {
    for (const { timer } of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.all((Object.keys(PARTS) as SnapshotPart[]).map((p) => this.save(p)));
  }

  private async upload(part: SnapshotPart): Promise<void> {
    const cols = { ...this.store.exportCollections(PARTS[part].collections) };
    if (cols.audit) {
      // The audit log only needs recent history in the backup.
      const rows = Object.entries(cols.audit).sort((a, b) => String((b[1] as any)?.at || "").localeCompare(String((a[1] as any)?.at || ""))).slice(0, AUDIT_KEEP);
      cols.audit = Object.fromEntries(rows);
    }
    const docs = Object.values(cols).reduce((n, c) => n + Object.keys(c).length, 0);
    const zipped = await gzipJson(cols);
    const version = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const chunks = Math.max(1, Math.ceil(zipped.length / CHUNK_BYTES));
    for (let i = 0; i < chunks; i++) await this.backend.set(chunkId(part, version, i), { data: zipped.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES) });
    // Only switch the manifest once every chunk is written, so a failed save never leaves a broken backup.
    const old = (await this.backend.get(manifestId(part))) as Manifest | null;
    const next: Manifest = { version, chunks, bytes: zipped.length, docs, savedAt: new Date().toISOString() };
    await this.backend.set(manifestId(part), next as unknown as Record<string, unknown>);
    if (old) for (let i = 0; i < old.chunks; i++) await this.backend.delete(chunkId(part, old.version, i)).catch(() => undefined);
    this.lastError = null;
  }
}
