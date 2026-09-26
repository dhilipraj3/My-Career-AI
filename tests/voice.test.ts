import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { encryptSecret } from "../server/ai/secrets.js";
import { getStore } from "../server/db/store.js";
import { matchCandidate } from "../server/matching/service.js";
import { runDiscovery, setConnectors } from "../server/jobs/discovery.js";
import { ASHA_VOICES, VOICE_TOOLS, functionDeclarations, liveConfig, setTokenFactory, voiceInstruction } from "../server/voice/session.js";
import { RESUME_TEXT, fakeConnector, freshEnv, rawJob } from "./fixtures.js";

const app = createApp();
const A = { Authorization: "Bearer dev:alice" };
const B = { Authorization: "Bearer dev:bob" };
let minted: Array<{ apiKey: string; model: string; config: any; expireTime: string; newSessionExpireTime: string }> = [];

async function giveKey(uid: string, status: "ok" | "invalid" = "ok") {
  await (await getStore()).put("userKeys", uid, { uid, kind: "gemini", keyEnc: encryptSecret("AIzaTEST-KEY-000000000000"), last4: "0000", models: ["gemini-2.5-flash"], addedAt: new Date().toISOString(), status });
}
async function readyUser(h = A) {
  await request(app).post("/api/resume").set(h).attach("resume", Buffer.from(RESUME_TEXT), "cv.txt");
  for (let i = 0; i < 50; i++) {
    const me = await request(app).get("/api/me").set(h);
    if (["needs_info", "ready"].includes(me.body.profile?.status)) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  await request(app).post("/api/profile/answer").set(h).send({ text: "Chennai or remote, hybrid works too, minimum 20 LPA, 30 days notice" });
}

beforeEach(() => {
  freshEnv();
  minted = [];
  setTokenFactory(async (apiKey, p) => { minted.push({ apiKey, ...p }); return `auth_tokens/fake-${minted.length}`; });
});
afterEach(() => setTokenFactory(null));

describe("voice setup", () => {
  it("declares every voice tool with a clean JSON schema Gemini accepts", () => {
    const decls = functionDeclarations();
    expect(decls.length).toBe(VOICE_TOOLS.length);
    for (const d of decls) {
      expect(d.name).toMatch(/^[a-z_]+$/);
      expect((d.parametersJsonSchema as any).type).toBe("object");
      expect(JSON.stringify(d.parametersJsonSchema)).not.toMatch(/\$ref|additionalProperties/);
    }
    expect(decls.find((d) => d.name === "analyze_job_match")!.parametersJsonSchema).toMatchObject({ required: ["jobId"] });
  });

  it("asks for natural, short speech in the user's language and never invents facts", () => {
    const text = voiceInstruction(null, { page: "matches", lang: "hi" });
    expect(text).toMatch(/Asha/);
    expect(text).toMatch(/They prefer Hindi/);
    expect(text).toMatch(/Never invent/);
    expect(text).toMatch(/matched jobs/);
    const cfg = liveConfig(text, "Sulafat");
    expect(cfg).toMatchObject({ responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Sulafat" } } }, inputAudioTranscription: {}, outputAudioTranscription: {} });
  });
});

describe("voice API", () => {
  it("is only offered with the user's own key; the key never leaves the server", async () => {
    await readyUser();
    expect((await request(app).get("/api/voice/status").set(A)).body).toMatchObject({ available: false });
    expect((await request(app).post("/api/voice/session").set(A).send({})).status).toBe(409);
    await giveKey("alice");
    expect((await request(app).get("/api/voice/status").set(A)).body).toMatchObject({ available: true, voices: [...ASHA_VOICES] });
    const s = await request(app).post("/api/voice/session").set(A).send({ page: "home", voice: "Aoede" });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ token: "auth_tokens/fake-1", voice: "Aoede" });
    expect(JSON.stringify(s.body)).not.toContain("AIzaTEST"); // the raw key is never returned
    expect(minted[0].apiKey).toBe("AIzaTEST-KEY-000000000000"); // decrypted on the server only
    expect(minted[0].config.systemInstruction).toMatch(/Senior Project Manager/); // knows who they are
    expect(new Date(minted[0].newSessionExpireTime).getTime() - Date.now()).toBeLessThanOrEqual(2 * 60_000 + 1000); // short-lived
    expect((await request(app).post("/api/voice/session").set(A).send({ voice: "NotAVoice" })).body.voice).toBe(ASHA_VOICES[0]);
    expect((await request(app).post("/api/voice/session")).status).toBe(401);
  });

  it("refuses an invalid key and explains a refused token plainly", async () => {
    await giveKey("alice", "invalid");
    expect((await request(app).post("/api/voice/session").set(A).send({})).status).toBe(409);
    await giveKey("alice");
    setTokenFactory(async () => { throw new Error("429 RESOURCE_EXHAUSTED"); });
    const r = await request(app).post("/api/voice/session").set(A).send({});
    expect(r.status).toBe(429);
    expect(r.body.error).toMatch(/voice time is used up/);
  });

  it("knows the job on screen, but only the user's own or public jobs", async () => {
    await readyUser(); await giveKey("alice");
    setConnectors([fakeConnector("greenhouse", [rawJob()])]);
    await runDiscovery();
    const job = (await (await getStore()).query<any>("jobs"))[0];
    await request(app).post("/api/voice/session").set(A).send({ jobId: job.id });
    expect(minted[0].config.systemInstruction).toContain(job.title);
    await (await getStore()).update("jobs", job.id, { ownerUid: "bob" });
    await request(app).post("/api/voice/session").set(A).send({ jobId: job.id });
    expect(minted[1].config.systemInstruction).not.toContain(job.id);
  });

  it("runs tool calls with the chat's safety rules and returns what the app should show", async () => {
    await readyUser(); await giveKey("alice");
    setConnectors([fakeConnector("greenhouse", [rawJob()])]);
    await runDiscovery();
    await matchCandidate("alice", { notifyNew: true });
    const { sessionId } = (await request(app).post("/api/voice/session").set(A).send({})).body;
    const search = await request(app).post("/api/voice/tool").set(A).send({ sessionId, name: "search_jobs", args: { query: "project manager" } });
    expect(search.body.response.ok).toBe(true);
    expect(search.body.cards.length).toBeGreaterThan(0);
    const jobId = search.body.cards[0].jobId;
    const sensitive = await request(app).post("/api/voice/tool").set(A).send({ sessionId, name: "start_application", args: { jobId } });
    expect(sensitive.body.response).toMatchObject({ needsConfirmation: true });
    expect(sensitive.body.pending.id).toBeTruthy(); // nothing opened until the user taps Confirm
    expect((await request(app).post("/api/voice/tool").set(A).send({ sessionId, name: "delete_everything", args: {} })).body.response.error).toMatch(/Unknown tool/);
    expect((await request(app).post("/api/voice/tool").set(A).send({ sessionId, name: "analyze_job_match", args: {} })).body.response.error).toMatch(/Invalid arguments/);
    const nav = await request(app).post("/api/voice/tool").set(A).send({ sessionId, name: "open_page", args: { page: "applications" } });
    expect(nav.body.navigate).toBe("applications");
    // another user can't act on this user's behalf with the same session id
    await readyUser(B);
    const other = await request(app).post("/api/voice/tool").set(B).send({ sessionId, name: "get_applications", args: {} });
    expect(other.body.response.ok).toBe(true); // runs as bob, on bob's data only
    expect(JSON.stringify(other.body)).not.toContain(jobId);
  });

  it("caps how many changes one voice session can make", async () => {
    await readyUser(); await giveKey("alice");
    const { sessionId } = (await request(app).post("/api/voice/session").set(A).send({})).body;
    const results: string[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await request(app).post("/api/voice/tool").set(A).send({ sessionId, name: "set_discovery_paused", args: { paused: i % 2 === 0 } });
      results.push(r.body.response.error || "ok");
    }
    expect(results.some((x) => /Too many changes/.test(x))).toBe(true);
  });

  it("saves what was said into the chat history", async () => {
    await readyUser(); await giveKey("alice");
    const r = await request(app).post("/api/voice/transcript").set(A).send({ turns: [{ role: "user", text: "Find me remote jobs" }, { role: "assistant", text: "I found three good ones." }] });
    expect(r.body.saved).toBe(2);
    const h = (await request(app).get("/api/agent/history").set(A)).body.messages;
    expect(h.slice(-2).map((m: any) => [m.role, m.text, m.voice])).toEqual([["user", "Find me remote jobs", true], ["assistant", "I found three good ones.", true]]);
    expect((await request(app).post("/api/voice/transcript").set(A).send({ turns: [] })).status).toBe(400);
  });
});
