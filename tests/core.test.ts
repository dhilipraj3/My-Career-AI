import { describe, expect, it } from "vitest";
import { detectSeniority, extractSkillKeys, normalizeTitle, roleFamily, familySimilarity, skillSimilarity } from "../server/nlp/skills.js";
import { parseLocation } from "../server/nlp/location.js";
import { totalExperienceYears, parseYearMonth } from "../server/resume/dates.js";
import { deterministicParse } from "../server/resume/parse.js";
import { extractResumeText, ResumeError } from "../server/resume/extract.js";
import { parsePreferenceText } from "../server/profile/preferences.js";
import { RESUME_TEXT } from "./fixtures.js";

describe("skills & titles", () => {
  it("extracts canonical skills incl. aliases and symbols", () => {
    const keys = extractSkillKeys("Worked with Node.js, React, C++, C#, k8s and github actions. Also CI/CD and Scrum Master duties.");
    expect(keys).toEqual(expect.arrayContaining(["nodejs", "react", "cpp", "csharp", "kubernetes", "ci_cd", "scrum"]));
  });
  it("does not match bare 'go' or substrings", () => {
    expect(extractSkillKeys("We go to market and use javascripting daily")).not.toContain("go");
    expect(extractSkillKeys("Experienced in Java")).toContain("java");
    expect(extractSkillKeys("Experienced in JavaScript")).not.toContain("java");
  });
  it("normalises title variants to the same string", () => {
    expect(normalizeTitle("Sr. PM")).toContain("senior");
    expect(normalizeTitle("Project Manager - Senior")).toBe("senior project manager");
    expect(normalizeTitle("Senior Project Manager (Remote)")).toBe("senior project manager");
  });
  it("detects seniority and role family", () => {
    expect(detectSeniority("Senior Project Manager")).toBe("senior");
    expect(detectSeniority("Software Engineering Intern")).toBe("intern");
    expect(roleFamily("Delivery Lead")).toBe("project_management");
    expect(familySimilarity("project_management", "product")).toBe(0.5);
    expect(familySimilarity("project_management", "hr")).toBe(0);
  });
  it("relates skills", () => {
    expect(skillSimilarity("react", "javascript")).toBe(0.5);
    expect(skillSimilarity("react", "django")).toBe(0);
  });
});

describe("locations", () => {
  it("parses Indian cities and aliases", () => {
    expect(parseLocation("Bangalore, Karnataka")).toMatchObject({ city: "Bengaluru", country: "India", india: true });
    expect(parseLocation("Remote - India")).toMatchObject({ remote: true, india: true });
    expect(parseLocation("Austin, Texas, United States").india).toBe(false);
  });
});

describe("experience arithmetic", () => {
  const now = new Date("2024-06-15");
  it("parses date formats", () => {
    expect(parseYearMonth("Jan 2020")).toEqual([2020, 1]);
    expect(parseYearMonth("March 2019")).toEqual([2019, 3]);
    expect(parseYearMonth("06/2018")).toEqual([2018, 6]);
    expect(parseYearMonth("2017")).toEqual([2017, 1]);
  });
  it("merges overlapping jobs and handles present", () => {
    const yrs = totalExperienceYears([
      { startDate: "Jan 2019", endDate: "Present", current: true },
      { startDate: "Jun 2014", endDate: "Dec 2018" },
      { startDate: "Jan 2018", endDate: "Dec 2018" }, // overlaps
    ], now);
    expect(yrs).toBeGreaterThan(9.5);
    expect(yrs).toBeLessThan(10.6);
  });
});

describe("deterministic resume parser (no AI)", () => {
  const p = deterministicParse(RESUME_TEXT);
  it("finds contact details from the resume text only", () => {
    expect(p.fullName).toBe("Priya Sharma");
    expect(p.email).toBe("priya.sharma@example.com");
    expect(p.phone.replace(/\s/g, "")).toContain("9876543210");
    expect(p.city).toBe("Chennai");
    expect(p.links.linkedin).toContain("linkedin.com/in/priyasharma");
  });
  it("parses experience with companies, titles and dates", () => {
    expect(p.experience.length).toBe(2);
    const cur = p.experience.find((e) => e.current)!;
    expect(cur.company).toMatch(/Infosys/);
    expect(cur.designation).toMatch(/Senior Project Manager/);
    expect(cur.startDate).toMatch(/Jan 2019/);
    expect(cur.responsibilities.length + cur.achievements.length).toBeGreaterThanOrEqual(3);
    expect(p.experience.some((e) => /Cognizant/.test(e.company))).toBe(true);
  });
  it("computes experience from dates and extracts skills/education", () => {
    expect(p.totalExperienceYears).toBeGreaterThan(9);
    expect(p.skills.map((s) => s.key)).toEqual(expect.arrayContaining(["project_management", "agile", "scrum", "jira", "sql"]));
    expect(p.education[0].degree).toMatch(/B\.?Tech/i);
    expect(p.education[0].institution).toMatch(/Anna University/);
    expect(p.certifications.length).toBeGreaterThanOrEqual(2);
  });
  it("never invents an employer for a resume without experience", () => {
    const q = deterministicParse("Rahul Verma\nrahul@example.com\n\nSKILLS\nPython, SQL, Excel\n\n".padEnd(200, " "));
    expect(q.experience).toEqual([]);
    expect(q.skills.map((s) => s.key)).toEqual(expect.arrayContaining(["python", "sql", "excel"]));
  });
});

describe("resume file validation", () => {
  it("rejects executables, empty files and unknown types", async () => {
    await expect(extractResumeText(Buffer.from("MZ\x90\x00 fake exe"), "resume.pdf")).rejects.toMatchObject({ code: "suspicious" });
    await expect(extractResumeText(Buffer.alloc(0), "a.pdf")).rejects.toMatchObject({ code: "empty" });
    await expect(extractResumeText(Buffer.from("hello world"), "a.exe")).rejects.toMatchObject({ code: "unsupported_type" });
  });
  it("does not trust the extension over the content", async () => {
    await expect(extractResumeText(Buffer.from("not really a pdf"), "resume.pdf")).rejects.toBeInstanceOf(ResumeError);
  });
  it("rejects too-short text", async () => {
    await expect(extractResumeText(Buffer.from("short"), "r.txt")).rejects.toMatchObject({ code: "no_text" });
  });
  it("reads plain text", async () => {
    const r = await extractResumeText(Buffer.from(RESUME_TEXT), "cv.txt");
    expect(r.format).toBe("txt");
    expect(r.text).toContain("Priya Sharma");
  });
});

describe("preference answers", () => {
  it("parses a combined answer", () => {
    const p = parsePreferenceText("Chennai or remote, hybrid is fine, minimum 15 LPA, 30 days notice");
    expect(p.locations).toEqual(["Chennai"]);
    expect(p.workModes).toEqual(expect.arrayContaining(["remote", "hybrid"]));
    expect(p.minSalaryLPA).toBe(15);
    expect(p.noticePeriodDays).toBe(30);
  });
  it("handles rupees, months and immediate joiners", () => {
    expect(parsePreferenceText("expecting ₹18,00,000 salary").minSalaryLPA).toBe(18);
    expect(parsePreferenceText("2 months notice").noticePeriodDays).toBe(60);
    expect(parsePreferenceText("I can join immediately").noticePeriodDays).toBe(0);
    expect(parsePreferenceText("salary is flexible").minSalaryLPA).toBe(0);
  });
  it("does not mistake a salary for a notice period", () => {
    const p = parsePreferenceText("15 LPA");
    expect(p.minSalaryLPA).toBe(15);
    expect(p.noticePeriodDays).toBeUndefined();
  });
  it("returns nothing for irrelevant text", () => {
    expect(parsePreferenceText("hello there")).toEqual({});
  });
});

import { experienceText, wholeYears } from "../shared/format.js";
describe("experience wording is the same everywhere", () => {
  it("rounds down to whole years and reads naturally", () => {
    expect(experienceText(12.3)).toBe("12 years");
    expect(experienceText(12.9)).toBe("12 years");
    expect(experienceText(1.2)).toBe("1 year");
    expect(experienceText(0.5)).toBe("Less than a year");
    expect(experienceText(0)).toBe("Fresher");
    expect(experienceText(3, { short: true })).toBe("3 yrs");
    expect(wholeYears(7.99)).toBe(7);
  });
});

import { forSpeech, sentences } from "../src/lib/voice.js";
describe("Asha speaks like a person", () => {
  it("reads money, abbreviations and symbols the way people say them", () => {
    expect(forSpeech("Senior PM · ₹20 LPA · 8+ yrs")).toBe("Senior PM, 20 lakh a year, 8+ years");
    expect(forSpeech("Pays ₹18–25 LPA, e.g. at **Acme**")).toBe("Pays 18 to 25 lakh a year, for example at Acme");
    expect(forSpeech("Earn ₹15,000 a month 🎉")).toBe("Earn 15,000 rupees a month");
  });
  it("speaks sentence by sentence, in English and Hindi", () => {
    expect(sentences("Good morning, Priya! You have 3 matches. Want to look?")).toEqual(["Good morning, Priya!", "You have 3 matches.", "Want to look?"]);
    expect(sentences("सुप्रभात! आपके 3 मैच हैं।")).toHaveLength(2);
  });
});
