import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export type Collection =
  | "profiles"
  | "resumes"
  | "resumeVersions"
  | "jobs"
  | "matches"
  | "applications"
  | "notifications"
  | "aiUsage"
  | "aiCache"
  | "audit"
  | "conversations"
  | "connectors"
  | "pendingActions"
  | "companies"
  | "settings"
  | "userKeys"
  | "discoveryRuns"
  | "agentUndo"
  | "agentFeedback";

export interface QueryOptions {
  where?: Record<string, string | number | boolean>;
  limit?: number;
}

export interface Store {
  readonly kind: "firestore" | "file" | "memory";
  get<T>(col: Collection, id: string): Promise<T | null>;
  put<T extends object>(col: Collection, id: string, data: T): Promise<void>;
  update<T extends object>(col: Collection, id: string, patch: Partial<T>): Promise<T | null>;
  query<T>(col: Collection, opts?: QueryOptions): Promise<T[]>;
  del(col: Collection, id: string): Promise<void>;
  /** Atomic read-modify-write on one document (used for quotas). */
  mutate<T extends object>(col: Collection, id: string, fn: (current: T | null) => T): Promise<T>;
}

/** Firestore rejects `undefined`; JSON files drop it. Normalise both ways. */
export function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function matches(doc: any, where?: Record<string, unknown>): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => doc?.[k] === v);
}

/** In-memory store, optionally persisted to a JSON file. Dev/test only. */
export class FileStore implements Store {
  readonly kind: "file" | "memory";
  private data: Record<string, Record<string, any>> = {};
  private timer: NodeJS.Timeout | null = null;
  private lock: Promise<unknown> = Promise.resolve();
  private listeners: Array<(col: Collection, patch?: Record<string, unknown>) => void> = [];

  /** Called after every write (used to back the data up). `patch` is the changed fields for updates. */
  onChange(fn: (col: Collection, patch?: Record<string, unknown>) => void) {
    this.listeners.push(fn);
  }

  private changed(col: Collection, patch?: Record<string, unknown>) {
    this.schedule();
    for (const l of this.listeners) l(col, patch);
  }

  /** A deep copy of whole collections (for backups). */
  exportCollections(cols: Collection[]): Record<string, Record<string, unknown>> {
    return clean(Object.fromEntries(cols.map((c) => [c, this.data[c] || {}])));
  }

  constructor(private filePath?: string) {
    this.kind = filePath ? "file" : "memory";
    if (filePath && fs.existsSync(filePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch {
        this.data = {};
      }
    }
  }

  private col(name: string) {
    return (this.data[name] ||= {});
  }

  private schedule() {
    if (!this.filePath) return;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 2000);
    this.timer.unref?.();
  }

  flush(attempt = 0) {
    if (!this.filePath) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.filePath);
    } catch (err: any) {
      // Windows: antivirus, backup tools or an open editor can briefly lock the file (EPERM/EBUSY). Retry, then write in place.
      if (attempt < 3 && /EPERM|EBUSY|EACCES/.test(String(err?.code))) {
        setTimeout(() => this.flush(attempt + 1), 250 * (attempt + 1)).unref?.();
        return;
      }
      try {
        fs.writeFileSync(this.filePath, JSON.stringify(this.data));
      } catch (e) {
        console.error("[store] could not save the local data file", e);
      }
    }
  }

  async get<T>(col: Collection, id: string): Promise<T | null> {
    const v = this.col(col)[id];
    return v ? (clean(v) as T) : null;
  }

  async put<T extends object>(col: Collection, id: string, data: T): Promise<void> {
    this.col(col)[id] = clean(data);
    this.changed(col, data as Record<string, unknown>);
  }

  async update<T extends object>(col: Collection, id: string, patch: Partial<T>): Promise<T | null> {
    const cur = this.col(col)[id];
    if (!cur) return null;
    this.col(col)[id] = { ...cur, ...clean(patch) };
    this.changed(col, patch as Record<string, unknown>);
    return clean(this.col(col)[id]) as T;
  }

  async query<T>(col: Collection, opts: QueryOptions = {}): Promise<T[]> {
    const out: T[] = [];
    for (const doc of Object.values(this.col(col))) {
      if (matches(doc, opts.where)) {
        out.push(clean(doc) as T);
        if (opts.limit && out.length >= opts.limit) break;
      }
    }
    return out;
  }

  async del(col: Collection, id: string): Promise<void> {
    delete this.col(col)[id];
    this.changed(col);
  }

  async mutate<T extends object>(col: Collection, id: string, fn: (current: T | null) => T): Promise<T> {
    const run = async () => {
      const cur = this.col(col)[id];
      const next = clean(fn(cur ? (clean(cur) as T) : null));
      this.col(col)[id] = next;
      this.changed(col);
      return clean(next);
    };
    const p = this.lock.then(run, run);
    this.lock = p.catch(() => undefined);
    return p;
  }
}

/** Firestore store via firebase-admin. */
export class FirestoreStore implements Store {
  readonly kind = "firestore" as const;
  constructor(private db: FirebaseFirestore.Firestore) {}

  async get<T>(col: Collection, id: string): Promise<T | null> {
    const snap = await this.db.collection(col).doc(id).get();
    return snap.exists ? (snap.data() as T) : null;
  }

  async put<T extends object>(col: Collection, id: string, data: T): Promise<void> {
    await this.db.collection(col).doc(id).set(clean(data));
  }

  async update<T extends object>(col: Collection, id: string, patch: Partial<T>): Promise<T | null> {
    const ref = this.db.collection(col).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    await ref.set(clean(patch), { merge: true });
    return (await ref.get()).data() as T;
  }

  async query<T>(col: Collection, opts: QueryOptions = {}): Promise<T[]> {
    let q: FirebaseFirestore.Query = this.db.collection(col);
    for (const [k, v] of Object.entries(opts.where || {})) q = q.where(k, "==", v);
    if (opts.limit) q = q.limit(opts.limit);
    const snap = await q.get();
    return snap.docs.map((d) => d.data() as T);
  }

  async del(col: Collection, id: string): Promise<void> {
    await this.db.collection(col).doc(id).delete();
  }

  async mutate<T extends object>(col: Collection, id: string, fn: (current: T | null) => T): Promise<T> {
    const ref = this.db.collection(col).doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const next = clean(fn(snap.exists ? (snap.data() as T) : null));
      tx.set(ref, next);
      return next;
    });
  }
}

let instance: Store | null = null;
let backup: import("./snapshot.js").SnapshotWriter | null = null;

/** Save pending backups now (graceful shutdown). */
export async function flushBackups(): Promise<void> {
  if (instance instanceof FileStore) instance.flush();
  await backup?.flushAll();
}

export const backupStatus = () => (backup ? { enabled: true, lastError: backup.lastError } : { enabled: false, lastError: null });

export function setStore(s: Store) {
  instance = s;
}

export async function getStore(): Promise<Store> {
  if (instance) return instance;
  const hasCreds = Boolean(config.firebaseServiceAccountJson || config.googleCredentialsPath);
  const mode = config.storeMode || (hasCreds ? "snapshot" : "file");
  if (mode === "firestore" && hasCreds) {
    const { getFirestoreDb } = await import("./firebaseAdmin.js");
    instance = new FirestoreStore(getFirestoreDb());
    console.log("[store] Using Firestore directly");
  } else if (mode === "snapshot" && hasCreds) {
    // Work from a fast local file; keep a compressed backup in Firestore (see snapshot.ts).
    const { getFirestoreDb } = await import("./firebaseAdmin.js");
    const { SnapshotWriter, firestoreBackend, restoreSnapshot } = await import("./snapshot.js");
    const file = path.join(config.dataDir, "store.json");
    const remote = firestoreBackend(getFirestoreDb());
    try {
      const r = await restoreSnapshot(remote, file);
      console.log(r.restored ? `[store] Restored ${r.docs} records from the Firestore backup` : "[store] Using the existing local data file");
    } catch (err) {
      // Never start on top of a half-restored backup: fail loudly so the platform restarts us.
      console.error("[store] Could not restore the Firestore backup", err);
      throw err;
    }
    const fileStore = new FileStore(file);
    backup = new SnapshotWriter(fileStore, remote);
    instance = fileStore;
    console.log("[store] Local file store with Firestore backup");
  } else {
    if (config.isProd) console.warn("[store] WARNING: no Firebase credentials in production; using local file store");
    instance = new FileStore(path.join(config.dataDir, "store.json"));
    console.log("[store] Using local file store (dev). Set FIREBASE_SERVICE_ACCOUNT_JSON for Firestore.");
  }
  return instance;
}
