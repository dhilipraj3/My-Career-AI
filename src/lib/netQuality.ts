// How good is the connection, and so how should Asha talk?
//   live  — real-time voice with Gemini Live (about 1 Mbps both ways while talking, needs quick round trips)
//   lite  — tap to talk: speech becomes text on the device, answers are spoken by the device (a few KB a turn)
//   text  — chat only, still Asha, no audio
// We combine the browser's own estimate (Chrome, Edge, Android) with a few pings to our server (works everywhere),
// and the person can always override it.
import { useEffect, useState } from "react";
import { getLowData } from "./lowdata";

export type VoiceTier = "live" | "lite" | "text";
export type VoicePreference = "auto" | "live" | "text";

export interface NetSample {
  rttMs: number | null; // fastest of our pings
  downlinkMbps: number | null; // browser estimate
  effectiveType?: string; // "4g", "3g", "2g", "slow-2g"
  saveData: boolean;
  online: boolean;
}

export interface NetQuality extends NetSample { tier: VoiceTier; reason: string }

/** Pure rule, so it can be tested: the tier a connection supports. */
export function classify(s: NetSample): { tier: VoiceTier; reason: string } {
  if (!s.online) return { tier: "text", reason: "You're offline." };
  if (s.saveData) return { tier: "text", reason: "Data Saver is on." };
  if (s.effectiveType === "slow-2g" || s.effectiveType === "2g") return { tier: "text", reason: "The connection is very slow." };
  const rtt = s.rttMs ?? 250;
  if (rtt > 1500) return { tier: "text", reason: "The connection is very slow." };
  const down = s.downlinkMbps;
  const fast = (down === null || down >= 1.5) && rtt <= 450 && s.effectiveType !== "3g";
  if (fast) return { tier: "live", reason: "Your connection is good for live voice." };
  return { tier: "lite", reason: "Your connection is a bit slow for live voice, so tap to talk instead." };
}

/** What we actually use, after the person's own choice and low-data mode. */
export function effectiveTier(measured: VoiceTier, pref: VoicePreference, lowData: boolean): VoiceTier {
  if (pref === "text" || lowData) return "text";
  if (pref === "live") return measured === "text" ? "lite" : "live"; // "always live" still never tries on a dead connection
  return measured;
}

type Conn = { downlink?: number; effectiveType?: string; saveData?: boolean; addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void };
const conn = (): Conn | undefined => (typeof navigator !== "undefined" ? (navigator as Navigator & { connection?: Conn }).connection : undefined);

/** Network round trip: the fastest of a few pings (a slow one usually means the server was busy, not the network). */
async function pingFastest(n = 3): Promise<number | null> {
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    try {
      const r = await fetch(`/api/health?ping=${Date.now()}_${i}`, { cache: "no-store" });
      if (!r.ok) continue;
      times.push(performance.now() - t0);
    } catch { /* offline */ }
  }
  if (!times.length) return null;
  return Math.round(Math.min(...times));
}

export async function measureNetwork(): Promise<NetQuality> {
  const c = conn();
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  const sample: NetSample = {
    rttMs: online ? await pingFastest() : null,
    downlinkMbps: typeof c?.downlink === "number" && c.downlink > 0 ? c.downlink : null,
    effectiveType: c?.effectiveType, saveData: Boolean(c?.saveData), online,
  };
  if (online && sample.rttMs === null) sample.online = false;
  return { ...sample, ...classify(sample) };
}

const PREF_KEY = "mc_voice_quality";
export const getVoicePreference = (): VoicePreference => { try { const v = localStorage.getItem(PREF_KEY); return v === "live" || v === "text" ? v : "auto"; } catch { return "auto"; } };
export const setVoicePreference = (v: VoicePreference) => { try { if (v === "auto") localStorage.removeItem(PREF_KEY); else localStorage.setItem(PREF_KEY, v); } catch { /* private mode */ } };

/** Measures once, then again when the connection changes or the page comes back online. */
export function useVoiceTier(): { quality: NetQuality | null; tier: VoiceTier; recheck: () => void } {
  const [quality, setQuality] = useState<NetQuality | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    void measureNetwork().then((q) => alive && setQuality(q));
    const again = () => setN((x) => x + 1);
    const c = conn();
    c?.addEventListener?.("change", again);
    window.addEventListener("online", again);
    window.addEventListener("offline", again);
    return () => { alive = false; c?.removeEventListener?.("change", again); window.removeEventListener("online", again); window.removeEventListener("offline", again); };
  }, [n]);
  const tier = effectiveTier(quality?.tier ?? "lite", getVoicePreference(), getLowData());
  return { quality, tier, recheck: () => setN((x) => x + 1) };
}

// ---------------- during a live call ----------------

export interface CallHealth { underruns: number; lateChunks: number; sendBacklogMs: number; windowMs: number }

/**
 * Should a live call step down to tap-to-talk? Yes when the audio keeps running dry, arrives in bursts, or our own
 * voice can't get out fast enough. One hiccup is fine; a pattern is not.
 */
export function shouldStepDown(h: CallHealth): boolean {
  const perTenSeconds = (x: number) => (x * 10_000) / Math.max(1000, h.windowMs);
  return perTenSeconds(h.underruns) >= 3 || perTenSeconds(h.lateChunks) >= 6 || h.sendBacklogMs > 2500;
}

/** How much audio to hold before playing: more on a shaky line (a little more delay, but no gaps). */
export const jitterBufferMs = (rttMs: number | null, recentUnderruns: number): number => Math.min(600, Math.max(120, (rttMs ?? 200) * 0.6 + recentUnderruns * 80));
