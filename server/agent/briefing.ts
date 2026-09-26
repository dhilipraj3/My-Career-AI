// The guide's briefing: a short, spoken-style status of where the person is and the one thing to do next. Built from
// real data by rules (no AI credits), in English or Hindi. The client decides when and whether to speak it.
import type { Journey, NextAction } from "../../shared/career.js";
import { feedSummary } from "../matching/feed.js";
import { getProfile } from "../profile/service.js";
import { journeyFor } from "../companion/service.js";

export type GuidePose = "idle" | "talking" | "listening" | "thinking" | "pointing" | "celebrating" | "encouraging" | "waving";
export type GuideLang = "en" | "hi";

export interface Briefing {
  /** Changes only when the situation changes, so the client can avoid repeating itself. */
  id: string;
  pose: GuidePose;
  /** Short, speakable sentences (the bubble shows them, the voice reads them). */
  lines: string[];
  cta?: { label: string; page?: string; jobId?: string; chat?: string };
}

const IST_OFFSET_MS = 5.5 * 3_600_000;
export const partOfDay = (now = Date.now()): "morning" | "afternoon" | "evening" => {
  const h = new Date(now + IST_OFFSET_MS).getUTCHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
};

const T = {
  en: {
    hello: (p: string, n: string) => `Good ${p}${n ? `, ${n}` : ""}!`,
    understanding: "Let's finish your profile first, so I can find jobs that truly fit you.",
    searching: (total: number, exc: number) => exc > 0 ? `I'm watching your job matches. ${exc} look excellent.` : total > 0 ? `I found ${total} jobs that could fit you. Let's find your best ones.` : "I'm searching every source for you. I'll tell you the moment something fits.",
    applying: (n: number) => `You have ${n} application${n === 1 ? "" : "s"} in progress.`,
    interview: (co: string, when: string) => `You have an interview with ${co} ${when}. Let's get you ready.`,
    offer: (co: string) => `Congratulations! ${co} has made you an offer. Let's look at it together.`,
    placed: (co: string) => `You're placed at ${co}. I'm so proud of you!`,
    today: { today: "today", tomorrow: "tomorrow" },
    inDays: (n: number) => `in ${n} days`,
    ctaDefault: "What should I do next?",
  },
  hi: {
    hello: (p: string, n: string) => `${{ morning: "सुप्रभात", afternoon: "नमस्ते", evening: "शुभ संध्या" }[p as "morning"]}${n ? ` ${n}` : ""}!`,
    understanding: "पहले आपकी प्रोफ़ाइल पूरी कर लेते हैं, ताकि मैं आपके लिए सही नौकरियाँ ढूँढ सकूँ।",
    searching: (total: number, exc: number) => exc > 0 ? `मैं आपके जॉब मैच देख रही हूँ। ${exc} बहुत अच्छे लग रहे हैं।` : total > 0 ? `मुझे ${total} नौकरियाँ मिली हैं जो आपके लिए ठीक हो सकती हैं। चलिए सबसे अच्छी चुनते हैं।` : "मैं हर जगह आपके लिए खोज रही हूँ। कुछ मिलते ही बताऊँगी।",
    applying: (n: number) => `आपके ${n} आवेदन चल रहे हैं।`,
    interview: (co: string, when: string) => `${co} के साथ आपका इंटरव्यू ${when} है। चलिए तैयारी करते हैं।`,
    offer: (co: string) => `बधाई हो! ${co} ने आपको ऑफ़र दिया है। साथ में देखते हैं।`,
    placed: (co: string) => `आपकी नौकरी ${co} में लग गई। मुझे आप पर गर्व है!`,
    today: { today: "आज", tomorrow: "कल" },
    inDays: (n: number) => `${n} दिन में`,
    ctaDefault: "आगे क्या करूँ?",
  },
} as const;

const whenOf = (at: string, lang: GuideLang, now: number) => {
  const days = Math.max(0, Math.ceil((new Date(at).getTime() - now) / 86_400_000));
  return days <= 0 ? T[lang].today.today : days === 1 ? T[lang].today.tomorrow : T[lang].inDays(days);
};

export function composeBriefing(j: Journey, opts: { name: string; lang: GuideLang; total: number; excellent: number; now?: number }): Briefing {
  const now = opts.now ?? Date.now();
  const t = T[opts.lang];
  const hello = t.hello(partOfDay(now), opts.name);
  const top: NextAction | undefined = j.actions[0];
  const cta = top ? { label: top.cta.label, page: top.cta.page, jobId: top.cta.jobId, chat: top.cta.chat } : { label: t.ctaDefault, chat: opts.lang === "hi" ? "मुझे आगे क्या करना चाहिए?" : "What should I do next?" };

  if (j.placement) return { id: `placed:${j.placement.company}`, pose: "celebrating", lines: [hello, t.placed(j.placement.company)], cta: { label: opts.lang === "hi" ? "पहले 90 दिन" : "First 90 days", chat: opts.lang === "hi" ? "मेरे पहले 90 दिन की तैयारी करवाइए" : "Help me prepare for my first 90 days" } };
  const offer = j.actions.find((a) => a.kind === "offer");
  if (offer) return { id: `offer:${offer.id}`, pose: "celebrating", lines: [hello, t.offer(offer.title.replace(/^You have an offer from /, ""))], cta };
  const next = j.pulse.upcoming[0];
  if (next) return { id: `interview:${next.applicationId}:${next.at}`, pose: "encouraging", lines: [hello, t.interview(next.company, whenOf(next.at, opts.lang, now))], cta: { label: opts.lang === "hi" ? "तैयारी करें" : "Prepare", page: "interview" } };

  const lines = [hello];
  let pose: GuidePose = "talking";
  if (j.stage === "understanding") lines.push(t.understanding);
  else if (j.stage === "searching") { lines.push(t.searching(opts.total, opts.excellent)); if (opts.excellent > 0) pose = "pointing"; }
  else lines.push(t.applying(j.pulse.active));
  if (top && top.kind !== "interview" && top.kind !== "offer") lines.push(`${top.title}.`);
  return { id: `${j.stage}:${opts.excellent}:${top?.id || "none"}`, pose, lines: lines.slice(0, 3), cta };
}

export async function briefingFor(uid: string, lang: GuideLang, now = Date.now()): Promise<Briefing | null> {
  const profile = await getProfile(uid);
  const journey = await journeyFor(uid, now);
  if (!profile || !journey) return null;
  const feed = await feedSummary(uid).catch(() => null);
  const name = (profile.fullName || "").trim().split(/\s+/)[0] || "";
  return composeBriefing(journey, { name, lang, total: feed?.total || 0, excellent: feed?.bands.excellent || 0, now });
}
