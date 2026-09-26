import { Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Me } from "../App";
import { api } from "../lib/api";
import { GUIDE_NAME, guideSpeak, guideStopSpeaking, setGuidePose, setGuideSettings, useGuidePose, useGuideSettings, useGuideSpeaking, useTalkingFrame, type GuidePose } from "../lib/guide";
import { useI18n } from "../lib/i18n";
import { useNav, type Page } from "../lib/nav";
import { cn } from "../ui";

interface Briefing { id: string; pose: GuidePose; lines: string[]; cta?: { label: string; page?: string; jobId?: string; chat?: string } }
interface Bubble { key: string; lines: string[]; cta?: Briefing["cta"]; speak: boolean }

// ---------------- art: real poses from /agent/<pose>.webp, or a friendly built-in face until they exist ----------------
const missing = new Set<string>();

/** Placeholder face, so the guide works before the artwork is added. */
function PlaceholderFace({ pose, mouthOpen }: { pose: GuidePose; mouthOpen: boolean }) {
  const happy = pose === "celebrating" || pose === "encouraging" || pose === "waving";
  return (
    <svg viewBox="0 0 120 130" className="h-full w-full drop-shadow-[0_8px_18px_rgba(0,0,0,.45)]" aria-hidden>
      <defs>
        <linearGradient id="gf-skin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#d99a72" /><stop offset="1" stopColor="#b97a55" /></linearGradient>
        <linearGradient id="gf-coat" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0f86ad" /><stop offset="1" stopColor="#0a5f80" /></linearGradient>
      </defs>
      <path d="M14 130c2-26 20-38 46-38s44 12 46 38z" fill="url(#gf-coat)" />
      <path d="M46 92l14 16 14-16" fill="#f4fbfd" />
      <circle cx="60" cy="108" r="3" fill="#f0bf4c" />
      <path d="M26 58c0-30 16-44 34-44s34 14 34 44c0 6-2 12-4 16H30c-2-4-4-10-4-16z" fill="#1e1a24" />
      <ellipse cx="60" cy="60" rx="27" ry="31" fill="url(#gf-skin)" />
      <path d="M33 52c6-20 18-26 28-26 12 0 24 8 28 26-8-12-20-16-30-15-10 0-20 5-26 15z" fill="#1e1a24" />
      <ellipse cx="50" cy="60" rx="3.2" ry={pose === "thinking" ? 2 : 3.6} fill="#2a1f22" />
      <ellipse cx="70" cy="60" rx="3.2" ry={pose === "thinking" ? 2 : 3.6} fill="#2a1f22" />
      <path d="M44 52q6-4 12 0M64 52q6-4 12 0" stroke="#2a1f22" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      {mouthOpen || pose === "talking" ? <ellipse cx="60" cy="77" rx="6" ry={mouthOpen ? 5 : 3} fill="#7a2f3a" /> : happy ? <path d="M50 74q10 12 20 0z" fill="#7a2f3a" /> : <path d="M52 76q8 6 16 0" stroke="#7a2f3a" strokeWidth="2.4" fill="none" strokeLinecap="round" />}
      <path d="M86 56c6 2 8 10 4 16" stroke="#34abc8" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      <circle cx="90" cy="73" r="3.6" fill="#22bf9b" />
      {pose === "celebrating" && [[20, 30], [100, 24], [14, 70], [106, 66]].map(([x, y], i) => <path key={i} d={`M${x} ${y - 5}l1.6 3.4 3.4 1.6-3.4 1.6-1.6 3.4-1.6-3.4-3.4-1.6 3.4-1.6z`} fill={i % 2 ? "#f0bf4c" : "#22bf9b"} />)}
      {pose === "thinking" && <g fill="#8fdaee"><circle cx="96" cy="30" r="2.5" /><circle cx="104" cy="22" r="3.5" /><circle cx="114" cy="12" r="4.5" /></g>}
    </svg>
  );
}

function Figure({ pose, speaking, className }: { pose: GuidePose; speaking: boolean; className?: string }) {
  const mouth = useTalkingFrame(speaking);
  const [, bump] = useState(0);
  // While speaking she alternates between her talking and idle art, so the mouth appears to move.
  const wanted: GuidePose = speaking ? (mouth ? "talking" : "idle") : pose;
  const usable = !missing.has(wanted) ? wanted : !missing.has("idle") ? "idle" : null;
  return (
    <div className={cn("guide-figure", speaking && "is-speaking", className)}>
      {usable ? (
        <img src={`/agent/${usable}.webp`} alt="" draggable={false} className="h-full w-auto select-none object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,.45)]"
          onError={() => { missing.add(usable); bump((n) => n + 1); }} />
      ) : <PlaceholderFace pose={speaking ? "talking" : pose} mouthOpen={speaking && mouth} />}
    </div>
  );
}

// ---------------- what she says on each page, once ----------------
const TIPS: Record<string, { en: string; hi: string }> = {
  home: { en: "This is your home base: today's steps, your weekly plan and your progress. Start with the first card.", hi: "यह आपका होम है: आज के काम, इस हफ़्ते की योजना और आपकी प्रगति। पहले कार्ड से शुरू कीजिए।" },
  matches: { en: "These jobs are ranked by how well they fit you. Tap one to see why. Tip: J and K move between jobs, S saves.", hi: "ये नौकरियाँ आपसे मेल के हिसाब से लगी हैं। किसी पर टैप करके वजह देखिए। J और K से आगे-पीछे जाइए, S से सेव कीजिए।" },
  search: { en: "Search every job here and narrow it with filters. Press Control K to jump anywhere in the app.", hi: "यहाँ हर नौकरी खोजिए और फ़िल्टर से छाँटिए। ऐप में कहीं भी जाने के लिए Control K दबाइए।" },
  applications: { en: "Drag a card to move it along. Tap Prep on any card to practise for the interview.", hi: "कार्ड को खींचकर आगे बढ़ाइए। इंटरव्यू की प्रैक्टिस के लिए Prep दबाइए।" },
  resume: { en: "Pick a template and download your resume. The health score shows what to fix.", hi: "टेम्पलेट चुनिए और रिज़्यूमे डाउनलोड कीजिए। हेल्थ स्कोर बताता है क्या सुधारना है।" },
  interview: { en: "Practise here. See the likely questions, then try a mock interview, out loud if you like.", hi: "यहाँ प्रैक्टिस कीजिए। संभावित सवाल देखिए, फिर मॉक इंटरव्यू आज़माइए, चाहें तो बोलकर।" },
  insights: { en: "See which skill would unlock the most matches, and how your search is going.", hi: "देखिए कौन सा स्किल सबसे ज़्यादा मैच खोलेगा, और आपकी खोज कैसी चल रही है।" },
  employer: { en: "Hiring? Post a job in a minute. Paste a WhatsApp message and I will tidy it up.", hi: "भर्ती करनी है? एक मिनट में जॉब डालिए। WhatsApp संदेश पेस्ट कीजिए, मैं उसे ठीक कर दूँगी।" },
  profile: { en: "Keep this accurate. Everything I do for you is built from it.", hi: "इसे सही रखिए। मैं जो भी करती हूँ वह इसी पर आधारित है।" },
  settings: { en: "You can change my voice, how often I speak, the theme and more here.", hi: "यहाँ आप मेरी आवाज़, मैं कितना बोलूँ, थीम और बहुत कुछ बदल सकते हैं।" },
  job: { en: "This page shows why the job fits you and what is missing. Prepare an application when you are ready.", hi: "यह पेज बताता है कि नौकरी आपसे क्यों मेल खाती है और क्या कम है। तैयार हों तो आवेदन बनाइए।" },
};
const SEEN_KEY = "mc_guide_tips";
const seenTips = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } catch { return []; } };
const markTip = (k: string) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...seenTips(), k])])); } catch { /* private mode */ } };

const typing = () => { const t = document.activeElement as HTMLElement | null; return Boolean(t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))); };
const dialogOpen = () => Boolean(document.querySelector("[role=dialog]"));

const MAX_PROACTIVE = 8; // per visit
const MIN_GAP_MS = 45_000;

export default function AgentGuide({ page, onJob, chatOpen, chatExpanded }: { me?: Me; page: Page; onJob: boolean; chatOpen: boolean; chatExpanded: boolean }) {
  const nav = useNav();
  const { lang } = useI18n();
  const settings = useGuideSettings();
  const pose = useGuidePose();
  const speaking = useGuideSpeaking();
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const lastShown = useRef(0);
  const count = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const [ready, setReady] = useState(false);

  const show = useCallback((b: Omit<Bubble, "key">, p?: GuidePose, force = false) => {
    if (settings.mode !== "active" && !force) return false;
    if (!force && (count.current >= MAX_PROACTIVE || Date.now() - lastShown.current < MIN_GAP_MS || typing() || dialogOpen())) return false;
    count.current++; lastShown.current = Date.now();
    setBubble({ ...b, key: `${Date.now()}` });
    if (p) setGuidePose(p, 6000);
    if (b.speak && settings.voice) guideSpeak(b.lines.join(" "));
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setBubble(null), Math.min(26000, 7000 + b.lines.join(" ").length * 90));
    return true;
  }, [settings.mode, settings.voice]);

  // One short reveal after the app loads, so she never blocks the first paint.
  useEffect(() => { const t = setTimeout(() => setReady(true), 1400); return () => clearTimeout(t); }, []);

  // The briefing: where you are, and the one thing to do next. Once per situation per visit.
  useEffect(() => {
    if (!ready || settings.mode !== "active") return;
    let cancelled = false;
    api<{ briefing: Briefing | null }>(`/agent/briefing?lang=${lang}`).then(({ briefing }) => {
      if (cancelled || !briefing) return;
      let seen: string | null = null;
      try { seen = sessionStorage.getItem("mc_guide_briefing"); } catch { /* ignore */ }
      if (seen === briefing.id) return;
      if (show({ lines: briefing.lines, cta: briefing.cta, speak: true }, briefing.pose === "talking" ? "waving" : briefing.pose, true)) {
        try { sessionStorage.setItem("mc_guide_briefing", briefing.id); } catch { /* ignore */ }
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [ready, lang, settings.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // A tip the first time you open each page.
  useEffect(() => {
    if (!ready || settings.mode !== "active" || chatOpen) return;
    const key = onJob ? "job" : page;
    const tip = TIPS[key];
    if (!tip || seenTips().includes(key)) return;
    const t = setTimeout(() => { if (show({ lines: [lang === "hi" ? tip.hi : tip.en], speak: true }, "pointing")) markTip(key); }, 3500);
    return () => clearTimeout(t);
  }, [ready, page, onJob, settings.mode, chatOpen, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cheers when you reach a milestone.
  useEffect(() => {
    const on = () => { setGuidePose("celebrating", 3500); if (settings.mode === "active") show({ lines: [lang === "hi" ? "शाबाश! बहुत बढ़िया!" : "Well done! That is real progress."], speak: settings.voice }, undefined, true); };
    window.addEventListener("guide:celebrate", on);
    return () => window.removeEventListener("guide:celebrate", on);
  }, [settings.mode, settings.voice, lang, show]);

  useEffect(() => () => { clearTimeout(hideTimer.current); guideStopSpeaking(); }, []);

  if (settings.mode === "off" || (chatOpen && chatExpanded)) return null;
  const dismiss = () => { setBubble(null); guideStopSpeaking(); };
  const act = (c: NonNullable<Bubble["cta"]>) => {
    dismiss();
    if (c.chat) return nav.openChat(c.chat);
    if (c.jobId) return nav.openJob(c.jobId);
    if (c.page) return nav.go(c.page as Page);
  };
  const shownPose: GuidePose = chatOpen && pose === "idle" ? "listening" : pose;

  return (
    <div className={cn("pointer-events-none fixed z-40 flex items-end gap-2 transition-[right] duration-200 max-sm:bottom-[76px] max-sm:right-2 bottom-3 right-4", chatOpen && "lg:right-[436px]", chatOpen && "max-lg:hidden")}>
      {bubble && (
        <div key={bubble.key} role="status" aria-live="polite" className="guide-bubble pointer-events-auto relative mb-14 max-w-[min(300px,calc(100vw-9rem))] rounded-2xl rounded-br-md border border-slate-200 bg-white p-3.5 text-sm text-slate-800 shadow-[var(--shadow-pop)] animate-slide-up sm:mb-20">
          <button onClick={dismiss} aria-label="Dismiss" className="absolute right-1.5 top-1.5 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-3.5 w-3.5" /></button>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-brand-600">{GUIDE_NAME}</p>
          <div className="space-y-1 pr-4">{bubble.lines.map((l, i) => <p key={i} className={i === 0 && bubble.lines.length > 1 ? "font-semibold text-ink" : ""}>{l}</p>)}</div>
          <div className="mt-2.5 flex items-center gap-2">
            {bubble.cta && <button onClick={() => act(bubble.cta!)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110">{bubble.cta.label}</button>}
            <button onClick={() => { setGuideSettings({ voice: !settings.voice }); }} aria-label={settings.voice ? "Turn my voice off" : "Turn my voice on"} title={settings.voice ? "Voice on" : "Voice off"} className="ml-auto rounded-md p-1.5 text-slate-500 hover:bg-slate-100">{settings.voice ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</button>
          </div>
        </div>
      )}
      <button onClick={() => { dismiss(); nav.openChat(); }} aria-label={`Talk to ${GUIDE_NAME}, your guide`} title={`Ask ${GUIDE_NAME}`}
        className={cn("guide-btn pointer-events-auto relative h-24 shrink-0 rounded-3xl transition hover:scale-105 focus-visible:outline-offset-4 sm:h-32",)}>
        <Figure pose={shownPose} speaking={speaking} className="h-full" />
        {(pose === "thinking") && <span className="absolute -top-1 right-0 flex gap-0.5 rounded-full bg-slate-900/70 px-2 py-1"><i className="typing-dot" /><i className="typing-dot" style={{ animationDelay: ".15s" }} /><i className="typing-dot" style={{ animationDelay: ".3s" }} /></span>}
      </button>
    </div>
  );
}
