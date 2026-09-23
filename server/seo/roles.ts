// Landing pages for what people in India actually search: "<role> jobs", "<role> jobs in <city>", "fresher jobs"...
// Each maps to a real search over live jobs; pages with too few jobs are marked noindex (never thin content).
import type { JobQuery } from "../../shared/types.js";

export interface RolePage {
  slug: string; // URL: /<slug>-jobs
  name: string; // "Data Analyst"
  query: Omit<JobQuery, "page" | "pageSize" | "sort">;
  /** Short line for the intro. */
  blurb: string;
}

const role = (slug: string, name: string, q: string, blurb: string, extra: Partial<JobQuery> = {}): RolePage => ({ slug, name, query: { q, ...extra }, blurb });

export const ROLE_PAGES: RolePage[] = [
  // Tech & data
  role("software-engineer", "Software Engineer", "software engineer", "Build and ship software at product companies, startups and global tech centres."),
  role("software-developer", "Software Developer", "software developer", "Design, write and maintain applications across web, mobile and backend."),
  role("java-developer", "Java Developer", "java developer", "Backend and enterprise roles built on Java and Spring."),
  role("python-developer", "Python Developer", "python developer", "Python roles in backend, automation, data and AI."),
  role("frontend-developer", "Frontend Developer", "frontend developer", "Build interfaces with React, Angular and modern web tooling."),
  role("full-stack-developer", "Full Stack Developer", "full stack developer", "Own features end to end, from database to UI."),
  role("react-developer", "React Developer", "react developer", "Frontend roles focused on React and TypeScript."),
  role("android-developer", "Android Developer", "android developer", "Native and cross-platform Android app roles."),
  role("devops-engineer", "DevOps Engineer", "devops engineer", "Cloud, CI/CD, Kubernetes and reliability roles."),
  role("cloud-engineer", "Cloud Engineer", "cloud engineer", "AWS, Azure and GCP infrastructure roles."),
  role("qa-engineer", "QA / Test Engineer", "qa engineer", "Manual and automation testing roles."),
  role("data-analyst", "Data Analyst", "data analyst", "Turn data into decisions with SQL, Excel, Power BI and Python."),
  role("data-scientist", "Data Scientist", "data scientist", "Machine learning, statistics and applied AI roles."),
  role("data-engineer", "Data Engineer", "data engineer", "Build pipelines and platforms with Spark, SQL and the cloud."),
  role("machine-learning-engineer", "Machine Learning Engineer", "machine learning engineer", "Train, deploy and scale ML and GenAI models."),
  role("cyber-security", "Cyber Security", "security engineer", "Security engineering, SOC and GRC roles."),
  role("business-analyst", "Business Analyst", "business analyst", "Bridge business needs and technology teams."),
  role("product-manager", "Product Manager", "product manager", "Own products, roadmaps and outcomes."),
  role("project-manager", "Project Manager", "project manager", "Plan and deliver projects on time and on budget."),
  role("scrum-master", "Scrum Master", "scrum master", "Agile delivery and team coaching roles."),
  role("ui-ux-designer", "UI/UX Designer", "ui ux designer", "Design products people love to use."),
  role("graphic-designer", "Graphic Designer", "graphic designer", "Visual, brand and marketing design roles."),
  role("technical-support", "Technical Support", "technical support", "Help customers solve technical problems."),
  // Business & corporate
  role("sales-executive", "Sales Executive", "sales executive", "Field and inside sales roles across industries."),
  role("business-development", "Business Development", "business development", "Find and grow new business and partnerships."),
  role("marketing", "Marketing", "marketing", "Brand, growth and performance marketing roles."),
  role("digital-marketing", "Digital Marketing", "digital marketing", "SEO, social media, ads and content roles."),
  role("content-writer", "Content Writer", "content writer", "Writing and editing roles for web, product and marketing."),
  role("customer-support", "Customer Support", "customer support", "Voice, chat and email support roles, including BPO."),
  role("customer-success", "Customer Success", "customer success", "Keep customers happy and growing."),
  role("hr", "HR", "hr", "Recruitment, HR operations and people roles."),
  role("recruiter", "Recruiter", "recruiter", "Talent acquisition and hiring roles."),
  role("accountant", "Accountant", "accountant", "Accounting, GST, taxation and bookkeeping roles."),
  role("finance", "Finance", "finance analyst", "FP&A, finance operations and analysis roles."),
  role("operations", "Operations", "operations", "Keep the business running: operations and process roles."),
  role("data-entry", "Data Entry", "data entry", "Data entry and back-office roles."),
  role("office-assistant", "Office Assistant", "office assistant", "Front office, admin and receptionist roles."),
  // Frontline & skilled
  role("delivery", "Delivery", "delivery executive", "Delivery partner and delivery executive roles — pay usually shown per month."),
  role("driver", "Driver", "driver", "Driving jobs: cab, truck, delivery and personal drivers."),
  role("telecaller", "Telecaller", "telecaller", "Telecalling and tele-sales roles."),
  role("retail", "Retail", "retail store", "Store staff, cashier and retail sales roles."),
  role("warehouse", "Warehouse", "warehouse", "Warehouse, picking, packing and logistics roles."),
  role("electrician", "Electrician", "electrician", "Electrician and technician roles, ITI welcome."),
  role("mechanical-engineer", "Mechanical Engineer", "mechanical engineer", "Design, production and maintenance roles."),
  role("civil-engineer", "Civil Engineer", "civil engineer", "Site, design and construction roles."),
  role("nurse", "Nurse", "nurse", "Nursing roles in hospitals and clinics."),
  role("pharmacist", "Pharmacist", "pharmacist", "Pharmacy roles in retail and hospitals."),
  role("teacher", "Teacher", "teacher", "Teaching and tutoring roles."),
  role("chef", "Chef & Kitchen", "chef", "Chef, cook and kitchen roles."),
  role("security-guard", "Security Guard", "security guard", "Security and facility roles."),
];

/** Collections that are filters rather than role searches. */
export const SPECIAL_PAGES: RolePage[] = [
  { slug: "fresher", name: "Fresher", query: { freshersOnly: true }, blurb: "Entry-level jobs where employers welcome freshers — no experience needed." },
  { slug: "remote", name: "Remote", query: { workModes: ["remote"] }, blurb: "Work-from-home jobs you can do from anywhere in India." },
  { slug: "work-from-home", name: "Work From Home", query: { workModes: ["remote"] }, blurb: "Work-from-home jobs you can do from anywhere in India." },
  { slug: "part-time", name: "Part Time", query: { employmentTypes: ["part_time"] }, blurb: "Part-time jobs that fit around studies or other work." },
  { slug: "internship", name: "Internship", query: { employmentTypes: ["internship"] }, blurb: "Internships to start your career." },
  { slug: "contract", name: "Contract", query: { employmentTypes: ["contract"] }, blurb: "Contract and freelance roles." },
];

/** "remote" and "work-from-home" show the same jobs; the second one points search engines at the first. */
export const CANONICAL_SPECIAL: Record<string, string> = { "work-from-home": "remote" };

const ALL = new Map([...ROLE_PAGES, ...SPECIAL_PAGES].map((r) => [r.slug, r]));
export const rolePage = (slug: string) => ALL.get(slug);
export const slugify = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
