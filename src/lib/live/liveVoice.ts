// A live voice conversation with Asha over Gemini Live.
//
// Flow: our server mints a short-lived token locked to Asha's setup → the browser connects straight to Gemini with it
// (low delay; the user's key never reaches the browser) → mic audio streams up, Asha's voice streams down → her tool
// calls go to our server, which runs them with the chat's safety rules → the transcript is saved to the chat.
import type { LiveServerMessage, Session } from "@google/genai";
import { api } from "../api";
import { jitterBufferMs, shouldStepDown } from "../netQuality";
import { MicCapture, Player } from "./audio";

export type CallState = "connecting" | "listening" | "thinking" | "speaking" | "reconnecting" | "ended" | "error";
export interface Turn { role: "user" | "assistant"; text: string }
export interface ToolEffect {
  cards: Array<{ type: "job"; jobId: string; title: string; company: string; location: string; score?: number }>;
  navigate?: string; openUrl?: string; change?: { id: string; summary: string }; pending?: { id: string; summary: string; tool: string };
}
export interface CallEvents {
  onState(s: CallState, detail?: string): void;
  /** Live captions: what is being said right now. */
  onCaption(c: { user: string; assistant: string }): void;
  onTurn(t: Turn): void;
  onEffect(e: ToolEffect): void;
  /** The line can't carry live audio well: the call ended so the app can switch to tap-to-talk. */
  onStepDown(reason: string): void;
}

interface SessionInfo { sessionId: string; token: string; model: string; voice: string }

export class LiveVoiceCall {
  private session: Session | null = null;
  private mic: MicCapture | null = null;
  private player: Player | null = null;
  private info: SessionInfo | null = null;
  private resumeHandle: string | null = null;
  private turns: Turn[] = [];
  private userText = "";
  private asstText = "";
  private toolsRunning = 0;
  private closedByUs = false;
  private healthTimer: ReturnType<typeof setInterval> | undefined;
  private levelTimer: ReturnType<typeof setInterval> | undefined;
  private health = { underruns: 0, late: 0, at: performance.now() };
  private state: CallState = "connecting";
  /** True once Gemini confirmed the session. Only then do drops trigger a reconnect; a refused first connection is an error. */
  private established = false;
  /** Latest loudness of Asha's voice 0..1 (for lip sync), refreshed about 30 times a second. */
  level = 0;

  constructor(private ctx: { page?: string; jobId?: string; lang?: "en" | "hi"; voice?: string; rttMs: number | null }, private ev: CallEvents) {}

  private set(s: CallState, detail?: string) {
    if (this.state === s && !detail) return;
    this.state = s;
    this.ev.onState(s, detail);
    // For diagnosing calls in the browser: set window.__callDebug = true to log every state change and its cause.
    if ((window as unknown as { __callDebug?: boolean }).__callDebug) console.info("[call]", s, detail || "", (new Error().stack || "").split(/\n/).slice(2, 5).join(" <- "));
  }

  /** Call from the button tap that starts the call (browsers need a tap to allow audio). */
  async start(): Promise<void> {
    this.set("connecting");
    this.player = new Player();
    await this.player.unlock();
    this.player.leadSeconds = jitterBufferMs(this.ctx.rttMs, 0) / 1000;
    try {
      this.info = await api<SessionInfo>("/voice/session", { body: { page: this.ctx.page, jobId: this.ctx.jobId, lang: this.ctx.lang, voice: this.ctx.voice } });
      await this.connect();
      if (this.closedByUs) return; // refused straight away: the error is already on screen
      const mic = new MicCapture((b64) => this.sendAudio(b64));
      this.mic = mic;
      await mic.start();
      if (this.closedByUs) { mic.stop(); return; } // refused while the mic was starting: keep the message already shown
    } catch (e: any) {
      if (this.closedByUs) return; // the call was already ended or refused; don't replace that message
      const msg = e?.name === "NotAllowedError" ? "Microphone access is blocked. Allow it in your browser to talk with Asha." : e?.message || "Couldn't start the call.";
      this.teardown();
      this.set("error", msg);
      return;
    }
    this.set("listening");
    this.levelTimer = setInterval(() => {
      this.level = this.player?.level() ?? 0;
      if (this.state === "ended" || this.state === "error" || this.state === "reconnecting") return;
      this.set(this.player?.speaking ? "speaking" : this.toolsRunning || (this.userText && !this.asstText) ? "thinking" : "listening");
    }, 33);
    this.healthTimer = setInterval(() => this.checkHealth(), 2000);
  }

  private async connect(): Promise<void> {
    this.established = false;
    const { GoogleGenAI, Modality } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: this.info!.token, httpOptions: { apiVersion: "v1alpha" } });
    this.session = await ai.live.connect({
      model: this.info!.model,
      // Everything else is locked in the token by the server (voice, persona, tools).
      config: { responseModalities: [Modality.AUDIO], sessionResumption: this.resumeHandle ? { handle: this.resumeHandle } : {} },
      callbacks: {
        onmessage: (m) => this.onMessage(m),
        onerror: () => { if (!this.closedByUs) this.dropped("The connection dropped."); },
        onclose: (e) => { if (!this.closedByUs) this.dropped(e?.reason || "The connection closed."); },
      },
    });
  }

  private dropped(reason: string) {
    if (this.established) { void this.reconnect(reason); return; }
    // Refused before the call ever started: say why, don't retry in a loop.
    this.closedByUs = true;
    this.teardown();
    this.set("error", /key|token|auth|permission|denied|invalid/i.test(reason) ? "Google refused the live voice connection. Check your AI key in Settings." : /model|not found|unsupported/i.test(reason) ? "This live voice model isn't available for your key yet." : `Couldn't start live voice: ${reason}`);
  }

  private sendAudio(b64: string) {
    try { this.session?.sendRealtimeInput({ audio: { data: b64, mimeType: "audio/pcm;rate=16000" } }); } catch { /* reconnecting */ }
  }

  private onMessage(m: LiveServerMessage) {
    if (m.setupComplete) this.established = true;
    if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) this.resumeHandle = m.sessionResumptionUpdate.newHandle;
    if (m.goAway) void this.reconnect(); // the 15-minute limit: carry on seamlessly in a fresh connection
    const sc = m.serverContent;
    if (sc) {
      if (sc.interrupted) { this.player?.flush(); this.finishTurn(); }
      for (const part of sc.modelTurn?.parts || []) if (part.inlineData?.data) this.player?.enqueue(part.inlineData.data);
      if (sc.inputTranscription?.text) { this.userText += sc.inputTranscription.text; this.caption(); }
      if (sc.outputTranscription?.text) { this.asstText += sc.outputTranscription.text; this.caption(); }
      if (sc.turnComplete) this.finishTurn();
    }
    if (m.toolCall?.functionCalls?.length) void this.runTools(m.toolCall.functionCalls);
  }

  private caption() { this.ev.onCaption({ user: this.userText.trim(), assistant: this.asstText.trim() }); }

  private finishTurn() {
    const u = this.userText.trim(), a = this.asstText.trim();
    if (u) { const t: Turn = { role: "user", text: u }; this.turns.push(t); this.ev.onTurn(t); }
    if (a) { const t: Turn = { role: "assistant", text: a }; this.turns.push(t); this.ev.onTurn(t); }
    this.userText = ""; this.asstText = "";
    this.caption();
  }

  private async runTools(calls: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>) {
    this.toolsRunning++;
    try {
      const responses = await Promise.all(calls.map(async (c) => {
        try {
          const r = await api<{ response: Record<string, unknown> } & ToolEffect>("/voice/tool", { body: { sessionId: this.info!.sessionId, name: c.name, args: c.args || {} } });
          this.ev.onEffect({ cards: r.cards || [], navigate: r.navigate, openUrl: r.openUrl, change: r.change, pending: r.pending });
          return { id: c.id, name: c.name, response: r.response };
        } catch (e: any) {
          return { id: c.id, name: c.name, response: { error: e?.message || "That didn't work." } };
        }
      }));
      this.session?.sendToolResponse({ functionResponses: responses });
    } finally { this.toolsRunning--; }
  }

  private checkHealth() {
    if (!this.player || this.state === "reconnecting") return;
    const now = performance.now();
    const windowMs = now - this.health.at;
    const ws = (this.session as unknown as { conn?: { ws?: { bufferedAmount?: number } } })?.conn?.ws;
    const backlogBytes = ws?.bufferedAmount ?? 0;
    const stats = { underruns: this.player.underruns - this.health.underruns, lateChunks: this.player.lateChunks - this.health.late, sendBacklogMs: (backlogBytes / 32_000) * 1000, windowMs };
    // Hold a little more audio when the line gets shaky; step down if it keeps breaking up.
    this.player.leadSeconds = jitterBufferMs(this.ctx.rttMs, stats.underruns) / 1000;
    if (windowMs >= 10_000) {
      if (shouldStepDown(stats)) { this.ev.onStepDown("Your connection is struggling with live voice."); void this.end(); return; }
      this.health = { underruns: this.player.underruns, late: this.player.lateChunks, at: now };
    }
  }

  private reconnecting = false;
  private async reconnect(reason?: string) {
    if (this.reconnecting || this.closedByUs) return;
    this.reconnecting = true;
    this.set("reconnecting", reason);
    try { this.session?.close(); } catch { /* already closed */ }
    for (let attempt = 0; attempt < 3 && !this.closedByUs; attempt++) {
      try {
        if (attempt > 0) this.info = { ...this.info!, ...(await api<SessionInfo>("/voice/session", { body: { page: this.ctx.page, jobId: this.ctx.jobId, lang: this.ctx.lang, voice: this.ctx.voice } })) };
        await this.connect();
        this.reconnecting = false;
        this.set("listening");
        return;
      } catch { await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); }
    }
    this.reconnecting = false;
    this.ev.onStepDown("The live connection keeps dropping.");
    await this.end();
  }

  setMuted(muted: boolean) { if (this.mic) this.mic.muted = muted; }

  /** End the call and save the conversation into the chat. */
  async end(): Promise<Turn[]> {
    if (this.closedByUs) return this.turns;
    this.closedByUs = true;
    this.finishTurn();
    this.teardown();
    this.set("ended");
    if (this.turns.length) await api("/voice/transcript", { body: { turns: this.turns.slice(-60) } }).catch(() => undefined);
    return this.turns;
  }

  private teardown() {
    clearInterval(this.healthTimer); clearInterval(this.levelTimer);
    this.mic?.stop(); this.mic = null;
    try { this.session?.close(); } catch { /* already closed */ }
    this.session = null;
    this.player?.close(); this.player = null;
    this.level = 0;
  }
}
