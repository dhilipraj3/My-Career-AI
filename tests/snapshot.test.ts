import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileStore } from "../server/db/store.js";
import { SnapshotWriter, restoreSnapshot, type SnapshotBackend } from "../server/db/snapshot.js";

/** Firestore stand-in that records every operation. */
function memoryBackend(opts: { failSetsMatching?: RegExp } = {}) {
  const docs = new Map<string, Record<string, any>>();
  const ops: string[] = [];
  const backend: SnapshotBackend = {
    async get(id) { ops.push(`get ${id}`); return docs.has(id) ? structuredClone(docs.get(id)!) : null; },
    async set(id, data) {
      ops.push(`set ${id}`);
      if (opts.failSetsMatching?.test(id)) throw new Error("quota exceeded");
      docs.set(id, { ...data, data: data.data ? Buffer.from(data.data) : undefined });
    },
    async delete(id) { ops.push(`delete ${id}`); docs.delete(id); },
  };
  return { backend, docs, ops };
}

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mc-snap-")), "store.json");

afterEach(() => vi.useRealTimers());

describe("Firestore backup of the local data file", () => {
  it("saves people's data and jobs, then restores them into a fresh container", async () => {
    const { backend, docs } = memoryBackend();
    const store = new FileStore(tmpFile());
    const writer = new SnapshotWriter(store, backend);
    await store.put("profiles", "u1", { uid: "u1", fullName: "Priya" });
    await store.put("applications", "a1", { id: "a1", uid: "u1", status: "applied" });
    await store.put("jobs", "job_1", { id: "job_1", title: "Data Analyst" });
    await store.put("matches", "u1_job_1", { id: "u1_job_1", saved: true });
    await store.put("aiCache", "x", { data: "not worth backing up" });
    await writer.flushAll();
    expect([...docs.keys()].filter((k) => k.startsWith("manifest-")).sort()).toEqual(["manifest-bulk", "manifest-core"]);

    const fresh = tmpFile();
    const r = await restoreSnapshot(backend, fresh);
    expect(r).toEqual({ restored: true, docs: 4 });
    const restored = new FileStore(fresh);
    expect(await restored.get("profiles", "u1")).toEqual({ uid: "u1", fullName: "Priya" });
    expect(await restored.get("matches", "u1_job_1")).toEqual({ id: "u1_job_1", saved: true });
    expect(await restored.get("aiCache", "x")).toBeNull();
  });

  it("splits large data into chunks under Firestore's 1 MiB document limit", async () => {
    const { backend, docs } = memoryBackend();
    const store = new FileStore(tmpFile());
    const writer = new SnapshotWriter(store, backend);
    // Random text doesn't compress, so this really needs several chunks.
    for (let i = 0; i < 40; i++) await store.put("jobs", `job_${i}`, { id: `job_${i}`, description: crypto.randomBytes(60_000).toString("base64") });
    await writer.flushAll();
    const manifest = docs.get("manifest-bulk")!;
    expect(manifest.chunks).toBeGreaterThan(2);
    for (const [id, d] of docs) if (d.data) expect(d.data.length, id).toBeLessThanOrEqual(900_000);
    const fresh = tmpFile();
    await restoreSnapshot(backend, fresh);
    expect((await new FileStore(fresh).query("jobs")).length).toBe(40);
  });

  it("a failed save keeps the previous backup intact, and a good save cleans up old chunks", async () => {
    const good = memoryBackend();
    const store = new FileStore(tmpFile());
    const writer = new SnapshotWriter(store, good.backend);
    await store.put("profiles", "u1", { uid: "u1", fullName: "Version 1" });
    await writer.flushAll();
    const firstVersion = good.docs.get("manifest-core")!.version;

    // Next save fails half-way (chunk writes rejected): the manifest must still point at version 1.
    const failing = memoryBackend({ failSetsMatching: /^core-/ });
    for (const [k, v] of good.docs) failing.docs.set(k, v);
    const writer2 = new SnapshotWriter(store, failing.backend);
    await store.put("profiles", "u1", { uid: "u1", fullName: "Version 2" });
    await writer2.flushAll();
    expect(writer2.lastError).toMatch(/quota/);
    expect(failing.docs.get("manifest-core")!.version).toBe(firstVersion);
    const fresh = tmpFile();
    await restoreSnapshot(failing.backend, fresh);
    expect((await new FileStore(fresh).get<any>("profiles", "u1")).fullName).toBe("Version 1");

    // A later good save replaces it and deletes the old chunks.
    await store.put("profiles", "u1", { uid: "u1", fullName: "Version 3" });
    await writer.flushAll();
    expect(good.docs.get("manifest-core")!.version).not.toBe(firstVersion);
    expect([...good.docs.keys()].some((k) => k.startsWith(`core-${firstVersion}`))).toBe(false);
  });

  it("does not overwrite a local data file that already exists", async () => {
    const { backend } = memoryBackend();
    const store = new FileStore(tmpFile());
    await store.put("profiles", "u1", { uid: "u1" });
    await new SnapshotWriter(store, backend).flushAll();
    const existing = tmpFile();
    fs.writeFileSync(existing, JSON.stringify({ profiles: { local: { uid: "local" } } }));
    expect(await restoreSnapshot(backend, existing)).toEqual({ restored: false, docs: 0 });
    expect(JSON.parse(fs.readFileSync(existing, "utf8")).profiles.local).toBeTruthy();
  });

  it("saves people's changes within seconds, jobs only every 20 minutes, and saved jobs within 30 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { backend, ops } = memoryBackend();
    // Compression runs on a real worker thread, so let real async work finish after moving the clock.
    const settle = async () => { for (let i = 0; i < 300; i++) await new Promise((r) => setImmediate(r)); };
    const until = async (ok: () => boolean) => { for (let i = 0; i < 50_000 && !ok(); i++) await new Promise((r) => setImmediate(r)); };
    const store = new FileStore(); // in-memory
    new SnapshotWriter(store, backend);
    const sets = (part: string) => ops.filter((o) => o === `set manifest-${part}`).length;

    await store.put("jobs", "job_1", { id: "job_1" });
    await store.put("profiles", "u1", { uid: "u1" });
    await vi.advanceTimersByTimeAsync(16_000);
    await until(() => sets("core") === 1);
    expect(sets("core")).toBe(1);
    expect(sets("bulk")).toBe(0);

    await store.put("matches", "u1_job_1", { id: "u1_job_1", saved: false });
    await store.update("matches", "u1_job_1", { saved: true }); // a user action
    await vi.advanceTimersByTimeAsync(31_000);
    await until(() => sets("bulk") === 1);
    expect(sets("bulk")).toBe(1);

    await store.put("jobs", "job_2", { id: "job_2" }); // routine job churn
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await settle();
    expect(sets("bulk")).toBe(1);
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    await until(() => sets("bulk") === 2);
    expect(sets("bulk")).toBe(2);
  });
});
