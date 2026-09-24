import { z } from "zod";
import type { CandidatePreferences, EmploymentType, WorkMode } from "../../shared/types.js";

export const PreferencePatch = z
  .object({
    targetRoles: z.array(z.string().trim().min(2).max(80)).max(10),
    industries: z.array(z.string().trim().min(2).max(60)).max(10),
    workModes: z.array(z.enum(["remote", "hybrid", "onsite"])).max(3),
    locations: z.array(z.string().trim().min(2).max(60)).max(15),
    minSalaryLPA: z.number().min(0).max(1000),
    employmentTypes: z.array(z.enum(["full_time", "part_time", "contract", "internship"])).max(4),
    noticePeriodDays: z.number().int().min(0).max(365),
    willingToRelocate: z.boolean(),
    excludedCompanies: z.array(z.string().trim().min(1).max(80)).max(50),
    excludedKeywords: z.array(z.string().trim().min(1).max(60)).max(50),
    motivations: z.array(z.string().trim().min(2).max(40)).max(6),
  })
  .partial()
  .strict();

export type PreferencePatchT = z.infer<typeof PreferencePatch>;

export const emptyPreferences = (): CandidatePreferences => ({
  targetRoles: [], industries: [], workModes: [], locations: [], employmentTypes: [], excludedCompanies: [], excludedKeywords: [],
});

import { findIndianCities } from "../nlp/location.js";

/**
 * Deterministic parser for free-text answers to the profile-completion questions.
 * Handles: "Chennai or remote, 15 LPA, 30 days notice", "flexible", "immediate joiner", "no salary constraint".
 */
export function parsePreferenceText(text: string): PreferencePatchT {
  const t = text.toLowerCase();
  const patch: PreferencePatchT = {};

  const cities = findIndianCities(t);
  if (cities.length) patch.locations = [...new Set(cities)];
  if (/\b(anywhere|any location|pan india|no location preference|location (is )?flexible)\b/.test(t)) patch.locations = ["Anywhere in India"];

  const modes: WorkMode[] = [];
  if (/\bremote|work from home|wfh\b/.test(t)) modes.push("remote");
  if (/\bhybrid\b/.test(t)) modes.push("hybrid");
  if (/\b(on-?site|office|in-?office|work from office|wfo)\b/.test(t)) modes.push("onsite");
  if (modes.length) patch.workModes = [...new Set(modes)] as any;
  else if (/\b(any|all|flexible|no preference)\b.*\b(mode|work)\b|\bwork mode.*(any|flexible)/.test(t)) patch.workModes = ["remote", "hybrid", "onsite"];

  // Salary: 15 LPA / 15 lakhs / 15L / ₹15,00,000 / 1500000
  const lpa = t.match(/(\d+(?:\.\d+)?)\s*(?:-\s*\d+(?:\.\d+)?\s*)?(?:lpa|lakhs?|lacs?|l\b)/);
  const rupees = t.match(/(?:₹|rs\.?|inr)\s*([\d,]{6,})/);
  const bare = t.match(/\b(\d{6,8})\b/);
  if (lpa) patch.minSalaryLPA = Number(lpa[1]);
  else if (rupees) patch.minSalaryLPA = Math.round((Number(rupees[1].replace(/,/g, "")) / 100000) * 10) / 10;
  else if (bare && /salary|ctc|package|expect/.test(t)) patch.minSalaryLPA = Math.round((Number(bare[1]) / 100000) * 10) / 10;
  else if (/no (salary )?(constraint|minimum|expectation)|salary (is )?(flexible|negotiable)|open on salary/.test(t)) patch.minSalaryLPA = 0;

  // Notice period
  if (/\b(immediate(ly)?|serving notice|already serving|no notice|available now|ready to join)\b/.test(t)) patch.noticePeriodDays = 0;
  else {
    const days = t.match(/(\d{1,3})\s*days?/);
    const months = t.match(/(\d{1,2})\s*months?/);
    const weeks = t.match(/(\d{1,2})\s*weeks?/);
    if (/notice|joining|join/.test(t) || days || months || weeks) {
      if (days) patch.noticePeriodDays = Number(days[1]);
      else if (months) patch.noticePeriodDays = Number(months[1]) * 30;
      else if (weeks) patch.noticePeriodDays = Number(weeks[1]) * 7;
    }
  }
  // Salary numbers must not be mistaken for notice days.
  if (patch.noticePeriodDays !== undefined && lpa && !/notice|join|days|month|week/.test(t.replace(lpa[0], ""))) delete patch.noticePeriodDays;

  if (/\b(willing to relocate|open to relocat|can relocate|ready to relocate|happy to relocate)\b/.test(t)) patch.willingToRelocate = true;
  if (/\b(not willing to relocate|no relocation|won'?t relocate|cannot relocate|don'?t want to relocate)\b/.test(t)) patch.willingToRelocate = false;

  const emp: EmploymentType[] = [];
  if (/\bfull[- ]?time|permanent\b/.test(t)) emp.push("full_time");
  if (/\bcontract|freelance\b/.test(t)) emp.push("contract");
  if (/\bpart[- ]?time\b/.test(t)) emp.push("part_time");
  if (/\bintern(ship)?\b/.test(t)) emp.push("internship");
  if (emp.length) patch.employmentTypes = emp as any;

  return patch;
}
