import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { setProviders } from "../server/ai/gateway.js";
import type { GenerateRequest } from "../server/ai/providers.js";
import { ReplyStreamer } from "../server/agent/agent.js";
import { _resetSearchThrottle, describePreferenceChange } from "../server/agent/tools.js";
import { getStore } from "../server/db/store.js";
import { runDiscovery, setConnectors } from "../server/jobs/discovery.js";
import { FakeProvider, RESUME_TEXT, fakeConnector, freshEnv, rawJob } from "./fixtures.js";

const app = createApp();
const A = { Authorization: "Bearer dev:alice" };
const B = { Authorization: "Bearer dev:bob" };

async function onboard(headers: Record<string, string>) {
  await request(app).post("/api/resume").set(headers).attach("resume", Buffer.from(RESUME_TEXT), "cv.txt");
  for (let i = 0; i < 50; i++) {
    const me = await request(app).get("/api/me").set(headers);
    if (["needs_info", "ready"].includes(me.body.profile?.status)) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  const ans = await request(app).post("/api/profile/answer").set(headers).send({ text: "Chennai or remote, hybrid works too, minimum 20 LPA, 30 days notice" });
  expect(ans.body.profile.status).toBe("ready");
}

async function seedJobs() {
  setConnectors([fakeConnector("greenhouse", [
    rawJob(),
    rawJob({ sourceJobId: "2", title: "Program Manager", url: "https://boards.greenhouse.io/acme/jobs/2", applyUrl: "https://boards.greenhouse.io/acme/jobs/2", description: `${rawJob().description}\nMust know Kanban and Delivery Management.` }),
  ])]);
  await runDiscovery();
}

/** A scripted model: `script` sees the last user line, how many tool results came back, and the whole prompt. */
const brain = (script: (lastUser: string, toolResults: number, prompt: string, system: string) => object) =>
  new FakeProvider("gemini", (req) => {
    if (!req.system?.includes("MyCareer.AI assistant")) return "not json";
    const lastUser = [...req.prompt.matchAll(/^USER: (.*)$/gm)].pop()?.[1] || "";
    return JSON.stringify(script(lastUser, (req.prompt.match(/TOOL_RESULT/g) || []).length, req.prompt, req.system));
  });

/** Same, but delivers its answer in small chunks like a real streaming model. */
class StreamingBrain extends FakeProvider {
  async stream(req: GenerateRequest, onText: (t: string) => void) {
    const out = await this.generate(req);
    for (let i = 0; i < out.text.length; i += 7) onText(out.text.slice(i, i + 7));
    return out;
  }
}

/** Collect a server-sent-events response into [{event, data}]. */
async function sse(body: object, headers = A) {
  const res = await request(app).post("/api/agent/chat/stream").set(headers).send(body)
    .buffer(true).parse((r, cb) => { let d = ""; r.setEncoding("utf8"); r.on("data", (c: string) => (d += c)); r.on("end", () => cb(null, d)); });
  const events = String(res.body).split("\n\n").filter(Boolean).map((block) => ({
    event: /^event: (.+)$/m.exec(block)?.[1], data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] || "null"),
  }));
  return { status: res.status, type: res.headers["content-type"], events };
}

beforeEach(() => {
  freshEnv();
  _resetSearchThrottle();
});

describe("streaming the reply out of the model's JSON", () => {
  const run = (json: string, size: number) => {
    let out = "";
    const s = new ReplyStreamer((t) => (out += t));
    for (let i = 0; i < json.length; i += size) s.push(json.slice(i, i + size));
    return { out, emitted: s.emitted };
  };
  it("decodes escapes, quotes, unicode and newlines at any chunk size", () => {
    const reply = 'You have **4** "excellent" matches.\nNext: ₹25 LPA — नौकरी 🎯 \\ done';
    const json = JSON.stringify({ action: "reply", reply, suggestions: ["a"] });
    for (const size of [1, 2, 3, 5, 64]) expect(run(json, size).out).toBe(reply);
  });
  it("never streams a tool step", () => {
    expect(run(JSON.stringify({ action: "tool", tool: "search_jobs", args: { reply: "nope" } }), 4)).toEqual({ out: "", emitted: false });
  });
});

describe("assistant turns", () => {
  it("streams steps, text and a final answer over server-sent events", async () => {
    await onboard(A);
    await seedJobs();
    setProviders([new StreamingBrain("gemini", (req) => {
      if (!req.system?.includes("MyCareer.AI assistant")) return "not json";
      const results = (req.prompt.match(/TOOL_RESULT/g) || []).length;
      return JSON.stringify(results === 0 ? { action: "tool", tool: "search_jobs", args: { query: "manager" } } : { action: "reply", reply: "I found **2** manager jobs for you.", suggestions: ["Show remote ones"] });
    })]);
    const r = await sse({ message: "Find manager jobs", context: { page: "matches" } });
    expect(r.status).toBe(200);
    expect(r.type).toMatch(/text\/event-stream/);
    const steps = r.events.filter((e) => e.event === "step").map((e) => e.data.step);
    expect(steps.map((s) => s.state)).toEqual(["running", "done"]);
    expect(steps[1].label).toMatch(/Found \d+ jobs?/);
    const text = r.events.filter((e) => e.event === "delta").map((e) => e.data.text).join("");
    expect(text).toBe("I found **2** manager jobs for you.");
    expect(r.events.filter((e) => e.event === "delta").length).toBeGreaterThan(2); // really streamed, not one blob
    const done = r.events.find((e) => e.event === "done")!.data;
    expect(done).toMatchObject({ reply: text, mode: "ai", suggestions: ["Show remote ones"] });
    expect(done.cards.length).toBeGreaterThan(0);
    // Saved with its steps and an id, so feedback and the activity line survive a reload.
    const hist = (await request(app).get("/api/agent/history").set(A)).body.messages;
    expect(hist.at(-1)).toMatchObject({ id: done.id, role: "assistant", steps: [{ tool: "search_jobs", state: "done" }] });
  });

  it("starts the text over when a provider fails mid-answer and the next one takes over", async () => {
    await onboard(A);
    const answer = JSON.stringify({ action: "reply", reply: "Here are your top matches." });
    class Flaky extends FakeProvider {
      async stream(_req: GenerateRequest, onText: (t: string) => void): Promise<never> {
        onText(answer.slice(0, 40));
        throw new Error("HTTP 503 connection dropped");
      }
    }
    setProviders([new Flaky("gemini", () => answer), new StreamingBrain("groq", () => answer)]);
    const r = await sse({ message: "What should I look at first?" });
    const seq = r.events.filter((e) => e.event === "delta" || e.event === "reset");
    const resetAt = seq.findIndex((e) => e.event === "reset");
    expect(resetAt).toBeGreaterThan(0);
    expect(seq.slice(resetAt + 1).map((e) => e.data.text).join("")).toBe("Here are your top matches.");
    expect(r.events.find((e) => e.event === "done")!.data.reply).toBe("Here are your top matches.");
  });

  it("answers small talk instantly without calling the model", async () => {
    await onboard(A);
    const ai = brain(() => ({ action: "reply", reply: "should not be used" }));
    setProviders([ai]);
    for (const msg of ["no thanks", "Thanks!", "bye", "hi"]) {
      const r = await request(app).post("/api/agent/chat").set(A).send({ message: msg });
      expect(r.status).toBe(200);
      expect(r.body.reply).not.toBe("should not be used");
      expect(r.body.steps).toEqual([]);
    }
    expect(ai.calls.filter((c) => c.system?.includes("assistant"))).toHaveLength(0);
    // "yes"/"ok" usually accept an offer, so they still go to the model with the conversation.
    await request(app).post("/api/agent/chat").set(A).send({ message: "yes" });
    expect(ai.calls.some((c) => c.system?.includes("assistant"))).toBe(true);
  });

  it("knows which job the user is looking at", async () => {
    await onboard(A);
    await seedJobs();
    const job = (await (await getStore()).query<any>("jobs"))[0];
    const ai = brain(() => ({ action: "reply", reply: "ok" }));
    setProviders([ai]);
    await request(app).post("/api/agent/chat").set(A).send({ message: "Why do I match this job?", context: { page: "job", jobId: job.id } });
    const system = ai.calls.find((c) => c.system?.includes("assistant"))!.system!;
    expect(system).toContain(`jobId ${job.id}`);
    expect(system).toContain(job.title);
  });

  it("gives data-backed profile advice", async () => {
    await onboard(A);
    await seedJobs();
    const ai = brain((_u, results) => (results === 0 ? { action: "tool", tool: "get_profile_advice", args: {} } : { action: "reply", reply: "Here's how." }));
    setProviders([ai]);
    const r = await request(app).post("/api/agent/chat").set(A).send({ message: "How can I improve my profile?" });
    expect(r.body.steps[0]).toMatchObject({ tool: "get_profile_advice", state: "done" });
    const toolPrompt = ai.calls.at(-1)!.prompt;
    expect(toolPrompt).toMatch(/"matches":\{"excellent":\d+/);
    expect(toolPrompt).toContain("skillGaps");
  });

  it("preference changes can be undone, only by their owner", async () => {
    await onboard(A);
    setProviders([brain((_u, results) => (results === 0 ? { action: "tool", tool: "update_preferences", args: { employmentTypes: ["full_time"], minSalaryLPA: 30 } } : { action: "reply", reply: "Done." }))]);
    const r = await request(app).post("/api/agent/chat").set(A).send({ message: "full time only, above 30 LPA" });
    expect(r.body.changes).toHaveLength(1);
    expect(r.body.changes[0].summary).toBe("Job type → Full-time · Minimum salary → ₹30 LPA");
    let prefs = (await request(app).get("/api/profile").set(A)).body.profile.preferences;
    expect(prefs).toMatchObject({ employmentTypes: ["full_time"], minSalaryLPA: 30 });

    expect((await request(app).post("/api/agent/undo").set(B).send({ changeId: r.body.changes[0].id })).status).toBe(404);
    const undo = await request(app).post("/api/agent/undo").set(A).send({ changeId: r.body.changes[0].id });
    expect(undo.status).toBe(200);
    prefs = (await request(app).get("/api/profile").set(A)).body.profile.preferences;
    expect(prefs.employmentTypes).toEqual([]);
    expect(prefs.minSalaryLPA).toBe(20); // back to what onboarding set
    expect((await request(app).post("/api/agent/undo").set(A).send({ changeId: r.body.changes[0].id })).status).toBe(404); // once only
    const hist = (await request(app).get("/api/agent/history").set(A)).body.messages;
    expect(hist.at(-1).changes[0].undone).toBe(true);
  });

  it("regenerate replaces the last answer instead of duplicating the question", async () => {
    await onboard(A);
    let n = 0;
    setProviders([brain(() => ({ action: "reply", reply: `answer ${++n}` }))]);
    await request(app).post("/api/agent/chat").set(A).send({ message: "What should I do next?" });
    const again = await request(app).post("/api/agent/chat").set(A).send({ message: "What should I do next?", regenerate: true });
    expect(again.body.reply).toBe("answer 2");
    const hist = (await request(app).get("/api/agent/history").set(A)).body.messages;
    expect(hist.map((m: any) => m.text)).toEqual(["What should I do next?", "answer 2"]);
  });

  it("stores thumbs up/down for the user's own messages and clears history on New chat", async () => {
    await onboard(A);
    setProviders([brain(() => ({ action: "reply", reply: "Try adding Kanban." }))]);
    const r = await request(app).post("/api/agent/chat").set(A).send({ message: "Tips?" });
    expect((await request(app).post("/api/agent/feedback").set(B).send({ messageId: r.body.id, rating: "down" })).status).toBe(404);
    expect((await request(app).post("/api/agent/feedback").set(A).send({ messageId: r.body.id, rating: "down" })).status).toBe(200);
    expect((await request(app).get("/api/agent/history").set(A)).body.messages.at(-1).rating).toBe("down");
    expect((await request(app).delete("/api/agent/history").set(A)).status).toBe(200);
    expect((await request(app).get("/api/agent/history").set(A)).body.messages).toEqual([]);
  });

  it("offers starters that fit the page", async () => {
    const job = await request(app).get("/api/agent/starters?page=job&jobId=abc").set(A);
    expect(job.body.suggestions[0]).toMatch(/this job/);
    const apps = await request(app).get("/api/agent/starters?page=applications").set(A);
    expect(apps.body.suggestions.join(" ")).toMatch(/follow up/i);
  });

  it("rejects bad input before opening a stream", async () => {
    const r = await request(app).post("/api/agent/chat/stream").set(A).send({ message: "" });
    expect(r.status).toBe(400);
    expect((await request(app).post("/api/agent/chat/stream").send({ message: "hi" })).status).toBe(401);
  });
});

describe("change summaries", () => {
  it("describes preference changes in plain words", () => {
    expect(describePreferenceChange({ workModes: ["remote", "hybrid"], locations: ["Pune"] })).toBe("Cities → Pune · Work mode → Remote, Hybrid");
    expect(describePreferenceChange({ willingToRelocate: true, noticePeriodDays: 0 })).toBe("Notice period → 0 days · Open to relocating → yes");
  });
});
