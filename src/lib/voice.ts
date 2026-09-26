// A natural, warm female voice for Asha. Browsers ship several voices; the "Natural" / "Online" neural ones (Edge,
// Windows 11) sound close to a real person, the older ones sound robotic. We score every voice on the device and pick
// the most natural female one for the language, then speak sentence by sentence with small pauses, the way people do.

const FEMALE = /\b(neerja|swara|heera|kalpana|aria|jenny|sonia|libby|natasha|clara|emma|ava|michelle|sara|zira|hazel|susan|catherine|linda|heather|samantha|karen|tessa|moira|fiona|veena|lekha|kiara|female|woman|google (uk english female|us english|हिन्दी|hindi))\b/i;
const MALE = /\b(prabhat|madhur|ravi|hemant|kumar|david|mark|guy|ryan|george|daniel|james|thomas|eric|brian|christopher|roger|steffan|william|male|man)\b/i;

let cache: { lang: string; voice: SpeechSynthesisVoice | null } | null = null;

function score(v: SpeechSynthesisVoice, lang: string): number {
  let s = 0;
  const name = v.name;
  if (/natural/i.test(name)) s += 120; // Edge neural voices
  else if (/online/i.test(name)) s += 90;
  else if (/google/i.test(name)) s += 45; // Chrome's cloud voices are decent
  if (v.lang === lang) s += 50;
  else if (v.lang.startsWith(lang.slice(0, 2))) s += lang === "en-IN" && /en-(GB|US|AU)/.test(v.lang) ? 22 : 25;
  else s -= 400;
  if (FEMALE.test(name)) s += 40;
  if (MALE.test(name)) s -= 150;
  if (v.localService === false) s += 5;
  return s;
}

/** The best voice for this language on this device (or null if there is none). */
export function bestVoice(lang: "en-IN" | "hi-IN"): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  if (cache?.lang === lang && cache.voice) return cache.voice;
  const best = [...voices].sort((a, b) => score(b, lang) - score(a, lang))[0];
  const voice = best && score(best, lang) > -100 ? best : null;
  cache = { lang, voice };
  return voice;
}

// Voices load asynchronously in most browsers: forget the cached choice when the list changes.
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.addEventListener?.("voiceschanged", () => { cache = null; });
  window.speechSynthesis.getVoices();
}

/** Say things the way a person would, not the way they are written. */
export function forSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|]/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/₹\s?([\d.]+)\s?[–-]\s?([\d.]+)\s?LPA/gi, "$1 to $2 lakh a year")
    .replace(/₹\s?([\d.]+)\s?LPA/gi, "$1 lakh a year")
    .replace(/\bLPA\b/g, "lakh a year")
    .replace(/₹\s?([\d,]+)/g, "$1 rupees")
    .replace(/\be\.g\./gi, "for example")
    .replace(/\bi\.e\./gi, "that is")
    .replace(/\byrs?\b/gi, "years")
    .replace(/\s·\s/g, ", ")
    .replace(/\s[–—]\s/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split into sentences so each gets its own natural rise and fall, with a short breath between them. */
export const sentences = (text: string): string[] => text.split(/(?<=[.!?।])\s+/).map((s) => s.trim()).filter(Boolean);

let token = 0;
/** Speak `text` warmly. Calls onEnd when finished or interrupted. Returns false when speech isn't available. */
export function speakNaturally(text: string, onEnd?: () => void): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const plain = forSpeech(text);
  if (!plain) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const my = ++token;
  const lang = /[ऀ-ॿ]/.test(plain) ? "hi-IN" : "en-IN";
  const voice = bestVoice(lang);
  const parts = sentences(plain);
  let i = 0;
  const next = () => {
    if (my !== token) return; // a newer message took over
    if (i >= parts.length) { onEnd?.(); return; }
    const u = new SpeechSynthesisUtterance(parts[i++]);
    u.lang = voice?.lang || lang;
    if (voice) u.voice = voice;
    // Neural voices already sound natural at normal speed; older ones sound less robotic a little slower and warmer.
    const neural = voice && /natural|online/i.test(voice.name);
    u.rate = neural ? 1 : 0.94;
    u.pitch = neural ? 1 : 1.08;
    u.onend = () => setTimeout(next, 140);
    u.onerror = () => { if (my === token) onEnd?.(); };
    synth.speak(u);
  };
  next();
  return true;
}

export function stopSpeech() {
  token++;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
