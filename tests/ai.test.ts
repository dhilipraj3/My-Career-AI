import request from "supertest";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import { generateJSON, getUsage, setProviders } from "../server/ai/gateway.js";
import { getUserKey, noteUserKeyResult } from "../server/ai/keys.js";
import { _setMasterSecret, decryptSecret, encryptSecret } from "../server/ai/secrets.js";
import { getStore } from "../server/db/store.js";
import { FakeProvider, freshEnv } from "./fixtures.js";

const app = createApp();
const A = { Authorization: "Bearer dev:alice" };
const ADMIN = { Authorization: "Bearer dev:admin" };
const USER_KEY = "AIzaSyTEST-user-key-0123456789abcd";

/** Fake Google AI Studio: model listing + generateContent. `bad` keys are rejected like the real API does. */
function mockGoogle(opts: { bad?: boolean; quota?: boolean } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (input: any) => {
    const url = String(input?.url ?? input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (opts.bad) return json({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }, 400);
    if (url.includes("/models?")) return json({ models: [
      { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.0-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.0-flash-lite", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.5-flash-preview", supportedGenerationMethods: ["generateContent"] },
      { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
    ] });
    if (url.includes(":generateContent")) {
      if (opts.quota) return json({ error: { code: 429, message: "Resource has been exhausted", status: "RESOURCE_EXHAUSTED" } }, 429);
      return json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }], role: "model" }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 } });
    }
    if (url.includes("/chat/completions")) return json({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } });
    return new Response("not found", { status: 404 });
  }));
}

beforeEach(() => {
  freshEnv();
  _setMasterSecret("test-secret");
  setProviders(null); // real key-based routing for these tests
});
afterEach(() => vi.unstubAllGlobals());

describe("secrets", () => {
  it("round-trips and rejects tampering", () => {
    const sealed = encryptSecret("AIza-secret");
    expect(sealed).not.toContain("AIza");
    expect(decryptSecret(sealed)).toBe("AIza-secret");
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});

describe("user's own Google AI Studio key", () => {
  it("validates the key for real, detects the newest stable Flash models, and never returns the key", async () => {
    mockGoogle();
    const r = await request(app).put("/api/me/ai-key").set(A).send({ key: USER_KEY });
    expect(r.status).toBe(200);
    expect(r.body.ai.ownKey).toMatchObject({ last4: "abcd", status: "ok" });
    expect(JSON.stringify(r.body)).not.toContain(USER_KEY);
    const stored = await getUserKey("alice");
    expect(stored!.models).toEqual(["gemini-3.0-flash", "gemini-3.0-flash-lite"]); // newest stable, no preview
    expect(JSON.stringify(stored)).not.toContain(USER_KEY); // encrypted at rest
    const me = await request(app).get("/api/me").set(A);
    expect(JSON.stringify(me.body)).not.toContain(USER_KEY);
    expect(me.body.ai).toMatchObject({ available: true, ownKey: { last4: "abcd" } });
  });

  it("rejects a bad key with a plain-language message", async () => {
    mockGoogle({ bad: true });
    const r = await request(app).put("/api/me/ai-key").set(A).send({ key: USER_KEY });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/rejected/i);
    expect(await getUserKey("alice")).toBeNull();
    expect((await request(app).put("/api/me/ai-key").set(A).send({ key: "not a key at all!!" })).status).toBe(422);
  });

  it("accepts newer key formats that don't start with AIza (the real test call decides)", async () => {
    mockGoogle();
    const newStyle = "AQ.Ab8RN6Kz-new.format_key/with+symbols=0123456789";
    const r = await request(app).put("/api/me/ai-key").set(A).send({ key: newStyle });
    expect(r.status).toBe(200);
    expect(r.body.ai.ownKey.last4).toBe(newStyle.slice(-4));
    // The key travels in a header, never in the URL.
    const calls = (globalThis.fetch as any).mock.calls.map((c: any[]) => String(c[0]?.url ?? c[0]));
    expect(calls.some((u: string) => u.includes(encodeURIComponent(newStyle)) || u.includes(newStyle))).toBe(false);
  });

  it("can be removed, and is removed with the account", async () => {
    mockGoogle();
    await request(app).put("/api/me/ai-key").set(A).send({ key: USER_KEY });
    expect((await request(app).delete("/api/me/ai-key").set(A)).body.ai.ownKey).toBeNull();
    await request(app).put("/api/me/ai-key").set(A).send({ key: USER_KEY });
    await request(app).delete("/api/account").set(A);
    expect(await getUserKey("alice")).toBeNull();
  });
});

describe("gateway routing", () => {
  const schema = z.object({ ok: z.boolean() });
  const ask = (uid: string) => generateJSON({ task: "chat", uid, prompt: "hi", schema, cache: false });

  it("uses the user's own key first and spends no shared credits", async () => {
    const pool = new FakeProvider("pool", () => '{"ok":true}');
    const own = new FakeProvider("own", () => '{"ok":true}');
    setProviders([pool], async (uid) => (uid === "alice" ? own : null));
    await ask("alice");
    expect(own.calls).toHaveLength(1);
    expect(pool.calls).toHaveLength(0);
    expect((await getUsage("alice")).used).toBe(0);
    await ask("bob"); // no own key → pool, metered
    expect(pool.calls).toHaveLength(1);
    expect((await getUsage("bob")).used).toBeGreaterThan(0);
  });

  it("falls back to the shared pool when the user's key is out of quota, and records why", async () => {
    mockGoogle();
    await request(app).put("/api/me/ai-key").set(A).send({ key: USER_KEY });
    const pool = new FakeProvider("pool", () => '{"ok":true}');
    const own = new FakeProvider("own", () => { throw new Error("429 RESOURCE_EXHAUSTED"); });
    setProviders([pool], async () => own);
    await ask("alice");
    expect(pool.calls).toHaveLength(1);
    await noteUserKeyResult("alice", new Error("429 RESOURCE_EXHAUSTED")); // same as the gateway does
    expect((await getUserKey("alice"))!.status).toBe("quota");
  });
});

describe("admin AI setup", () => {
  it("is admin-only", async () => {
    expect((await request(app).get("/api/admin/ai").set(A)).status).toBe(403);
  });

  it("adds a tested Gemini key and a Groq key to the shared pool; lists them masked; disables and removes", async () => {
    mockGoogle();
    const g = await request(app).post("/api/admin/ai/keys").set(ADMIN).send({ kind: "gemini", key: "AIzaSyPOOL-key-0000000000000wxyz" });
    expect(g.status).toBe(201);
    expect(g.body.key).toMatchObject({ kind: "gemini", last4: "wxyz", models: ["gemini-3.0-flash", "gemini-3.0-flash-lite"], source: "admin" });
    const q = await request(app).post("/api/admin/ai/keys").set(ADMIN).send({ kind: "compat", preset: "groq", key: "gsk_test_key_1234567890" });
    expect(q.status).toBe(201);
    expect(q.body.key).toMatchObject({ baseUrl: "https://api.groq.com/openai/v1", models: ["llama-3.3-70b-versatile"] });

    const list = await request(app).get("/api/admin/ai").set(ADMIN);
    expect(list.body.keys).toHaveLength(2);
    expect(JSON.stringify(list.body)).not.toMatch(/AIzaSyPOOL|gsk_test_key/);
    expect(list.body.presets.groq.keyUrl).toMatch(/^https:\/\/console\.groq\.com/);

    const id = g.body.key.id;
    expect((await request(app).patch(`/api/admin/ai/keys/${id}`).set(ADMIN).send({ enabled: false })).body.keys.find((k: any) => k.id === id).enabled).toBe(false);
    expect((await request(app).delete(`/api/admin/ai/keys/${id}`).set(ADMIN)).body.keys).toHaveLength(1);
  });

  it("the pool actually serves requests once a key is added", async () => {
    mockGoogle();
    await request(app).post("/api/admin/ai/keys").set(ADMIN).send({ kind: "gemini", key: "AIzaSyPOOL-key-0000000000000wxyz" });
    const r = await generateJSON({ task: "chat", uid: "bob", prompt: "hi", schema: z.object({ ok: z.boolean() }), cache: false });
    expect(r.ok).toBe(true);
    expect((await getUsage("bob")).used).toBeGreaterThan(0);
  });

  it("a key that fails its test is not saved", async () => {
    mockGoogle({ bad: true });
    const r = await request(app).post("/api/admin/ai/keys").set(ADMIN).send({ kind: "gemini", key: "AIzaSyBAD-key-00000000000000000" });
    expect(r.status).toBe(422);
    expect((await (await getStore()).get<any>("settings", "ai_pool"))?.keys || []).toHaveLength(0);
  });
});
