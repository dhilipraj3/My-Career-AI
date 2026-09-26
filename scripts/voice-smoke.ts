// End-to-end check of live voice against the real Gemini Live API.
// Mints a short-lived token exactly like the app does (locked to Asha's setup), connects with it, asks one question
// by text, answers her tool call with sample data, and reports: connected, first audio, transcript, tool call, timings.
//
// Run with your own free key:   GEMINI_API_KEY=... npx tsx scripts/voice-smoke.ts
// (or USE_UID=<your uid> npx tsx scripts/voice-smoke.ts to use the key you saved in the app)
import "dotenv/config";
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { config } from "../server/config.js";
import { liveConfig, voiceInstruction } from "../server/voice/session.js";

async function keyFromStore(uid: string): Promise<string | null> {
  const { getStore } = await import("../server/db/store.js");
  const { userKeyRaw } = await import("../server/ai/keys.js");
  await getStore();
  return userKeyRaw(uid);
}

const key = process.env.GEMINI_API_KEY || (process.env.USE_UID ? await keyFromStore(process.env.USE_UID) : null);
if (!key) { console.error("No key. Set GEMINI_API_KEY, or USE_UID for a user who saved their key in the app."); process.exit(2); }

const t0 = Date.now();
const ms = () => `${Date.now() - t0} ms`;
const cfg = liveConfig(voiceInstruction(null, { page: "home" }), "Sulafat");
console.log(`model ${config.liveModel}, voice Sulafat, ${cfg.tools[0].functionDeclarations.length} tools`);

try {
  const minter = new GoogleGenAI({ apiKey: key, httpOptions: { apiVersion: "v1alpha" } });
  const token = await minter.authTokens.create({ config: {
    uses: 1, expireTime: new Date(Date.now() + 10 * 60_000).toISOString(), newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
    liveConnectConstraints: { model: config.liveModel, config: cfg as never }, httpOptions: { apiVersion: "v1alpha" },
  } });
  console.log(`✓ token minted (${ms()})`);

  const ai = new GoogleGenAI({ apiKey: token.name!, httpOptions: { apiVersion: "v1alpha" } });
  let audioBytes = 0, firstAudio = "", transcript = "", tool = "";
  let session: Session | null = null;
  const finished = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("No complete spoken answer within 40 s")), 40_000);
    const onMessage = (m: LiveServerMessage) => {
      for (const p of m.serverContent?.modelTurn?.parts || []) if (p.inlineData?.data) { audioBytes += Math.floor(p.inlineData.data.length * 0.75); if (!firstAudio) firstAudio = ms(); }
      if (m.serverContent?.outputTranscription?.text) transcript += m.serverContent.outputTranscription.text;
      if (m.toolCall?.functionCalls?.length) {
        tool = m.toolCall.functionCalls.map((c) => c.name).join(", ");
        console.log(`✓ tool call: ${tool} (${ms()})`);
        session?.sendToolResponse({ functionResponses: m.toolCall.functionCalls.map((c) => ({ id: c.id, name: c.name, response: { ok: true, data: { newInLast24h: 12, strong: 3, potential: 5, count: 3 } } })) });
      }
      if (m.serverContent?.turnComplete && audioBytes > 0) { clearTimeout(timer); resolve(); }
    };
    ai.live.connect({
      model: config.liveModel, config: { responseModalities: [Modality.AUDIO] },
      callbacks: {
        onopen: () => console.log(`✓ connected (${ms()})`),
        onmessage: onMessage,
        onerror: (e) => { clearTimeout(timer); reject(new Error(`socket error: ${(e as ErrorEvent).message || "unknown"}`)); },
        onclose: (e) => { if (!audioBytes) { clearTimeout(timer); reject(new Error(`closed: ${e?.reason || "no reason given"}`)); } },
      },
    }).then((s) => {
      session = s;
      s.sendClientContent({ turns: [{ role: "user", parts: [{ text: "Hi Asha, what's new for me today?" }] }], turnComplete: true });
    }, (e) => { clearTimeout(timer); reject(e); });
  });
  await finished;
  const seconds = audioBytes / 2 / 24000;
  console.log(`✓ first audio after ${firstAudio}; ${seconds.toFixed(1)} s of speech`);
  console.log(`✓ transcript: "${transcript.trim().slice(0, 200)}"`);
  console.log(tool ? `✓ used a tool: ${tool}` : "• no tool call this time (that can be fine)");
  (session as Session | null)?.close();
  console.log("\nLive voice works end to end.");
  process.exit(0);
} catch (e: any) {
  console.error(`\n✗ ${e?.message || e}`);
  console.error("If the model name is wrong for your key, set GEMINI_LIVE_MODEL (see https://ai.google.dev/gemini-api/docs/models).");
  process.exit(1);
}
