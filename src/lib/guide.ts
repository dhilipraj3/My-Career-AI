import { useEffect, useState, useSyncExternalStore } from "react";
import { canSpeak, speak, stopSpeaking } from "./i18n";

// The guide (Asha): what she is doing (pose), her settings, and speaking. Everything here is per device.
export const GUIDE_NAME = "Asha";
export type GuidePose = "idle" | "talking" | "listening" | "thinking" | "pointing" | "celebrating" | "encouraging" | "waving";
export type GuideMode = "active" | "quiet" | "off";
export interface GuideSettings { mode: GuideMode; voice: boolean }

const KEY = "mc_guide";
const DEFAULTS: GuideSettings = { mode: "active", voice: true };

let settings: GuideSettings = (() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return DEFAULTS; } })();
const settingListeners = new Set<() => void>();
export const getGuideSettings = () => settings;
export function setGuideSettings(patch: Partial<GuideSettings>) {
  settings = { ...settings, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  if (patch.voice === false) stopSpeaking();
  settingListeners.forEach((l) => l());
}
export const useGuideSettings = () => useSyncExternalStore((cb) => { settingListeners.add(cb); return () => settingListeners.delete(cb); }, getGuideSettings);

/** Asha's live-call voice (Gemini voice name). Warm, clear voices only; the server rejects anything else. */
export const ASHA_VOICES: Array<{ id: string; label: string }> = [
  { id: "Sulafat", label: "Warm" }, { id: "Achernar", label: "Soft" }, { id: "Aoede", label: "Breezy" },
  { id: "Vindemiatrix", label: "Gentle" }, { id: "Leda", label: "Youthful" }, { id: "Kore", label: "Firm" },
];
export const getAshaVoice = (): string => { try { return localStorage.getItem("mc_asha_voice") || "Sulafat"; } catch { return "Sulafat"; } };
export const setAshaVoice = (v: string) => { try { localStorage.setItem("mc_asha_voice", v); } catch { /* private mode */ } };

// ---------------- pose bus: other parts of the app (the chat) can make her think or talk ----------------
let pose: GuidePose = "idle";
let holdTimer: ReturnType<typeof setTimeout> | undefined;
const poseListeners = new Set<() => void>();
const emitPose = () => poseListeners.forEach((l) => l());
/** Set her pose. With `holdMs` she returns to idle afterwards (used for short reactions). */
export function setGuidePose(p: GuidePose, holdMs?: number) {
  clearTimeout(holdTimer);
  pose = p;
  emitPose();
  if (holdMs) holdTimer = setTimeout(() => { pose = "idle"; emitPose(); }, holdMs);
}
export const getGuidePose = () => pose;
export const useGuidePose = () => useSyncExternalStore((cb) => { poseListeners.add(cb); return () => poseListeners.delete(cb); }, () => pose);

// ---------------- speaking ----------------
let speakingNow = false;
const speakListeners = new Set<() => void>();
export const useGuideSpeaking = () => useSyncExternalStore((cb) => { speakListeners.add(cb); return () => speakListeners.delete(cb); }, () => speakingNow);
const setSpeaking = (v: boolean) => { speakingNow = v; speakListeners.forEach((l) => l()); };

/** Browsers only allow speech after the person has interacted with the page. */
const activated = () => (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;
let waiting: string | null = null;
let waitingBound = false;

function say(text: string) {
  setSpeaking(true);
  const ok = speak(text, { onEnd: () => setSpeaking(false) });
  if (!ok) setSpeaking(false);
}

/** Read text aloud in her voice, if voice is on. Waits for the first click or key press if the browser needs one. */
export function guideSpeak(text: string) {
  if (!canSpeak || !settings.voice || settings.mode === "off") return;
  if (activated()) return say(text);
  waiting = text;
  if (waitingBound) return;
  waitingBound = true;
  const go = () => { window.removeEventListener("pointerdown", go); window.removeEventListener("keydown", go); waitingBound = false; if (waiting && settings.voice) say(waiting); waiting = null; };
  window.addEventListener("pointerdown", go, { once: true });
  window.addEventListener("keydown", go, { once: true });
}
export function guideStopSpeaking() { waiting = null; stopSpeaking(); setSpeaking(false); }

/** A short version of a chat reply for the voice: plain text, first sentences, never a wall of speech. */
export function speakable(markdown: string, max = 260): string {
  const plain = markdown.replace(/```[\s\S]*?```/g, " ").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>|]/g, "").replace(/^\s*[-•]\s*/gm, "").replace(/\s+/g, " ").trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "), cut.lastIndexOf("। "));
  return (end > 80 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "")) ;
}

/** While she is speaking, alternate between two poses so her mouth appears to move. */
export function useTalkingFrame(speaking: boolean, tick = 230): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!speaking) { setOpen(false); return; }
    const t = setInterval(() => setOpen((o) => !o), tick);
    return () => clearInterval(t);
  }, [speaking, tick]);
  return open;
}

// ---------------- reactions ----------------
export const celebrateEvent = "guide:celebrate";
