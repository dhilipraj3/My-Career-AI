// Audio for live voice: the microphone as 16 kHz 16-bit PCM (what Gemini Live expects), and playback of Asha's 24 kHz
// PCM replies with a small adjustable buffer, instant stop when interrupted, and a live loudness level for her lips.

// ---------------- pure helpers (tested) ----------------

/** Average-downsample mono audio from `inRate` to `outRate` (e.g. 48000 → 16000). */
export function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate >= inRate) return input;
  const ratio = inRate / outRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio), end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function pcm16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] / 0x8000;
  return out;
}

export function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
}

/** Loudness 0..1 of a block of samples (root mean square, lightly boosted so speech moves the lips). */
export function loudness(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}

// ---------------- microphone ----------------

// The tiny AudioWorklet that hands raw mic frames to the page is served from our own origin (public/mic-worklet.js):
// the security policy blocks scripts from blob: URLs.
const WORKLET_URL = "/mic-worklet.js";

export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private pending: Float32Array[] = [];
  private pendingLen = 0;
  muted = false;
  /** Latest mic loudness 0..1 (for the "listening" animation). */
  level = 0;

  constructor(private onChunk: (base64Pcm16: string) => void, private chunkMs = 100) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule(WORKLET_URL);
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "mc-tap");
    const rate = this.ctx.sampleRate;
    const need = Math.round((rate * this.chunkMs) / 1000);
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const frame = e.data;
      this.level = this.level * 0.7 + loudness(frame) * 0.3;
      if (this.muted) return;
      this.pending.push(frame);
      this.pendingLen += frame.length;
      if (this.pendingLen < need) return;
      const joined = new Float32Array(this.pendingLen);
      let o = 0;
      for (const f of this.pending) { joined.set(f, o); o += f.length; }
      this.pending = []; this.pendingLen = 0;
      this.onChunk(int16ToBase64(floatToPcm16(downsample(joined, rate, 16000))));
    };
    src.connect(this.node);
  }

  stop(): void {
    this.node?.port.close();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null; this.stream = null; this.node = null;
  }
}

// ---------------- playback ----------------

export class Player {
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private gain: GainNode;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private lastChunkAt = 0;
  private buf = new Float32Array(1024);
  /** Seconds of audio to hold before starting a reply (raised on shaky connections). */
  leadSeconds = 0.15;
  underruns = 0;
  lateChunks = 0;

  constructor() {
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.gain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  /** Browsers only start audio after a tap: call this from the tap that starts the call. */
  async unlock(): Promise<void> { if (this.ctx.state !== "running") await this.ctx.resume().catch(() => undefined); }

  get speaking(): boolean { return this.sources.size > 0; }

  enqueue(base64Pcm24k: string): void {
    const pcm = base64ToInt16(base64Pcm24k);
    if (!pcm.length) return;
    const audio = this.ctx.createBuffer(1, pcm.length, 24000);
    audio.getChannelData(0).set(pcm16ToFloat(pcm));
    const now = this.ctx.currentTime;
    const midReply = performance.now() - this.lastChunkAt < 1500;
    if (midReply && performance.now() - this.lastChunkAt > 450) this.lateChunks++;
    if (this.nextTime < now) {
      if (midReply && this.sources.size === 0) this.underruns++; // ran dry in the middle of a sentence
      this.nextTime = now + this.leadSeconds;
    }
    this.lastChunkAt = performance.now();
    const src = this.ctx.createBufferSource();
    src.buffer = audio;
    src.connect(this.gain);
    src.onended = () => this.sources.delete(src);
    src.start(this.nextTime);
    this.nextTime += audio.duration;
    this.sources.add(src);
  }

  /** Stop at once (the person started talking over her). */
  flush(): void {
    for (const s of this.sources) { try { s.stop(); } catch { /* already stopped */ } }
    this.sources.clear();
    this.nextTime = 0;
  }

  /** Current output loudness 0..1, for lip sync. */
  level(): number {
    if (!this.sources.size) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    return loudness(this.buf);
  }

  close(): void { this.flush(); void this.ctx.close().catch(() => undefined); }
}
