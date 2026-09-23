import { describe, expect, it } from "vitest";
import { classifyCategory, freshersWelcome, minimumEducation } from "../server/jobs/classify.js";
import { assessQuality, cleanTitle, isRejected, normalizeRaw, parseSalary, type RawJob } from "../server/jobs/normalize.js";
import { computeMatch } from "../server/matching/engine.js";
import { firstName } from "../server/agent/agent.js";
import { findIndianCities, parseLocation } from "../server/nlp/location.js";
import { familySimilarity, roleFamily } from "../server/nlp/skills.js";
import { parsePreferenceText } from "../server/profile/preferences.js";

const raw = (over: Partial<RawJob> = {}): RawJob => ({
  connector: "test", sourceName: "Test", sourceJobId: "1", title: "Job", company: "Acme", location: "Pune",
  description: "A reasonably detailed description of the work involved in this role, the team and expectations.", url: "https://acme.in/j/1", ...over,
});
const sal = (text: string, over: Partial<RawJob> = {}) => parseSalary(raw(over), text);

describe("Indian locations", () => {
  it("canonicalises old names and tier-2/3 cities", () => {
    expect(findIndianCities("Bombay, Madras and Poona")).toEqual(["Mumbai", "Chennai", "Pune"]);
    expect(parseLocation("Trichy, Tamil Nadu")).toMatchObject({ city: "Tiruchirappalli", state: "Tamil Nadu", india: true });
    expect(parseLocation("Hubli").city).toBe("Hubballi");
  });
  it("does not double-count a city inside a longer name", () => {
    expect(findIndianCities("Navi Mumbai")).toEqual(["Navi Mumbai"]);
    expect(findIndianCities("Greater Noida West")).toEqual(["Greater Noida"]);
  });
  it("keeps every city of a multi-city posting", () => {
    expect(parseLocation("Bengaluru; Hyderabad; Pune").cities).toEqual(["Bengaluru", "Hyderabad", "Pune"]);
  });
  it("understands Pan India / multiple locations without inventing a city", () => {
    expect(parseLocation("Pan India")).toMatchObject({ panIndia: true, india: true, city: "" });
    expect(parseLocation("Multiple Locations").panIndia).toBe(true);
  });
  it("state-only and country-code locations count as India", () => {
    expect(parseLocation("Karnataka")).toMatchObject({ india: true, state: "Karnataka", city: "" });
    expect(parseLocation("Pune, Maharashtra, IN").india).toBe(true);
    expect(parseLocation("Berlin").india).toBe(false);
  });
  it("preference answers pick up the same cities", () => {
    expect(parsePreferenceText("Navi Mumbai or Thane, 25k per month").locations).toEqual(["Navi Mumbai", "Thane"]);
  });
});

describe("title clean-up (live-data regression)", () => {
  it.each([
    ["IN_Bosch Rexroth India_Executive / Assistant Manager_Project Purchasing", "Bosch Rexroth India - Executive / Assistant Manager - Project Purchasing"],
    ["IN_RBIN_ Senior Engineer Quality Management Process", "Senior Engineer Quality Management Process"],
    ["IN_RBIC_Inbound Logistics ABS ESP LOM_IN", "Inbound Logistics ABS ESP LOM"],
    ["Staff Software Engineer_Fusion Adapters", "Staff Software Engineer - Fusion Adapters"],
    ["Senior Data Analyst", "Senior Data Analyst"],
    ["QA / SDET - Payments", "QA / SDET - Payments"],
  ])("%s", (raw, clean) => expect(cleanTitle(raw)).toBe(clean));
});

describe("salary parsing", () => {
  it("LPA ranges", () => {
    expect(sal("CTC 12-18 LPA")).toMatchObject({ minLpa: 12, maxLpa: 18, period: "year", display: "₹12–18 LPA" });
  });
  it("monthly pay, with k shorthand and Indian digit grouping", () => {
    expect(sal("Salary ₹15,000 - ₹20,000 per month")).toMatchObject({ minLpa: 1.8, maxLpa: 2.4, period: "month", display: "₹15,000–20,000/month" });
    expect(sal("Pay: 18k-22k/month plus incentives")).toMatchObject({ minLpa: 2.2, maxLpa: 2.6, period: "month" });
    expect(sal("Rs. 1,20,000 per month")).toMatchObject({ minLpa: 14.4, period: "month" });
  });
  it("daily wages", () => {
    expect(sal("₹650 per day, weekly off")).toMatchObject({ minLpa: 2, period: "day", display: "₹650/day" });
  });
  it("labelled period-less amounts are inferred by size", () => {
    expect(sal("Salary: 15,000 - 20,000 + PF")).toMatchObject({ period: "month", minLpa: 1.8 });
    expect(sal("Stipend ₹10,000")).toMatchObject({ period: "month", minLpa: 1.2 });
  });
  it("in-hand pay is labelled", () => {
    expect(sal("In-hand salary ₹22,000 per month").display).toBe("₹22,000/month (in-hand)");
  });
  it("working hours are not mistaken for salary", () => {
    expect(sal("Timings 9 - 6 pm, Monday to Saturday").minLpa).toBeUndefined();
  });
  it("structured salaries use the stated period, or infer it by size", () => {
    expect(sal("", { salary: { min: 18000, max: 24000, currency: "INR", period: "month" } })).toMatchObject({ minLpa: 2.2, period: "month" });
    expect(sal("", { salary: { min: 25000, max: 30000, currency: "INR" } })).toMatchObject({ period: "month", minLpa: 3, maxLpa: 3.6 });
    expect(sal("", { salary: { min: 600000, max: 900000, currency: "INR" } })).toMatchObject({ minLpa: 6, maxLpa: 9, display: "₹6–9 LPA" });
    expect(sal("", { salary: { min: 90000, max: 120000, currency: "USD" } })).toEqual({ currency: "USD" });
  });
});

describe("job classification", () => {
  it.each([
    ["Delivery Executive - Two Wheeler", "logistics_delivery"], ["Commercial Driver (HMV)", "driver"], ["Electrician", "skilled_trades"],
    ["Staff Nurse (GNM)", "healthcare"], ["Primary School Teacher", "education"], ["Commis Chef", "hospitality_food"],
    ["Security Guard", "security_facility"], ["Telecaller - Hindi", "customer_support"], ["Data Entry Operator", "office_admin"],
    ["Senior Software Engineer", "tech"], ["Data Scientist", "data_ai"], ["Accountant", "finance_accounts"], ["Field Sales Executive", "sales"],
    ["CNC Machine Operator", "skilled_trades"], ["Site Engineer - Civil", "construction_realestate"], ["Talent Acquisition Specialist", "hr"],
  ])("%s → %s", (title, cat) => expect(classifyCategory(title)).toBe(cat));

  it("Delivery Manager is project work, Delivery Partner is logistics (screenshot regression)", () => {
    expect(classifyCategory("Delivery Manager", "Lead software delivery for enterprise customers")).toBe("operations");
    expect(roleFamily("Delivery Partner - Two Wheeler")).toBe("logistics");
    expect(roleFamily("Delivery Manager")).toBe("project_management");
    expect(roleFamily("Solution Provider Manager")).not.toBe("logistics");
    expect(familySimilarity(roleFamily("Senior Project Manager"), roleFamily("Delivery Partner"))).toBe(0);
  });

  it("falls back to the description when the title is vague", () => {
    expect(classifyCategory("Associate", "You will deliver parcels on a two-wheeler as a delivery partner.")).toBe("logistics_delivery");
    expect(classifyCategory("Associate", "")).toBe("other");
  });

  it("minimum education is the lowest level asked for", () => {
    expect(minimumEducation("Qualification: 10th pass or 12th pass")).toBe("10th");
    expect(minimumEducation("ITI in Electrical trade required")).toBe("iti");
    expect(minimumEducation("B.Tech / BE in Computer Science; MBA preferred")).toBe("graduate");
    expect(minimumEducation("Must have strong communication skills")).toBeUndefined();
  });

  it("freshers welcome only when the posting says so and the role isn't senior", () => {
    expect(freshersWelcome("Customer Support Associate", "Freshers can apply", undefined)).toBe(true);
    expect(freshersWelcome("Graduate Engineer Trainee", "", undefined)).toBe(true);
    expect(freshersWelcome("Senior Manager", "freshers", undefined)).toBe(false);
    expect(freshersWelcome("Analyst", "3+ years", 3)).toBe(false);
  });
});

describe("normalized jobs carry the enrichment", () => {
  it("frontline posting end to end", () => {
    const n = normalizeRaw(raw({
      title: "Delivery Partner", location: "Pan India",
      description: "Join as a delivery partner. Earn ₹18,000 - ₹25,000 per month plus incentives. 10th pass is enough. Freshers welcome. Own bike and licence needed.",
    }));
    expect(isRejected(n)).toBe(false);
    const j = (n as any).job;
    expect(j).toMatchObject({ category: "logistics_delivery", education: "10th", freshersWelcome: true, panIndia: true, salaryPeriod: "month", salaryDisplay: "₹18,000–25,000/month", salaryMinLPA: 2.2 });
    expect(j.city).toBe("");
  });

  it("multi-city tech posting", () => {
    const j = (normalizeRaw(raw({ title: "Backend Engineer", location: "Bengaluru; Hyderabad" })) as any).job;
    expect(j.cities).toEqual(["Bengaluru", "Hyderabad"]);
    expect(j.category).toBe("tech");
  });
});

describe("screenshot regressions", () => {
  it("greets people by their name, not their initial", () => {
    expect(firstName("K. Priya")).toBe("Priya");
    expect(firstName("Priya Sharma")).toBe("Priya");
    expect(firstName("A K")).toBe("A");
    expect(firstName("")).toBe("");
  });

  it("soft skills are never reported as missing", () => {
    const job = (normalizeRaw(raw({ title: "Project Manager", description: "Project management, Agile, Scrum, JIRA. Strong teamwork, communication and leadership required. ".repeat(3) })) as any).job;
    const profile: any = {
      skills: [{ key: "project_management", name: "Project Management", source: "resume" }], preferences: { targetRoles: [], workModes: [], locations: [], employmentTypes: [], excludedCompanies: [], excludedKeywords: [], industries: [] },
      totalExperienceYears: 5, currentRole: "Project Manager", summary: "", experience: [], projects: [], insights: { careerLevel: "mid" }, city: "",
    };
    const m = computeMatch({ profile, job });
    expect(m.missingSkills).not.toEqual(expect.arrayContaining(["Teamwork"]));
    expect(m.missingSkills.some((s) => /teamwork|communication|leadership/i.test(s))).toBe(false);
    expect(m.missingSkills).toEqual(expect.arrayContaining(["Agile"]));
  });
});

describe("scam signals", () => {
  const q = (description: string, extra: any = {}) => assessQuality({
    title: "Data Entry", company: "X", description, currency: "INR", employmentType: "full_time",
    sources: [{ connector: "t", sourceName: "t", sourceJobId: "1", sourceUrl: "https://x", applyUrl: "https://x", seenAt: "" }], ...extra,
  });
  it.each([
    "Pay a refundable deposit of ₹2,000 before joining.",
    "Kit charges of ₹1,500 will be collected.",
    "Earn ₹25,000 per week from home. Daily payment.",
    "Part time work, earn ₹500 per hour typing.",
  ])("flags: %s", (d) => expect(q(d.padEnd(220, ".")).flags).toContain("spam_language"));

  it.each([
    "Reach out to creators through email, WhatsApp, Instagram DM and calls to onboard them.",
    "Model monthly interest accruals, processing fee (PF) yields and default guarantees for lending products.",
    "By submitting your application, you consent to being contacted via phone call, email, SMS, WhatsApp, or other channels.",
    "Manage the security deposit ledger for leased office premises across regions.",
  ])("does not flag normal job content (live-data regression): %s", (d) => expect(q(d.padEnd(220, ".")).flags).not.toContain("spam_language"));

  it.each([
    "Send your resume on WhatsApp to apply today.",
    "Interested candidates WhatsApp 98765 43210 immediately.",
    "Registration fee ₹499 payable before interview.",
  ])("flags recruitment through chat apps or candidate fees: %s", (d) => expect(q(d.padEnd(220, ".")).flags).toContain("spam_language"));

  it("does not flag an employer's anti-fraud notice", () => {
    expect(q("We never ask candidates to pay a registration fee or security deposit. Beware of fraud.".padEnd(220, ".")).flags).not.toContain("spam_language");
  });

  it("frontline role advertised far above market is suspicious", () => {
    expect(q("x".repeat(220), { category: "office_admin", salaryMaxLPA: 24 }).flags).toContain("unrealistic_salary");
    expect(q("x".repeat(220), { category: "tech", salaryMaxLPA: 24 }).flags).not.toContain("unrealistic_salary");
  });
});
