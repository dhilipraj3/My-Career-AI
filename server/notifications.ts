import crypto from "node:crypto";
import type { NotificationRecord } from "../shared/types.js";
import { getStore } from "./db/store.js";

export async function notify(uid: string, n: Pick<NotificationRecord, "kind" | "title" | "body"> & { jobId?: string }): Promise<NotificationRecord> {
  const rec: NotificationRecord = {
    id: `${Date.now()}_${crypto.randomBytes(3).toString("hex")}`, uid, kind: n.kind, title: n.title, body: n.body, jobId: n.jobId, read: false, createdAt: new Date().toISOString(),
  };
  await (await getStore()).put("notifications", rec.id, rec);
  return rec;
}

export async function listNotifications(uid: string, limit = 50): Promise<NotificationRecord[]> {
  const all = await (await getStore()).query<NotificationRecord>("notifications", { where: { uid } });
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

export async function markRead(uid: string, id?: string): Promise<number> {
  const store = await getStore();
  const all = await store.query<NotificationRecord>("notifications", { where: { uid, read: false } });
  const target = id ? all.filter((n) => n.id === id) : all;
  for (const n of target) await store.update<NotificationRecord>("notifications", n.id, { read: true });
  return target.length;
}
