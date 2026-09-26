import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { config } from "../server/config.js";
import { getStore } from "../server/db/store.js";
import { _clearErrors, recentErrors } from "../server/log.js";
import { RESUME_TEXT, freshEnv } from "./fixtures.js";

const app = createApp();
const A = { Authorization: "Bearer dev:alice" };
const B = { Authorization: "Bearer dev:bob" };
const ADMIN = { Authorization: "Bearer dev:admin" };

beforeAll(() => { config.adminEmails = ["admin@dev.local"]; config.inboundEmail.domain = "in.test.dev"; config.inboundEmail.secret = "s3cret-value-123"; });
beforeEach(() => { freshEnv(); _clearErrors(); });

async function readyUser(h: Record<string, string>) {
  await request(app).post("/api/resume").set(h).attach("resume", Buffer.from(RESUME_TEXT), "cv.txt");
  for (let i = 0; i < 50; i++) {
    const me = await request(app).get("/api/me").set(h);
    if (["needs_info", "ready"].includes(me.body.profile?.status)) break;
    await new Promise((r) => setTimeout(r, 40));
  }
}

describe("privacy centre", () => {
  it("exports the person's own data, and only theirs, without secrets", async () => {
    await readyUser(A); await readyUser(B);
    await request(app).get("/api/inbox").set(A); // creates the forwarding address
    await request(app).get("/api/companion/journey").set(A); // creates this week's plan
    const r = await request(app).get("/api/me/export").set(A);
    expect(r.status).toBe(200);
    expect(r.headers["content-disposition"]).toMatch(/attachment/);
    const d = r.body;
    expect(d.profile.uid).toBe("alice");
    expect(d.resumes).toHaveLength(1);
    expect(d.resumes[0].uid).toBe("alice");
    expect(d.plans.length).toBeGreaterThan(0);
    const text = JSON.stringify(d);
    expect(text).not.toContain('"uid":"bob"');
    expect(d.inbound[0]).not.toHaveProperty("id"); // the forwarding token is a secret
    expect(text).not.toMatch(/keyEnc/);
    expect((await request(app).get("/api/me/export")).status).toBe(401);
  });

  it("erasing removes everything, including new-phase data, and leaves other people alone", async () => {
    await readyUser(A); await readyUser(B);
    await request(app).get("/api/inbox").set(A);
    await request(app).get("/api/companion/journey").set(A);
    await request(app).post("/api/employer/register").set(A).send({ company: "Acme", website: "https://dev.local", contactName: "Al" });
    await request(app).post("/api/companion/placed").set(A).send({ company: "Acme", role: "PM" });
    const store = await getStore();
    expect((await request(app).delete("/api/account").set(A)).body.deleted).toBe(true);
    for (const col of ["resumes", "plans", "inbound", "audit", "notifications"] as const) expect(await store.query(col, { where: { uid: "alice" } })).toEqual([]);
    expect(await store.get("profiles", "alice")).toBeNull();
    expect(await store.get("employers", "alice")).toBeNull();
    expect(await store.get("placements", "alice")).toBeNull();
    expect(await store.get("profiles", "bob")).not.toBeNull();
    expect(await store.query("resumes", { where: { uid: "bob" } })).toHaveLength(1);
  });
});

describe("error monitoring", () => {
  it("gives every response a request id and keeps unexpected errors for the admin", async () => {
    const ok = await request(app).get("/api/health");
    expect(ok.headers["x-request-id"]).toMatch(/^[\w-]{6,}$/);
    expect((await request(app).get("/api/health").set("X-Request-Id", "abc-123")).headers["x-request-id"]).toBe("abc-123");

    const store = await getStore();
    const orig = store.get.bind(store);
    (store as any).get = async () => { throw new Error("disk exploded"); };
    const bad = await request(app).get("/api/profile").set(A);
    (store as any).get = orig;
    expect(bad.status).toBe(500);
    expect(bad.body.requestId).toBe(bad.headers["x-request-id"]);
    expect(bad.body.error).not.toMatch(/disk/); // users never see internals

    expect(recentErrors()[0]).toMatchObject({ requestId: bad.body.requestId, status: 500, path: "/api/profile" });
    expect((await request(app).get("/api/admin/errors").set(A)).status).toBe(403);
    const list = (await request(app).get("/api/admin/errors").set(ADMIN)).body.errors;
    expect(list[0].message).toMatch(/disk exploded/);
  });
});
