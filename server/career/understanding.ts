// How well do we understand this person? Six areas, each scored from evidence, plus a planner that asks the single
// most useful next question (the area with the most uncertainty, weighted by how much it changes their matches).
import { experienceText, wholeYears } from "../../shared/format.js";
import type { CandidateProfile } from "../../shared/types.js";
import type { Guess, QuestionChoice, Understanding, UnderstandingArea, UnderstandingAreaId, UnderstandingQuestion } from "../../shared/career.js";
import { getFeed } from "../matching/service.js";
import { displayName } from "../nlp/skills.js";

export type Lang = "en" | "hi";
export const THRESHOLD = 70;

const WEIGHTS: Record<UnderstandingAreaId, number> = { role: 30, skills: 20, experience: 12, locationPay: 18, availability: 12, motivation: 8 };

const T = {
  en: {
    area: { role: "Target role", skills: "Skills", experience: "Experience", locationPay: "Location & pay", availability: "Availability", motivation: "What matters to you" },
    q: {
      role: "Which roles do you want next?",
      role_why: "Your target role decides which jobs I look for — it changes your matches the most.",
      skills_confirm: "I think you may have these skills. Which ones are true?",
      skills_confirm_why: "I only use skills you confirm, so your matches and resumes stay honest.",
      skills_add: "Many good jobs for you ask for these. Have you used any of them?",
      skills_add_why: "Each confirmed skill can turn good matches into excellent ones.",
      skills_free: "What are you good at? List skills, tools, machines or languages you know.",
      experience: "How much work experience do you have?",
      experience_confirm: (y: string) => `Your resume suggests about ${y} of experience. Is that right?`,
      experience_confirm_why: "Your resume's job dates weren't all clear, so I estimated. Employers filter by experience.",
      yes_about: (y: string) => `Yes, about ${y}`,
      shifts: "Which working hours can you do?",
      shifts_why: "Many jobs (support, operations, healthcare, delivery) have night or rotational shifts. I'll keep the ones you can't do out of your top matches.",
      experience_why: "Employers filter by experience; this keeps you from seeing jobs that are too junior or too senior.",
      locations: "Where would you like to work?",
      locations_why: "Jobs outside your cities are scored lower unless you're open to relocating.",
      salary: "What's the minimum pay you'd accept?",
      salary_why: "I'll hide jobs that pay less than this (when they show pay).",
      notice: "When can you join a new job?",
      notice_why: "Many openings need someone who can join soon.",
      workModes: "How do you want to work?",
      workModes_why: "Remote, hybrid or in-office changes which jobs fit you.",
      employment: "What kind of job are you looking for?",
      employment_why: "Full-time, part-time, contract or internship.",
      motivation: "What matters most in your next job?",
      motivation_why: "I'll use this to rank similar jobs and explain the trade-offs.",
      other: "Type your answer…",
    },
    c: {
      fresher: "Fresher", lt1: "Less than 1 year", y1_3: "1–3 years", y3_5: "3–5 years", y5_10: "5–10 years", y10: "10+ years",
      anywhere: "Anywhere in India", relocate: "I can relocate", flexible: "Flexible", immediate: "Immediately", d15: "15 days", d30: "30 days", d60: "60 days", d90: "90 days",
      remote: "Remote", hybrid: "Hybrid", onsite: "In-office", any: "Any", full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship",
      day: "Day shift", night: "Night shift", rotational: "Rotational shifts", flexHours: "Flexible hours", anyShift: "Any shift",
      none: "None of these",
      m: { growth: "Career growth", pay: "Better pay", stability: "Job security", balance: "Work-life balance", learning: "Learning new skills", near: "Close to home", brand: "A well-known company", impact: "Meaningful work" },
    },
  },
  hi: {
    area: { role: "लक्ष्य भूमिका", skills: "कौशल", experience: "अनुभव", locationPay: "जगह और वेतन", availability: "उपलब्धता", motivation: "आपके लिए क्या ज़रूरी है" },
    q: {
      role: "आप आगे कौन-सी नौकरी (भूमिका) चाहते हैं?",
      role_why: "आपकी लक्ष्य भूमिका से तय होता है कि मैं कौन-सी नौकरियाँ खोजूँ — इससे मैच सबसे ज़्यादा बदलते हैं।",
      skills_confirm: "मुझे लगता है आपके पास ये कौशल हो सकते हैं। इनमें से कौन-से सही हैं?",
      skills_confirm_why: "मैं केवल वही कौशल इस्तेमाल करता हूँ जिनकी आप पुष्टि करते हैं।",
      skills_add: "आपके लिए कई अच्छी नौकरियाँ ये माँगती हैं। क्या आपने इनमें से किसी पर काम किया है?",
      skills_add_why: "हर पुष्टि किया गया कौशल अच्छे मैच को बेहतरीन बना सकता है।",
      skills_free: "आप किसमें अच्छे हैं? अपने कौशल, टूल, मशीनें या भाषाएँ लिखें।",
      experience: "आपके पास कितना कार्य-अनुभव है?",
      experience_confirm: (y: string) => `आपके रिज़्यूमे से लगभग ${y} का अनुभव लगता है। क्या यह सही है?`,
      experience_confirm_why: "रिज़्यूमे में सभी तारीखें साफ़ नहीं थीं, इसलिए मैंने अंदाज़ा लगाया।",
      yes_about: (y: string) => `हाँ, लगभग ${y}`,
      shifts: "आप किस शिफ़्ट में काम कर सकते हैं?",
      shifts_why: "कई नौकरियों में रात या रोटेशनल शिफ़्ट होती है। जो आप नहीं कर सकते, वे आपके शीर्ष मैच में नहीं आएँगी।",
      experience_why: "कंपनियाँ अनुभव के हिसाब से छाँटती हैं।",
      locations: "आप कहाँ काम करना चाहेंगे?",
      locations_why: "आपके शहरों के बाहर की नौकरियों का स्कोर कम रहता है, जब तक आप शहर बदलने को तैयार न हों।",
      salary: "आप कम से कम कितना वेतन लेंगे?",
      salary_why: "इससे कम वेतन वाली नौकरियाँ मैं छिपा दूँगा।",
      notice: "आप नई नौकरी कब से शुरू कर सकते हैं?",
      notice_why: "कई नौकरियों में जल्दी जॉइन करने वाले चाहिए।",
      workModes: "आप कैसे काम करना चाहते हैं?",
      workModes_why: "घर से, हाइब्रिड या ऑफिस — इससे सही नौकरियाँ बदलती हैं।",
      employment: "आप किस तरह की नौकरी ढूँढ रहे हैं?",
      employment_why: "फुल-टाइम, पार्ट-टाइम, कॉन्ट्रैक्ट या इंटर्नशिप।",
      motivation: "अगली नौकरी में आपके लिए सबसे ज़रूरी क्या है?",
      motivation_why: "इससे मैं मिलती-जुलती नौकरियों को सही क्रम में दिखाऊँगा।",
      other: "अपना जवाब लिखें…",
    },
    c: {
      fresher: "फ्रेशर", lt1: "1 साल से कम", y1_3: "1–3 साल", y3_5: "3–5 साल", y5_10: "5–10 साल", y10: "10+ साल",
      anywhere: "भारत में कहीं भी", relocate: "मैं शहर बदल सकता/सकती हूँ", flexible: "कोई शर्त नहीं", immediate: "तुरंत", d15: "15 दिन", d30: "30 दिन", d60: "60 दिन", d90: "90 दिन",
      remote: "घर से (रिमोट)", hybrid: "हाइब्रिड", onsite: "ऑफिस से", any: "कोई भी", full_time: "फुल-टाइम", part_time: "पार्ट-टाइम", contract: "कॉन्ट्रैक्ट", internship: "इंटर्नशिप",
      day: "दिन की शिफ़्ट", night: "रात की शिफ़्ट", rotational: "रोटेशनल शिफ़्ट", flexHours: "लचीला समय", anyShift: "कोई भी शिफ़्ट",
      none: "इनमें से कोई नहीं",
      m: { growth: "करियर में तरक्की", pay: "बेहतर वेतन", stability: "नौकरी की सुरक्षा", balance: "काम और जीवन का संतुलन", learning: "नई चीज़ें सीखना", near: "घर के पास", brand: "नामी कंपनी", impact: "सार्थक काम" },
    },
  },
} as const;

export const MOTIVATIONS = ["growth", "pay", "stability", "balance", "learning", "near", "brand", "impact"] as const;
const POPULAR_CITIES = ["Bengaluru", "Hyderabad", "Chennai", "Mumbai", "Pune", "Delhi", "Gurugram", "Noida", "Kolkata", "Ahmedabad"];

const answered = (p: CandidateProfile, key: string) => Boolean(p.provenance[`preferences.${key}`]);
const years = (n: number) => experienceText(n);

/** Skills the user's good/fair matches keep asking for that the profile doesn't have (and that aren't soft skills). */
async function gapSkills(uid: string, limit = 6): Promise<string[]> {
  const feed = await getFeed(uid, { minScore: 50, limit: 400 }).catch(() => []);
  const counts = new Map<string, number>();
  for (const { match } of feed) if (match.score < 80) for (const s of match.missingSkills) counts.set(s, (counts.get(s) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k]) => k);
}

function salaryChoices(p: CandidateProfile, t: (typeof T)[Lang]): QuestionChoice[] {
  const lvl = p.insights.careerLevel;
  const lpa = lvl === "fresher" ? [1.8, 3, 4.5] : lvl === "junior" ? [3, 5, 8] : lvl === "mid" ? [8, 12, 18] : [15, 25, 35];
  return [
    ...lpa.map((n) => ({ value: `lpa:${n}`, label: n < 3 ? `₹${Math.round((n * 100000) / 12 / 1000)}k/month` : `${n} LPA` })),
    { value: "lpa:0", label: t.c.flexible },
  ];
}

export function areasFor(p: CandidateProfile, lang: Lang = "en"): UnderstandingArea[] {
  const t = T[lang];
  const pr = p.preferences;
  const areas: UnderstandingArea[] = [];

  // Target role
  const roleSource = p.provenance["preferences.targetRoles"];
  const role: UnderstandingArea = { id: "role", label: t.area.role, score: 0, evidence: [], gaps: [] };
  if (pr.targetRoles.length && roleSource === "user") { role.score = 100; role.evidence.push(`You chose: ${pr.targetRoles.join(", ")}`); }
  else if (pr.targetRoles.length) { role.score = 55; role.evidence.push(`Guessed from your resume: ${pr.targetRoles.join(", ")}`); role.gaps.push("Confirm or change the roles I guessed"); }
  else if (p.currentRole) { role.score = 35; role.evidence.push(`Current role: ${p.currentRole}`); role.gaps.push("Tell me which roles you want next"); }
  else role.gaps.push("I don't know which roles you want yet");
  areas.push(role);

  // Skills (soft skills don't count: every job asks for "communication")
  const verified = p.skills.filter((s) => s.source !== "ai_derived" && s.category !== "soft");
  const guessed = p.skills.filter((s) => s.source === "ai_derived");
  const fromUser = verified.filter((s) => s.source === "user").length;
  const skills: UnderstandingArea = { id: "skills", label: t.area.skills, score: Math.min(100, verified.length * 10), evidence: [], gaps: [] };
  if (verified.length) skills.evidence.push(`${verified.length} skills${fromUser ? ` (${fromUser} added or confirmed by you)` : " from your resume"}: ${verified.slice(0, 6).map((s) => s.name).join(", ")}${verified.length > 6 ? "…" : ""}`);
  if (guessed.length) { skills.score = Math.max(0, skills.score - 10); skills.gaps.push(`${guessed.length} skill${guessed.length === 1 ? "" : "s"} I guessed need your OK`); }
  if (verified.length < 5) skills.gaps.push("A few more skills would sharpen your matches");
  areas.push(skills);

  // Experience
  const exp: UnderstandingArea = { id: "experience", label: t.area.experience, score: 0, evidence: [], gaps: [] };
  if (p.provenance.totalExperienceYears === "user") { exp.score = 100; exp.evidence.push(p.totalExperienceYears ? `${years(p.totalExperienceYears)} (you told me)` : "Fresher (you told me)"); }
  else if (p.experience.some((e) => e.startDate)) { exp.score = 90; exp.evidence.push(`${p.experience.length} role${p.experience.length === 1 ? "" : "s"} from your resume · ${years(p.totalExperienceYears)} years`); }
  else if (p.totalExperienceYears > 0) { exp.score = 60; exp.evidence.push(`About ${years(p.totalExperienceYears)}`); exp.gaps.push("Confirm your total experience"); }
  else if (p.education.length && p.insights.careerLevel === "fresher") { exp.score = 70; exp.evidence.push(`Starting out · ${p.education[0].degree}`); exp.gaps.push("Confirm you're a fresher"); }
  else exp.gaps.push("I don't know your experience yet");
  areas.push(exp);

  // Location & pay
  const lp: UnderstandingArea = { id: "locationPay", label: t.area.locationPay, score: 0, evidence: [], gaps: [] };
  if (pr.locations.length || answered(p, "locations")) { lp.score += 50; lp.evidence.push(pr.locations.length ? `Cities: ${pr.locations.join(", ")}${pr.willingToRelocate ? " · open to relocating" : ""}` : "Any location"); }
  else lp.gaps.push("Where you want to work");
  if (pr.minSalaryLPA !== undefined || answered(p, "minSalaryLPA")) { lp.score += 50; lp.evidence.push(pr.minSalaryLPA ? `From ₹${pr.minSalaryLPA} LPA` : "Flexible on pay"); }
  else lp.gaps.push("Your minimum pay");
  areas.push(lp);

  // Availability
  const av: UnderstandingArea = { id: "availability", label: t.area.availability, score: 0, evidence: [], gaps: [] };
  if (pr.noticePeriodDays !== undefined || answered(p, "noticePeriodDays")) { av.score += 40; av.evidence.push(pr.noticePeriodDays ? `Can join in ${pr.noticePeriodDays} days` : "Can join immediately"); } else av.gaps.push("When you can join");
  if (pr.workModes.length) { av.score += 25; av.evidence.push(`Work mode: ${pr.workModes.join(", ")}`); } else av.gaps.push("Remote, hybrid or office");
  if (pr.employmentTypes.length) { av.score += 20; av.evidence.push(`Job type: ${pr.employmentTypes.map((e) => e.replace("_", "-")).join(", ")}`); } else av.gaps.push("Full-time, part-time or contract");
  if (pr.shifts?.length) { av.score += 15; av.evidence.push(pr.shifts.includes("any") ? "Any shift" : `Shifts: ${pr.shifts.join(", ")}`); } else av.gaps.push("Which shifts you can work (day, night, rotational)");
  areas.push(av);

  // Motivation
  const mo: UnderstandingArea = { id: "motivation", label: t.area.motivation, score: pr.motivations?.length ? 100 : 0, evidence: [], gaps: [] };
  if (pr.motivations?.length) mo.evidence.push(pr.motivations.map((m) => (t.c.m as Record<string, string>)[m] || m).join(", "));
  else mo.gaps.push("What you care about most");
  areas.push(mo);

  return areas;
}

export const overallScore = (areas: UnderstandingArea[]) => Math.round(areas.reduce((s, a) => s + (a.score * WEIGHTS[a.id]) / 100, 0));

/** The single most useful next question, or null when there's nothing worth asking. */
export async function nextQuestion(p: CandidateProfile, areas: UnderstandingArea[], lang: Lang = "en"): Promise<UnderstandingQuestion | null> {
  const t = T[lang];
  const pr = p.preferences;
  const ranked = [...areas].filter((a) => a.score < 100).sort((a, b) => WEIGHTS[b.id] * (100 - b.score) - WEIGHTS[a.id] * (100 - a.score));
  for (const a of ranked) {
    const q = await questionFor(a.id);
    if (q) return q;
  }
  return null;

  async function questionFor(id: UnderstandingAreaId): Promise<UnderstandingQuestion | null> {
    switch (id) {
      case "role": {
        const options = [...new Set([...pr.targetRoles, ...p.insights.targetRoleSuggestions, p.currentRole].filter(Boolean))].slice(0, 6);
        return { id: "role", area: "role", text: t.q.role, why: t.q.role_why, choices: options.map((r) => ({ value: r, label: r })), multi: true, allowText: true, placeholder: "e.g. Delivery Manager, Scrum Master" };
      }
      case "skills": {
        const guessed = p.skills.filter((s) => s.source === "ai_derived").slice(0, 8);
        if (guessed.length) return { id: "skills_confirm", area: "skills", text: t.q.skills_confirm, why: t.q.skills_confirm_why, choices: guessed.map((s) => ({ value: s.key, label: s.name })), multi: true, allowText: true };
        const have = new Set(p.skills.map((s) => s.key));
        const gaps = (await gapSkills(p.uid)).filter((k) => !have.has(k));
        if (gaps.length) return { id: "skills_add", area: "skills", text: t.q.skills_add, why: t.q.skills_add_why, choices: [...gaps.map((k) => ({ value: k, label: displayName(k) })), { value: "__none", label: t.c.none }], multi: true, allowText: true };
        if (p.skills.length < 5) return { id: "skills_free", area: "skills", text: t.q.skills_free, why: t.q.skills_add_why, choices: [], multi: false, allowText: true, placeholder: "e.g. Excel, Tally, driving licence, English, customer handling" };
        return null;
      }
      case "experience": {
        const ranges = [["years:0", t.c.fresher], ["years:0.5", t.c.lt1], ["years:2", t.c.y1_3], ["years:4", t.c.y3_5], ["years:7", t.c.y5_10], ["years:12", t.c.y10]].map(([value, label]) => ({ value, label }));
        // When the resume gave us an estimate, ask to confirm it rather than asking as if we knew nothing.
        if (p.totalExperienceYears > 0) {
          const y = experienceText(p.totalExperienceYears);
          return { id: "experience", area: "experience", text: t.q.experience_confirm(y), why: t.q.experience_confirm_why, multi: false, allowText: true, placeholder: "Or type it, e.g. 9 years",
            choices: [{ value: `years:${wholeYears(p.totalExperienceYears) || p.totalExperienceYears}`, label: t.q.yes_about(y) }, ...ranges.filter((r) => r.value !== "years:0")] };
        }
        return { id: "experience", area: "experience", text: t.q.experience, why: t.q.experience_why, multi: false, allowText: false, choices: ranges };
      }
      case "locationPay":
        if (!pr.locations.length && !answered(p, "locations")) {
          const cities = [...new Set([p.city, ...POPULAR_CITIES].filter(Boolean))].slice(0, 7);
          return { id: "locations", area: "locationPay", text: t.q.locations, why: t.q.locations_why, choices: [...cities.map((c) => ({ value: c, label: c })), { value: "__anywhere", label: t.c.anywhere }, { value: "__relocate", label: t.c.relocate }], multi: true, allowText: true };
        }
        return { id: "salary", area: "locationPay", text: t.q.salary, why: t.q.salary_why, choices: salaryChoices(p, t), multi: false, allowText: true, placeholder: "e.g. 12 LPA or ₹25,000 a month" };
      case "availability":
        if (pr.noticePeriodDays === undefined && !answered(p, "noticePeriodDays"))
          return { id: "notice", area: "availability", text: t.q.notice, why: t.q.notice_why, multi: false, allowText: true, choices: [["days:0", t.c.immediate], ["days:15", t.c.d15], ["days:30", t.c.d30], ["days:60", t.c.d60], ["days:90", t.c.d90]].map(([value, label]) => ({ value, label })) };
        if (!pr.workModes.length)
          return { id: "workModes", area: "availability", text: t.q.workModes, why: t.q.workModes_why, multi: true, allowText: false, choices: [["remote", t.c.remote], ["hybrid", t.c.hybrid], ["onsite", t.c.onsite], ["any", t.c.any]].map(([value, label]) => ({ value, label })) };
        if (pr.employmentTypes.length && !pr.shifts?.length)
          return { id: "shifts", area: "availability", text: t.q.shifts, why: t.q.shifts_why, multi: true, allowText: false, choices: [["day", t.c.day], ["night", t.c.night], ["rotational", t.c.rotational], ["flexible", t.c.flexHours], ["any", t.c.anyShift]].map(([value, label]) => ({ value, label })) };
        if (pr.employmentTypes.length) return null;
        return { id: "employment", area: "availability", text: t.q.employment, why: t.q.employment_why, multi: true, allowText: false, choices: [["full_time", t.c.full_time], ["part_time", t.c.part_time], ["contract", t.c.contract], ["internship", t.c.internship]].map(([value, label]) => ({ value, label })) };
      case "motivation":
        return { id: "motivation", area: "motivation", text: t.q.motivation, why: t.q.motivation_why, multi: true, allowText: false, choices: MOTIVATIONS.map((m) => ({ value: m, label: t.c.m[m] })) };
    }
  }
}

export function guessesOf(p: CandidateProfile): Guess[] {
  const out: Guess[] = p.skills.filter((s) => s.source === "ai_derived").slice(0, 10).map((s) => ({ kind: "skill" as const, key: s.key, label: s.name }));
  if (p.preferences.targetRoles.length && p.provenance["preferences.targetRoles"] === "ai_derived") for (const r of p.preferences.targetRoles) out.push({ kind: "role", key: r, label: r });
  return out;
}

const listAnd = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const listOr = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

/** "What I understand about you", in plain sentences built only from facts on the profile. */
export function summarize(p: CandidateProfile): string {
  const pr = p.preferences;
  const parts: string[] = [];
  const who = p.currentRole || (p.insights.careerLevel === "fresher" ? "someone starting their career" : "a job seeker");
  const exp = p.totalExperienceYears ? ` with ${years(p.totalExperienceYears)} of experience` : p.insights.careerLevel === "fresher" ? "" : "";
  const recent = p.experience.find((e) => e.current)?.company || p.experience[0]?.company;
  parts.push(`You're ${/^[aeiou]/i.test(who) ? "an" : "a"} ${who}${exp}${recent ? `, most recently at ${recent}` : ""}.`);
  const want: string[] = [];
  if (pr.targetRoles.length) want.push(`${listOr(pr.targetRoles.slice(0, 3))} roles`);
  if (pr.locations.length) want.push(`in ${listAnd(pr.locations.slice(0, 3))}`);
  const modes = pr.workModes.filter((m) => m !== "unknown");
  if (modes.length && modes.length < 3) want.push(`(${listOr(modes.map((m) => (m === "onsite" ? "on-site" : m)))})`);
  if (want.length) parts.push(`You're looking for ${want.join(" ")}.`);
  const terms: string[] = [];
  if (pr.minSalaryLPA) terms.push(`a salary from ₹${pr.minSalaryLPA} LPA`);
  if (pr.noticePeriodDays !== undefined) terms.push(pr.noticePeriodDays === 0 ? "you can join immediately" : `you can join in ${pr.noticePeriodDays} days`);
  if (terms.length === 2) parts.push(`You want ${terms[0]}, and ${terms[1]}.`);
  else if (terms.length === 1) parts.push(terms[0].startsWith("a salary") ? `You want ${terms[0]}.` : `${terms[0].charAt(0).toUpperCase()}${terms[0].slice(1)}.`);
  const top = p.skills.filter((s) => s.source !== "ai_derived" && s.category !== "soft").slice(0, 5).map((s) => s.name);
  if (top.length) parts.push(`Your strongest skills: ${top.join(", ")}.`);
  if (pr.motivations?.length) parts.push(`What matters most: ${pr.motivations.map((m) => (T.en.c.m as Record<string, string>)[m] || m).join(", ").toLowerCase()}.`);
  return parts.join(" ");
}

export async function understand(p: CandidateProfile, lang: Lang = "en"): Promise<Understanding> {
  const areas = areasFor(p, lang);
  const score = overallScore(areas);
  return { score, ready: score >= THRESHOLD, threshold: THRESHOLD, areas, next: await nextQuestion(p, areas, lang), guesses: guessesOf(p), summary: summarize(p) };
}
