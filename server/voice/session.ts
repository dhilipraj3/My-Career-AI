// Live voice with Asha (Gemini Live API), on the user's own Google key.
//
// The browser never sees the key. The server mints a short-lived, single-use token that is LOCKED to Asha's setup
// (model, voice, persona, tools), so a client cannot repurpose it. Tool calls from the model come back to the server
// and run through the same permission checks as the text chat (sensitive actions become confirmations).
import { GoogleGenAI } from "@google/genai";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { CandidateProfile } from "../../shared/types.js";
import { experienceText } from "../../shared/format.js";
import { AppError } from "../applications/service.js";
import { userKeyRaw } from "../ai/keys.js";
import { TOOLS } from "../agent/tools.js";
import { config } from "../config.js";
import { getProfile } from "../profile/service.js";

/** Voices that suit Asha: warm, clear, female-presenting. The first is the default. */
export const ASHA_VOICES = ["Sulafat", "Achernar", "Aoede", "Vindemiatrix", "Leda", "Kore"] as const;
export type AshaVoice = (typeof ASHA_VOICES)[number];

/** Tools the voice agent may call (all of the chat's tools; sensitive ones still need a tap to confirm). */
export const VOICE_TOOLS = TOOLS.filter((t) => t.name !== "run_job_search");

const PAGE_NAMES: Record<string, string> = {
  home: "their home dashboard", matches: "their matched jobs", search: "job search", applications: "their applications board", resume: "their resumes",
  profile: "their profile", settings: "settings", interview: "interview prep", insights: "career insights", employer: "the employer page", job: "a job's details",
};

export function voiceInstruction(p: CandidateProfile | null, ctx: { page?: string; jobId?: string; jobTitle?: string; lang?: "en" | "hi" }): string {
  const who = p
    ? `You are talking with ${p.fullName.split(/\s+/)[0] || "a job seeker"}: ${p.currentRole || "job seeker"}, ${experienceText(p.totalExperienceYears)} experience, looking for ${p.preferences.targetRoles.join(", ") || "roles not set yet"} in ${p.preferences.locations.join(", ") || "any city"}.`
    : "The person hasn't finished their profile yet.";
  const where = ctx.jobId ? `They are looking at the job "${ctx.jobTitle || "this job"}" (jobId ${ctx.jobId}); "this job" means that one.` : ctx.page ? `They are on ${PAGE_NAMES[ctx.page] || ctx.page}.` : "";
  return `You are Asha, the voice of MyCareer.AI: a warm, calm and encouraging career coach for job seekers in India. You speak naturally, like a kind friend who knows hiring well.
${who}
${where}
HOW YOU SPEAK:
- Talk like a person, not a document: short sentences, natural rhythm, contractions. Usually 1 to 3 sentences, then let them talk.
- Never read out lists, markdown, links or IDs. Summarise: "I found six good ones; the best is a Senior Project Manager role at Acme in Chennai."
- Match their language: English, Hindi or Hinglish. ${ctx.lang === "hi" ? "They prefer Hindi." : ""}
- Say money the Indian way ("twenty lakh a year"). Be encouraging after setbacks, never preachy.
HOW YOU ACT:
- Use the tools for anything about their jobs, matches, applications or preferences. Never invent jobs, companies, scores or facts.
- Only change things they clearly asked for. Say what you changed. Some actions need them to tap Confirm on screen; tell them when that's the case.
- You cannot submit applications for them. You can prepare everything and open the employer's page after they confirm.
- If you don't know, say so and offer the next best step.`;
}

export function functionDeclarations() {
  return VOICE_TOOLS.map((t) => {
    const schema = zodToJsonSchema(t.schema, { target: "openApi3", $refStrategy: "none" }) as Record<string, unknown>;
    delete schema.additionalProperties;
    return { name: t.name, description: t.description.slice(0, 900), parametersJsonSchema: schema };
  });
}

export function liveConfig(instruction: string, voice: AshaVoice) {
  return {
    responseModalities: ["AUDIO"],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    systemInstruction: instruction,
    tools: [{ functionDeclarations: functionDeclarations() }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    sessionResumption: {},
    contextWindowCompression: { slidingWindow: {} },
  };
}

// ---------------- tokens ----------------

export interface VoiceSession { token: string; model: string; voice: AshaVoice; expiresAt: string; config: ReturnType<typeof liveConfig> }
type TokenFactory = (apiKey: string, params: { model: string; config: ReturnType<typeof liveConfig>; expireTime: string; newSessionExpireTime: string }) => Promise<string>;

const googleTokens: TokenFactory = async (apiKey, { model, config: cfg, expireTime, newSessionExpireTime }) => {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
  const t = await ai.authTokens.create({ config: { uses: 1, expireTime, newSessionExpireTime, liveConnectConstraints: { model, config: cfg as never }, httpOptions: { apiVersion: "v1alpha" } } });
  if (!t.name) throw new Error("No token returned");
  return t.name;
};
let tokens: TokenFactory = googleTokens;
/** Tests replace Google with a fake. */
export const setTokenFactory = (f: TokenFactory | null) => { tokens = f || googleTokens; };

export async function createVoiceSession(uid: string, ctx: { page?: string; jobId?: string; jobTitle?: string; lang?: "en" | "hi"; voice?: string }): Promise<VoiceSession> {
  const key = await userKeyRaw(uid);
  if (!key) throw new AppError(409, "Live voice uses your own free Google AI key. Add it in Settings to talk with Asha.");
  const profile = await getProfile(uid);
  const voice = (ASHA_VOICES as readonly string[]).includes(ctx.voice || "") ? (ctx.voice as AshaVoice) : ASHA_VOICES[0];
  const cfg = liveConfig(voiceInstruction(profile, ctx), voice);
  const now = Date.now();
  const expiresAt = new Date(now + 30 * 60_000).toISOString();
  try {
    const token = await tokens(key, { model: config.liveModel, config: cfg, expireTime: expiresAt, newSessionExpireTime: new Date(now + 2 * 60_000).toISOString() });
    return { token, model: config.liveModel, voice, expiresAt, config: cfg };
  } catch (err: any) {
    const msg = String(err?.message || err);
    console.warn(`[voice] token failed: ${msg.slice(0, 200)}`);
    if (/API_KEY_INVALID|API key not valid|401|403|PERMISSION/i.test(msg)) throw new AppError(422, "Your Google AI key was refused. Check it in Settings.");
    if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) throw new AppError(429, "Your free voice time is used up for now. Text chat still works.");
    throw new AppError(503, "Live voice isn't available right now. Text chat still works.");
  }
}
