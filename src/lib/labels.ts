import type { EducationLevel, Job, JobCategory } from "@shared/types";

export const CATEGORY_LABELS: Record<JobCategory, string> = {
  tech: "Software & IT", data_ai: "Data & AI", design: "Design", product: "Product", sales: "Sales & BD", marketing: "Marketing",
  customer_support: "Customer support & BPO", finance_accounts: "Finance & accounts", hr: "HR & recruiting", legal: "Legal & compliance",
  operations: "Operations & projects", office_admin: "Office & admin", logistics_delivery: "Delivery & logistics", driver: "Driver",
  retail: "Retail & stores", hospitality_food: "Hotels & food", healthcare: "Healthcare", education: "Teaching & training",
  skilled_trades: "Skilled trades", manufacturing: "Manufacturing & plant", construction_realestate: "Construction & real estate",
  security_facility: "Security & facilities", media_content: "Media & content", other: "Other",
};

export const EDUCATION_LABELS: Record<EducationLevel, string> = {
  none: "No minimum", "10th": "10th pass", "12th": "12th pass", iti: "ITI", diploma: "Diploma", graduate: "Graduate", postgraduate: "Postgraduate",
};

export const POPULAR_CITIES = ["Bengaluru", "Hyderabad", "Chennai", "Mumbai", "Pune", "Delhi", "Gurugram", "Noida", "Kolkata", "Ahmedabad", "Jaipur", "Kochi", "Coimbatore", "Indore", "Lucknow", "Chandigarh"];

const AGGREGATORS: Record<string, string> = { adzuna: "Adzuna", careerjet: "Careerjet", jooble: "Jooble", remotive: "Remotive", arbeitnow: "Arbeitnow" };

/** Where a job came from, in plain words. The employer's own site is the most trustworthy source, so it wins. */
export function sourceLabel(j: Job): string {
  if (j.userProvided) return "Added by you";
  const direct = j.sources.find((s) => !AGGREGATORS[s.connector] && !s.connector.startsWith("user_"));
  if (direct) return "Company careers site";
  const agg = j.sources.map((s) => AGGREGATORS[s.connector]).filter(Boolean);
  return agg.length ? `via ${[...new Set(agg)].join(", ")}` : j.sources[0]?.sourceName || "";
}

/** "K. Priya" → "Priya": skip initials so greetings read naturally. */
export function firstName(fullName: string): string {
  const parts = fullName.split(/\s+/).filter(Boolean);
  return parts.find((p) => p.replace(/\./g, "").length > 2) || parts[0] || "";
}

export const salaryText =(j: Job) => j.salaryDisplay || (j.salaryMinLPA || j.salaryMaxLPA ? `₹${j.salaryMinLPA ?? "?"}–${j.salaryMaxLPA ?? "?"} LPA` : null);

export const locationText = (j: Job) =>
  j.workMode === "remote" ? "Remote" : j.panIndia ? "Pan India" : j.cities && j.cities.length > 1 ? `${j.cities[0]} +${j.cities.length - 1}` : j.city || j.location || "Location not stated";
