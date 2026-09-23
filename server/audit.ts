import crypto from "node:crypto";
import { getStore } from "./db/store.js";

/** Append-only audit trail. Keep `meta` free of PII (ids, counts, statuses only). */
export async function audit(uid: string, action: string, meta: Record<string, unknown> = {}, actor: "user" | "agent" | "system" = "user") {
  try {
    const store = await getStore();
    const id = `${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    await store.put("audit", id, { id, uid, action, actor, meta, at: new Date().toISOString() });
  } catch (err) {
    console.warn("[audit] failed to write", action, err);
  }
}
