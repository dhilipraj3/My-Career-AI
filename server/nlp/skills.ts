import type { SkillEntry } from "../../shared/types.js";

type Cat = SkillEntry["category"];
// [display name, category, aliases, related skill keys]
type Def = [string, Cat, string[], string[]?];

const DEFS: Def[] = [
  // Languages
  ["JavaScript", "technical", ["js", "ecmascript", "es6"], ["typescript", "nodejs", "react"]],
  ["TypeScript", "technical", ["ts"], ["javascript"]],
  ["Python", "technical", ["python3"], ["django", "flask", "fastapi", "pandas"]],
  ["Java", "technical", ["core java", "j2ee", "jdk"], ["spring", "kotlin"]],
  ["C++", "technical", ["cpp"], []],
  ["C#", "technical", ["c sharp", "csharp"], ["dotnet"]],
  ["Go", "technical", ["golang", "go lang"], []],
  ["Rust", "technical", [], []],
  ["Kotlin", "technical", [], ["java", "android"]],
  ["Swift", "technical", [], ["ios"]],
  ["PHP", "technical", [], ["laravel"]],
  ["Ruby", "technical", ["ruby on rails", "rails"], []],
  ["Scala", "technical", [], ["spark"]],
  ["SQL", "technical", ["t-sql", "pl/sql", "plsql"], ["postgresql", "mysql"]],
  ["R", "technical", ["r programming", "rstudio"], ["statistics"]],
  // Web / frameworks
  ["React", "technical", ["reactjs", "react.js"], ["javascript", "redux", "nextjs"]],
  ["Next.js", "technical", ["nextjs"], ["react"]],
  ["Angular", "technical", ["angularjs", "angular.js"], ["typescript"]],
  ["Vue.js", "technical", ["vue", "vuejs"], ["javascript"]],
  ["Redux", "technical", [], ["react"]],
  ["Node.js", "technical", ["node", "nodejs", "node js"], ["express", "javascript"]],
  ["Express", "technical", ["expressjs", "express.js"], ["nodejs"]],
  ["Spring Boot", "technical", ["springboot", "spring framework", "spring"], ["java"]],
  ["Django", "technical", [], ["python"]],
  ["Flask", "technical", [], ["python"]],
  ["FastAPI", "technical", [], ["python"]],
  [".NET", "technical", ["dotnet", ".net core", "asp.net", "asp.net core"], ["csharp"]],
  ["Laravel", "technical", [], ["php"]],
  ["HTML", "technical", ["html5"], ["css"]],
  ["CSS", "technical", ["css3", "sass", "scss"], ["html"]],
  ["Tailwind CSS", "technical", ["tailwind", "tailwindcss"], ["css"]],
  ["GraphQL", "technical", [], ["rest"]],
  ["REST APIs", "technical", ["rest", "restful", "rest api", "restful apis", "web services"], ["graphql"]],
  ["Microservices", "technical", ["micro services", "microservice"], ["docker", "kubernetes"]],
  ["Android", "technical", ["android development"], ["kotlin"]],
  ["iOS", "technical", ["ios development"], ["swift"]],
  ["React Native", "technical", [], ["react"]],
  ["Flutter", "technical", ["dart"], []],
  // Data / cloud
  ["PostgreSQL", "technical", ["postgres"], ["sql"]],
  ["MySQL", "technical", [], ["sql"]],
  ["MongoDB", "technical", ["mongo"], ["nosql"]],
  ["NoSQL", "technical", [], ["mongodb"]],
  ["Redis", "technical", [], []],
  ["Elasticsearch", "technical", ["elastic search", "opensearch"], []],
  ["Kafka", "technical", ["apache kafka"], []],
  ["Oracle", "technical", ["oracle db", "oracle database"], ["sql"]],
  ["Snowflake", "technical", [], ["sql", "data_warehousing"]],
  ["Data Warehousing", "technical", ["data warehouse", "dwh"], ["snowflake", "etl"]],
  ["ETL", "technical", ["data pipelines", "data pipeline"], ["data_warehousing"]],
  ["Apache Spark", "technical", ["spark", "pyspark"], ["scala", "python"]],
  ["Hadoop", "technical", [], ["spark"]],
  ["Pandas", "technical", ["numpy"], ["python"]],
  ["Machine Learning", "technical", ["ml"], ["deep_learning", "python"]],
  ["Deep Learning", "technical", [], ["machine_learning", "tensorflow", "pytorch"]],
  ["TensorFlow", "technical", [], ["deep_learning"]],
  ["PyTorch", "technical", [], ["deep_learning"]],
  ["NLP", "technical", ["natural language processing"], ["machine_learning"]],
  ["Computer Vision", "technical", [], ["deep_learning"]],
  ["Generative AI", "technical", ["genai", "llm", "llms", "large language models"], ["machine_learning", "nlp"]],
  ["Statistics", "technical", ["statistical analysis"], ["data_analysis"]],
  ["Data Analysis", "functional", ["data analytics", "analytics"], ["sql", "excel", "power_bi", "tableau"]],
  ["Power BI", "tool", ["powerbi"], ["data_analysis"]],
  ["Tableau", "tool", [], ["data_analysis"]],
  ["Excel", "tool", ["ms excel", "microsoft excel", "advanced excel"], ["data_analysis"]],
  ["AWS", "technical", ["amazon web services", "ec2", "s3"], ["cloud"]],
  ["Azure", "technical", ["microsoft azure"], ["cloud"]],
  ["GCP", "technical", ["google cloud", "google cloud platform"], ["cloud"]],
  ["Cloud Computing", "technical", ["cloud"], ["aws", "azure", "gcp"]],
  ["Docker", "technical", [], ["kubernetes"]],
  ["Kubernetes", "technical", ["k8s"], ["docker"]],
  ["Terraform", "technical", [], ["aws"]],
  ["Ansible", "technical", [], []],
  ["Jenkins", "tool", [], ["ci_cd"]],
  ["CI/CD", "technical", ["ci cd", "cicd", "continuous integration", "continuous delivery", "github actions", "gitlab ci"], ["jenkins", "devops"]],
  ["DevOps", "technical", [], ["ci_cd", "docker"]],
  ["Linux", "technical", ["unix", "shell scripting", "bash"], []],
  ["Git", "tool", ["github", "gitlab", "bitbucket"], []],
  // QA / security
  ["Test Automation", "technical", ["automation testing", "test automation framework", "automated testing"], ["selenium"]],
  ["Selenium", "tool", [], ["test_automation"]],
  ["Manual Testing", "technical", ["functional testing", "regression testing"], []],
  ["Cypress", "tool", ["playwright"], ["test_automation"]],
  ["Cybersecurity", "technical", ["information security", "infosec", "cyber security"], []],
  // Project / product / delivery
  ["Project Management", "functional", ["project manager", "project planning", "project delivery", "pmo"], ["program_management", "agile"]],
  ["Program Management", "functional", ["programme management", "program manager"], ["project_management"]],
  ["Agile", "functional", ["agile methodology", "agile methodologies", "agile delivery"], ["scrum", "kanban"]],
  ["Scrum", "functional", ["scrum master", "scrum framework"], ["agile"]],
  ["Kanban", "functional", [], ["agile"]],
  ["SAFe", "functional", ["scaled agile"], ["agile"]],
  ["PMP", "functional", ["project management professional"], ["project_management"]],
  ["Stakeholder Management", "functional", ["stakeholder engagement", "stakeholder communication"], ["project_management"]],
  ["Risk Management", "functional", ["risk assessment", "risk mitigation"], ["project_management"]],
  ["Budget Management", "functional", ["budgeting", "budget planning", "cost management", "p&l", "p&l management"], ["financial_analysis"]],
  ["Resource Planning", "functional", ["resource management", "capacity planning", "resource allocation"], ["project_management"]],
  ["Delivery Management", "functional", ["delivery lead", "software delivery"], ["project_management"]],
  ["Vendor Management", "functional", ["vendor management", "vendor coordination"], []],
  ["JIRA", "tool", ["atlassian jira", "confluence"], ["agile"]],
  ["MS Project", "tool", ["microsoft project"], ["project_management"]],
  ["Product Management", "functional", ["product manager", "product roadmap", "roadmapping"], ["product_strategy"]],
  ["Product Strategy", "functional", [], ["product_management"]],
  ["Business Analysis", "functional", ["business analyst", "requirements gathering", "requirement analysis", "brd", "user stories"], ["stakeholder_management"]],
  ["UI/UX Design", "functional", ["ux design", "ui design", "user experience", "user interface design", "ux/ui"], ["figma"]],
  ["Figma", "tool", [], ["ui_ux_design"]],
  ["System Design", "technical", ["software architecture", "solution architecture", "system architecture", "hld", "lld"], ["microservices"]],
  ["Data Structures & Algorithms", "technical", ["data structures", "algorithms", "dsa"], []],
  ["Technical Leadership", "functional", ["tech lead", "technical lead", "engineering management"], []],
  ["ITIL", "functional", ["itil v4", "itsm", "service management"], []],
  ["SAP", "technical", ["sap erp", "sap hana", "sap fico", "sap mm", "sap sd", "sap abap"], []],
  ["Salesforce", "technical", ["sfdc", "salesforce crm"], ["crm"]],
  ["CRM", "tool", ["customer relationship management", "hubspot", "zoho crm"], ["salesforce"]],
  // Business functions
  ["Financial Analysis", "functional", ["financial modelling", "financial modeling", "fp&a", "financial reporting"], ["budget_management", "excel"]],
  ["Accounting", "functional", ["tally", "gst", "accounts payable", "accounts receivable", "bookkeeping"], []],
  ["Digital Marketing", "functional", ["performance marketing", "sem", "ppc", "social media marketing"], ["seo"]],
  ["SEO", "functional", ["search engine optimization", "search engine optimisation"], ["digital_marketing"]],
  ["Content Marketing", "functional", ["content writing", "copywriting", "content strategy"], []],
  ["Sales", "functional", ["b2b sales", "business development", "lead generation", "account management", "inside sales"], ["crm"]],
  ["Recruitment", "functional", ["talent acquisition", "sourcing", "technical recruitment"], ["hr"]],
  ["HR Management", "functional", ["human resources", "hr operations", "employee engagement", "payroll", "hrbp"], ["recruitment"]],
  ["Operations Management", "functional", ["operations", "process improvement", "supply chain", "logistics"], []],
  ["Customer Support", "functional", ["customer service", "customer success", "technical support"], []],
  ["Six Sigma", "functional", ["lean six sigma", "lean"], ["operations_management"]],
  // Soft
  ["Leadership", "soft", ["team leadership", "people management", "team management"], []],
  ["Communication", "soft", ["communication skills", "verbal communication", "written communication"], []],
  ["Problem Solving", "soft", ["analytical skills", "analytical thinking", "problem-solving"], []],
  ["Teamwork", "soft", ["collaboration", "team player"], []],
  ["Negotiation", "soft", [], []],
  ["Mentoring", "soft", ["coaching"], ["leadership"]],
];

export interface SkillDef {
  key: string;
  name: string;
  category: Cat;
  aliases: string[];
  related: string[];
}

export const keyOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/\+/g, "p")
    .replace(/#/g, "sharp")
    .replace(/&/g, " and ")
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export const SKILLS: SkillDef[] = DEFS.map(([name, category, aliases, related]) => ({
  key: keyOf(name),
  name,
  category,
  aliases,
  related: related || [],
}));

const BY_KEY = new Map(SKILLS.map((s) => [s.key, s]));
const BY_ALIAS = new Map<string, SkillDef>();
for (const s of SKILLS) {
  BY_ALIAS.set(s.name.toLowerCase(), s);
  BY_ALIAS.set(s.key, s);
  for (const a of s.aliases) BY_ALIAS.set(a.toLowerCase(), s);
}

// Related lists were written with aliases ("dotnet", "spring"); resolve them to canonical keys.
for (const s of SKILLS) s.related = [...new Set(s.related.map((r) => BY_ALIAS.get(r.toLowerCase())?.key ?? r))];

const escapeRe =(s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// One combined, single-pass regex over all skill names/aliases (was ~250 separate regexes per document,
// which starved the event loop when ingesting thousands of job postings).
const collapse = (t: string) => t.toLowerCase().replace(/[\s-]+/g, " ");
const TERM_TO_SKILL = new Map<string, SkillDef>();
for (const s of SKILLS) for (const t of [s.name, ...s.aliases]) TERM_TO_SKILL.set(collapse(t), s);
const ALL_TERMS = [...TERM_TO_SKILL.keys()].sort((a, b) => b.length - a.length); // longest first so "spring boot" beats "spring"
const SKILL_RE = new RegExp(
  `(?<![A-Za-z0-9+#.])(?:${ALL_TERMS.map((t) => escapeRe(t).replace(/ /g, "[\\s-]+")).join("|")})(?![A-Za-z0-9+#]|\\.[A-Za-z])`,
  "gi",
);

export function getSkill(key: string): SkillDef | undefined {
  return BY_KEY.get(key);
}

/** Normalise any skill string to a stable key (canonical if known). */
export function normalizeSkillKey(raw: string): string {
  const t = raw.trim().toLowerCase();
  return BY_ALIAS.get(t)?.key || keyOf(raw);
}

export function displayName(key: string, fallback?: string): string {
  return BY_KEY.get(key)?.name || fallback || key.replace(/_/g, " ");
}

export function categoryOf(key: string): Cat {
  return BY_KEY.get(key)?.category || "technical";
}

/** Skill keys mentioned in free text. Deterministic; never invents anything not in the text. */
export function extractSkillKeys(text: string): string[] {
  const found = new Set<string>();
  SKILL_RE.lastIndex = 0;
  for (let m = SKILL_RE.exec(text); m; m = SKILL_RE.exec(text)) {
    const s = TERM_TO_SKILL.get(collapse(m[0]));
    if (!s) continue;
    if (m[0].length <= 2 && m[0] !== m[0].toUpperCase()) continue; // bare "R"/"Go" must be capitalised
    found.add(s.key);
  }
  return [...found];
}

/** 1 = same skill, 0.5 = declared related, 0 = unrelated. */
export function skillSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const A = BY_KEY.get(a);
  const B = BY_KEY.get(b);
  if (A?.related.includes(b) || B?.related.includes(a)) return 0.5;
  return 0;
}

// ---------- Titles & role families ----------

const ABBREV: Array<[RegExp, string]> = [
  [/\bsr\.?\b/g, "senior"],
  [/\bjr\.?\b/g, "junior"],
  [/\bmgr\b/g, "manager"],
  [/\bdev\b/g, "developer"],
  [/\beng\b/g, "engineer"],
  [/\bsde\b/g, "software development engineer"],
  [/\bswe\b/g, "software engineer"],
  [/\bqa\b/g, "quality assurance"],
  [/\bproject lead\b/g, "project manager"],
  [/\bdelivery lead\b/g, "delivery manager"],
  [/\bprogramme\b/g, "program"],
];

export function normalizeTitle(title: string): string {
  let t = title.toLowerCase();
  t = t.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  // "Project Manager - Senior" -> "senior project manager"
  const tail = t.match(/^(.*?)\s+[-–|,]\s*(senior|junior|lead|principal|staff|associate)\s*$/);
  if (tail) t = `${tail[2]} ${tail[1]}`;
  // drop trailing "- Location" / "| Company" noise
  t = t.split(/\s+[-–|@]\s+/)[0];
  for (const [re, rep] of ABBREV) t = t.replace(re, rep);
  return t.replace(/[^a-z0-9+#/ ]/g, " ").replace(/\s+/g, " ").trim();
}

export type Seniority = "intern" | "junior" | "mid" | "senior" | "lead" | "manager" | "director" | "executive";

export function detectSeniority(title: string): Seniority {
  const t = title.toLowerCase();
  if (/\b(intern|trainee|apprentice)\b/.test(t)) return "intern";
  if (/\b(vp|vice president|chief|cto|ceo|cfo|coo|head of|president)\b/.test(t)) return "executive";
  if (/\bdirector\b/.test(t)) return "director";
  if (/\b(lead|principal|staff|architect)\b/.test(t)) return "lead";
  if (/\b(senior|sr)\b/.test(t)) return "senior";
  if (/\b(manager|delivery manager)\b/.test(t)) return "manager";
  if (/\b(junior|jr|associate|graduate|fresher|entry)\b/.test(t)) return "junior";
  return "mid";
}

const SENIORITY_RANK: Record<Seniority, number> = { intern: 0, junior: 1, mid: 2, senior: 3, lead: 4, manager: 4, director: 5, executive: 6 };
export const seniorityRank = (s: string) => SENIORITY_RANK[s as Seniority] ?? 2;

const FAMILIES: Array<[string, RegExp]> = [
  // Frontline families first: "delivery partner" is logistics, not "delivery manager"-style project work.
  ["logistics", /delivery (boy|partner|executive|associate|agent|driver)|\brider\b|courier|warehouse|picker|packer|loader|driver|chauffeur/],
  ["security_facility", /security guard|security officer|watchman|housekeep|janitor|cleaner/],
  ["skilled_trades", /electrician|plumber|welder|fitter|carpenter|mechanic|technician|machinist/],
  ["healthcare", /nurse|nursing|doctor|physician|pharmacist|medical officer|caregiver/],
  ["teaching", /teacher|tutor|faculty|lecturer|professor/],
  ["hospitality", /\bchef\b|\bcook\b|waiter|steward|barista|housekeeping/],
  ["retail", /store (manager|associate|executive)|cashier|retail|sales associate/],
  ["project_management", /project|program|delivery|pmo|scrum master|release manager/],
  ["product", /product (manager|owner|lead|analyst)|product management|\bpm\b/],
  ["business_analysis", /business analyst|systems analyst|functional consultant|requirements/],
  ["data", /data (scientist|analyst|engineer)|analytics|machine learning|ml engineer|ai engineer|bi developer|business intelligence/],
  ["devops", /devops|sre|site reliability|platform engineer|cloud engineer|infrastructure/],
  ["qa", /quality assurance|\bqa\b|tester|test engineer|sdet|automation engineer/],
  ["design", /designer|\bux\b|\bui\b|creative/],
  ["security", /security|cyber|infosec|soc analyst/],
  ["software_engineering", /software|developer|engineer|programmer|architect|full.?stack|front.?end|back.?end|\bsde\b|mobile/],
  ["sales", /sales|business development|account executive|account manager/],
  ["marketing", /marketing|seo|content|brand|growth/],
  ["hr", /\bhr\b|human resources|recruiter|talent|people (partner|operations)/],
  ["finance", /finance|accountant|accounts|auditor|financial|fp&a/],
  ["operations", /operations|supply chain|logistics|procurement|process/],
  ["support", /support|customer (success|service)|helpdesk|service desk/],
];

export function roleFamily(title: string): string {
  const t = normalizeTitle(title);
  for (const [fam, re] of FAMILIES) if (re.test(t)) return fam;
  return "other";
}

/** Related role families (scope §22.3: "Project Lead ~ Delivery Lead ~ Technical PM"). */
const FAMILY_ADJ: Record<string, string[]> = {
  project_management: ["product", "business_analysis", "operations"],
  product: ["project_management", "business_analysis", "design"],
  business_analysis: ["product", "project_management", "data"],
  software_engineering: ["devops", "qa", "data"],
  devops: ["software_engineering", "security"],
  data: ["software_engineering", "business_analysis"],
  qa: ["software_engineering"],
  security: ["devops", "software_engineering"],
  sales: ["marketing"],
  marketing: ["sales"],
  hr: [],
  finance: ["operations"],
  operations: ["project_management", "finance", "support"],
  support: ["operations"],
  design: ["product"],
};

export function familySimilarity(a: string, b: string): number {
  if (a === b && a !== "other") return 1;
  if (FAMILY_ADJ[a]?.includes(b) || FAMILY_ADJ[b]?.includes(a)) return 0.5;
  return 0;
}

/** Word-level overlap between two normalised titles (0..1). */
export function titleSimilarity(a: string, b: string): number {
  const stop = new Set(["senior", "junior", "lead", "the", "of", "and", "a", "an", "associate", "staff", "principal"]);
  const ta = new Set(normalizeTitle(a).split(" ").filter((w) => w && !stop.has(w)));
  const tb = new Set(normalizeTitle(b).split(" ").filter((w) => w && !stop.has(w)));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / Math.max(ta.size, tb.size);
}
