// English + Hindi UI strings. The conversation (assistant, questions) follows the chosen language too; stored profile
// data stays in English so matching and resumes work the same for everyone.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { speakNaturally, stopSpeech } from "./voice";

export type Lang = "en" | "hi";
const KEY = "mc_lang";

const STRINGS = {
  // navigation & chrome
  "nav.home": ["Home", "होम"],
  "nav.matches": ["For you", "आपके लिए"],
  "nav.search": ["Search jobs", "नौकरी खोजें"],
  "nav.applications": ["Applications", "आवेदन"],
  "nav.resume": ["Resumes", "रिज़्यूमे"],
  "nav.interview": ["Interview prep", "इंटरव्यू तैयारी"],
  "nav.insights": ["Insights", "जानकारी"],
  "nav.employer": ["For employers", "नियोक्ताओं के लिए"],
  "nav.profile": ["Profile", "प्रोफ़ाइल"],
  "nav.settings": ["Settings", "सेटिंग्स"],
  "nav.admin": ["Admin", "एडमिन"],
  "nav.you": ["You", "आप"],
  "nav.more": ["More", "और"],
  "nav.jobDetails": ["Job details", "नौकरी का विवरण"],
  "chrome.assistant": ["Assistant", "सहायक"],
  "chrome.search": ["Search jobs, pages…", "नौकरी या पेज खोजें…"],
  "chrome.notifications": ["Notifications", "सूचनाएँ"],
  "chrome.unlockAi": ["Unlock unlimited AI", "असीमित AI चालू करें"],
  "chrome.unlockAiHint": ["Add your free Google key in about a minute.", "एक मिनट में अपनी मुफ़्त Google key जोड़ें।"],
  // common
  "common.send": ["Send", "भेजें"],
  "common.skip": ["Skip", "छोड़ें"],
  "common.next": ["Next", "आगे"],
  "common.save": ["Save", "सहेजें"],
  "common.yes": ["Yes", "हाँ"],
  "common.no": ["No", "नहीं"],
  "common.speak": ["Speak", "बोलें"],
  "common.typeAnswer": ["Type your answer…", "अपना जवाब लिखें…"],
  "common.gotIt": ["Got it", "समझ गया"],
  // understanding
  "u.title": ["What I understand about you", "मैं आपके बारे में क्या समझता हूँ"],
  "u.score": ["Understanding", "समझ"],
  "u.ready": ["I understand you well — full-power search is on.", "मैं आपको अच्छी तरह समझता हूँ — पूरी ताकत से खोज चालू है।"],
  "u.notReady": ["A few quick answers will sharpen your matches.", "कुछ छोटे जवाब आपके मैच बेहतर कर देंगे।"],
  "u.nextQuestion": ["Quick question", "एक छोटा सवाल"],
  "u.why": ["Why I ask", "क्यों पूछ रहा हूँ"],
  "u.guesses": ["Is this right?", "क्या यह सही है?"],
  "u.details": ["See details", "विवरण देखें"],
  "u.hideDetails": ["Hide details", "विवरण छिपाएँ"],
  "u.allDone": ["That's everything I need for now.", "अभी के लिए मुझे बस इतना ही चाहिए।"],
  // no-resume interview
  "iv.title": ["No resume? Just talk to me", "रिज़्यूमे नहीं है? बस मुझसे बात करें"],
  "iv.sub": ["Answer 4 short questions — type or speak, in English or Hindi.", "4 छोटे सवालों के जवाब दें — लिखकर या बोलकर, हिंदी या अंग्रेज़ी में।"],
  "iv.start": ["Start talking", "बात शुरू करें"],
  "iv.understood": ["I understood", "मैंने समझा"],
  "iv.done": ["Great — I've built your profile.", "बढ़िया — मैंने आपकी प्रोफ़ाइल बना दी है।"],
  // role paths
  "rp.title": ["Your role paths", "आपके लिए सही भूमिकाएँ"],
  "rp.sub": ["Roles you could target, with live openings, typical pay and how well you already fit.", "जिन भूमिकाओं को आप चुन सकते हैं — अभी की नौकरियाँ, आम वेतन और आपकी तैयारी।"],
  "rp.target": ["Target this role", "यह भूमिका चुनें"],
  "rp.targeted": ["Targeted", "चुनी गई"],
  "rp.jobs": ["live jobs in India", "भारत में अभी की नौकरियाँ"],
  "rp.near": ["near you", "आपके पास"],
  "rp.pay": ["typical pay", "आम वेतन"],
  "rp.fit": ["skills match", "कौशल मेल"],
  "rp.have": ["You have", "आपके पास है"],
  "rp.missing": ["Often asked for", "अक्सर माँगा जाता है"],
  // resume builder
  "rb.title": ["Build my resume", "मेरा रिज़्यूमे बनाएँ"],
  "rb.sub": ["Made only from facts on your profile — nothing invented. Choose a style and download a PDF.", "सिर्फ़ आपकी प्रोफ़ाइल की सच्ची जानकारी से — कुछ भी मनगढ़ंत नहीं। एक स्टाइल चुनें और PDF डाउनलोड करें।"],
  "rb.download": ["Download PDF", "PDF डाउनलोड करें"],
  "rb.health": ["Resume health", "रिज़्यूमे की सेहत"],
  "rb.fixes": ["How to improve it", "इसे कैसे सुधारें"],
  // settings
  "set.language": ["Language", "भाषा"],
  "set.languageHint": ["The app and the assistant speak this language. Your resume stays in English.", "ऐप और सहायक इसी भाषा में बात करेंगे। आपका रिज़्यूमे अंग्रेज़ी में ही रहेगा।"],
  "set.largeText": ["Large text", "बड़े अक्षर"],
  "set.largeTextHint": ["Bigger text and buttons everywhere.", "हर जगह बड़े अक्षर और बटन।"],
} as const satisfies Record<string, readonly [string, string]>;

export type StringKey = keyof typeof STRINGS;

interface Ctx { lang: Lang; setLang: (l: Lang) => void; t: (k: StringKey) => string }
const I18n = createContext<Ctx>({ lang: "en", setLang: () => undefined, t: (k) => STRINGS[k][0] });

export function getStoredLang(): Lang {
  try { return localStorage.getItem(KEY) === "hi" ? "hi" : "en"; } catch { return "en"; }
}

export function I18nProvider({ children, onChange }: { children: ReactNode; onChange?: (l: Lang) => void }) {
  const [lang, setLangState] = useState<Lang>(getStoredLang);
  useEffect(() => { document.documentElement.lang = lang === "hi" ? "hi-IN" : "en-IN"; }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
    onChange?.(l);
  }, [onChange]);
  const value = useMemo<Ctx>(() => ({ lang, setLang, t: (k) => STRINGS[k][lang === "hi" ? 1 : 0] }), [lang, setLang]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export const useI18n = () => useContext(I18n);

// ---------------- large text ----------------
const LARGE = "mc_large_text";
export function getLargeText(): boolean {
  try { return localStorage.getItem(LARGE) === "1"; } catch { return false; }
}
export function setLargeText(on: boolean) {
  try { localStorage.setItem(LARGE, on ? "1" : "0"); } catch { /* ignore */ }
  document.documentElement.classList.toggle("large-text", on);
}
export const applyStoredLargeText = () => document.documentElement.classList.toggle("large-text", getLargeText());

// ---------------- read aloud ----------------
/** Read text aloud in a natural voice (see ./voice.ts). Hindi text uses a Hindi voice when available. */
export function speak(text: string, opts: { onEnd?: () => void } = {}) {
  return speakNaturally(text, opts.onEnd);
}
export const stopSpeaking = () => stopSpeech();
export const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
