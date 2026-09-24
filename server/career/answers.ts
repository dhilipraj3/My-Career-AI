// Apply an answer to one understanding question: chips and/or free text. Facts the user states are recorded as
// source "user"; nothing is guessed here.
import type { CandidateProfile, EmploymentType, WorkMode } from "../../shared/types.js";
import { AppError } from "../applications/service.js";
import { audit } from "../audit.js";
import { findIndianCities } from "../nlp/location.js";
import { extractSkillKeys, normalizeSkillKey } from "../nlp/skills.js";
import { parsePreferenceText, type PreferencePatchT } from "../profile/preferences.js";
import { editProfile, getProfile, saveProfile, updatePreferences } from "../profile/service.js";
import { deriveInsights } from "../resume/parse.js";
import { MOTIVATIONS } from "./understanding.js";

export interface AnswerResult {
  profile: CandidateProfile;
  /** Plain-language list of what changed, for the "Got it" confirmation. */
  changed: string[];
}

const splitList = (text: string) => text.split(/,|;|\n|\/|\band\b|\bor\b|और|या/i).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 80);

export async function applyAnswer(uid: string, questionId: string, choicesIn: string[] = [], textIn = ""): Promise<AnswerResult> {
  const p = await getProfile(uid);
  if (!p) throw new AppError(404, "Profile not found");
  const choices = choicesIn.map((c) => c.trim()).filter(Boolean).slice(0, 20);
  const text = textIn.trim().slice(0, 500);
  const changed: string[] = [];
  const prefs: PreferencePatchT = {};

  switch (questionId) {
    case "role": {
      const roles = [...new Set([...choices, ...splitList(text)])].slice(0, 6);
      if (!roles.length) throw new AppError(400, "Pick or type at least one role.");
      prefs.targetRoles = roles;
      changed.push(`Target roles: ${roles.join(", ")}`);
      break;
    }
    case "skills_confirm": {
      const shown = p.skills.filter((s) => s.source === "ai_derived").slice(0, 8).map((s) => s.key);
      const keep = new Set(choices);
      const confirm = shown.filter((k) => keep.has(k));
      const reject = shown.filter((k) => !keep.has(k));
      const added = text ? [...new Set([...extractSkillKeys(text), ...splitList(text).map(normalizeSkillKey)])] : [];
      await editProfile(uid, { addSkills: [...confirm, ...added], removeSkills: reject });
      if (confirm.length) changed.push(`Confirmed: ${confirm.length} skill${confirm.length === 1 ? "" : "s"}`);
      if (reject.length) changed.push(`Removed ${reject.length} guess${reject.length === 1 ? "" : "es"}`);
      if (added.length) changed.push(`Added: ${added.length} skill${added.length === 1 ? "" : "s"}`);
      break;
    }
    case "skills_add":
    case "skills_free": {
      const picked = choices.filter((c) => c !== "__none");
      const typed = text ? [...new Set([...extractSkillKeys(text), ...splitList(text)])] : [];
      const all = [...picked, ...typed];
      if (!all.length && !choices.includes("__none")) throw new AppError(400, "Pick or type at least one skill.");
      if (all.length) await editProfile(uid, { addSkills: all });
      changed.push(all.length ? `Added ${all.length} skill${all.length === 1 ? "" : "s"}` : "Noted — none of those");
      if (!all.length) await audit(uid, "understanding.skills_declined", { count: choices.length });
      break;
    }
    case "experience": {
      const m = /^years:(\d+(?:\.\d+)?)$/.exec(choices[0] || "");
      const typed = /(\d+(?:\.\d+)?)\s*(?:years?|yrs?|साल)/i.exec(text);
      const years = m ? Number(m[1]) : typed ? Number(typed[1]) : /fresher|no experience|फ्रेशर/i.test(text) ? 0 : NaN;
      if (!Number.isFinite(years)) throw new AppError(400, "Pick how much experience you have.");
      const fresh = (await getProfile(uid))!;
      const insights = { ...fresh.insights, careerLevel: deriveInsights(fresh.currentRole, years, fresh.experience).careerLevel };
      await saveProfile({ ...fresh, totalExperienceYears: years, insights, provenance: { ...fresh.provenance, totalExperienceYears: "user" } });
      changed.push(years ? `Experience: ${years} years` : "Experience: fresher");
      break;
    }
    case "locations": {
      const cities = choices.filter((c) => !c.startsWith("__"));
      const fromText = text ? findIndianCities(text) : [];
      if (choices.includes("__anywhere") || /anywhere|kahin bhi|कहीं भी/i.test(text)) prefs.locations = ["Anywhere in India"];
      else if (cities.length || fromText.length) prefs.locations = [...new Set([...cities, ...fromText])];
      if (choices.includes("__relocate") || /relocat/i.test(text)) prefs.willingToRelocate = true;
      if (!prefs.locations && prefs.willingToRelocate === undefined) throw new AppError(400, "Pick at least one city.");
      if (prefs.locations) changed.push(`Cities: ${prefs.locations.join(", ")}`);
      if (prefs.willingToRelocate) changed.push("Open to relocating");
      break;
    }
    case "salary": {
      const m = /^lpa:(\d+(?:\.\d+)?)$/.exec(choices[0] || "");
      let lpa = m ? Number(m[1]) : undefined;
      if (lpa === undefined && text) {
        const perMonth = /(?:₹|rs\.?)?\s*(\d[\d,]*)\s*(k)?\s*(?:\/|per|a)\s*(?:month|mo|महीना)/i.exec(text);
        if (perMonth) lpa = Math.round(((Number(perMonth[1].replace(/,/g, "")) * (perMonth[2] ? 1000 : 1) * 12) / 100000) * 10) / 10;
        else lpa = parsePreferenceText(text).minSalaryLPA;
      }
      if (lpa === undefined) throw new AppError(400, "Pick an amount, or type something like \"12 LPA\" or \"₹25,000 a month\".");
      prefs.minSalaryLPA = lpa;
      changed.push(lpa ? `Minimum pay: ₹${lpa} LPA` : "Pay: flexible");
      break;
    }
    case "notice": {
      const m = /^days:(\d+)$/.exec(choices[0] || "");
      const days = m ? Number(m[1]) : parsePreferenceText(text).noticePeriodDays;
      if (days === undefined) throw new AppError(400, "Pick when you can join.");
      prefs.noticePeriodDays = days;
      changed.push(days ? `Can join in ${days} days` : "Can join immediately");
      break;
    }
    case "workModes": {
      const modes = (choices.includes("any") ? ["remote", "hybrid", "onsite"] : choices.filter((c) => ["remote", "hybrid", "onsite"].includes(c))) as WorkMode[];
      if (!modes.length) throw new AppError(400, "Pick at least one.");
      prefs.workModes = modes as PreferencePatchT["workModes"];
      changed.push(`Work mode: ${modes.join(", ")}`);
      break;
    }
    case "employment": {
      const types = choices.filter((c) => ["full_time", "part_time", "contract", "internship"].includes(c)) as EmploymentType[];
      if (!types.length) throw new AppError(400, "Pick at least one.");
      prefs.employmentTypes = types as PreferencePatchT["employmentTypes"];
      changed.push(`Job type: ${types.map((t) => t.replace("_", "-")).join(", ")}`);
      break;
    }
    case "motivation": {
      const picked = choices.filter((c) => (MOTIVATIONS as readonly string[]).includes(c)).slice(0, 4);
      if (!picked.length) throw new AppError(400, "Pick what matters most to you.");
      prefs.motivations = picked;
      changed.push("Noted what matters most to you");
      break;
    }
    default:
      throw new AppError(400, "Unknown question.");
  }

  if (Object.keys(prefs).length) await updatePreferences(uid, prefs, "user");
  await audit(uid, "understanding.answered", { question: questionId });
  return { profile: (await getProfile(uid))!, changed };
}

/** Confirm or reject one AI guess (a skill or a target role). */
export async function resolveGuess(uid: string, kind: "skill" | "role", key: string, confirm: boolean): Promise<CandidateProfile> {
  const p = await getProfile(uid);
  if (!p) throw new AppError(404, "Profile not found");
  if (kind === "skill") {
    if (!p.skills.some((s) => s.key === key)) throw new AppError(404, "That skill isn't on your profile.");
    await editProfile(uid, confirm ? { addSkills: [key] } : { removeSkills: [key] });
  } else {
    const roles = confirm ? p.preferences.targetRoles : p.preferences.targetRoles.filter((r) => r !== key);
    // Confirming any guessed role makes the list the user's own choice.
    await updatePreferences(uid, { targetRoles: roles }, "user");
  }
  await audit(uid, "understanding.guess_resolved", { kind, confirm });
  return (await getProfile(uid))!;
}
