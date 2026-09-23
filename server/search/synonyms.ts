// Query expansion for Indian job vocabulary: the same job goes by many names ("delivery boy", "rider", "delivery partner").
// Each group is interchangeable; searching any member also searches the others.

const GROUPS: string[][] = [
  ["delivery boy", "delivery partner", "delivery executive", "delivery associate", "rider", "courier"],
  ["telecaller", "tele caller", "telesales", "call center", "call centre", "bpo", "voice process", "customer care executive"],
  ["customer support", "customer service", "customer care", "helpdesk", "chat support", "non voice"],
  ["data entry", "back office", "computer operator", "typist", "mis executive"],
  ["accountant", "accounts executive", "accounts assistant", "tally", "bookkeeper"],
  ["software engineer", "software developer", "developer", "programmer", "sde"],
  ["frontend developer", "front end developer", "react developer", "ui developer"],
  ["backend developer", "back end developer", "node developer", "java developer"],
  ["data analyst", "business analyst", "mis analyst", "reporting analyst"],
  ["sales executive", "field sales", "sales officer", "business development executive", "bde"],
  ["relationship manager", "rm", "relationship officer"],
  ["receptionist", "front desk", "front office executive"],
  ["security guard", "watchman", "security officer"],
  ["housekeeping", "housekeeper", "cleaner", "janitor"],
  ["driver", "chauffeur", "cab driver", "car driver"],
  ["nurse", "staff nurse", "gnm", "anm", "nursing"],
  ["teacher", "tutor", "faculty", "educator"],
  ["hr", "human resources", "recruiter", "talent acquisition", "hr executive"],
  ["electrician", "wireman"],
  ["technician", "service engineer", "field technician"],
  ["cook", "chef", "commis"],
  ["waiter", "steward", "server"],
  ["store manager", "retail manager", "shop manager"],
  ["sales associate", "store associate", "retail associate", "counter sales"],
  ["fresher", "freshers", "entry level", "trainee", "graduate trainee"],
  ["work from home", "wfh", "remote"],
  ["project manager", "program manager", "delivery manager", "project lead"],
  ["qa", "tester", "test engineer", "quality assurance", "sdet"],
  ["devops", "sre", "site reliability", "cloud engineer", "platform engineer"],
  ["warehouse", "picker", "packer", "loader", "warehouse associate"],
  ["pharmacist", "chemist"],
  ["graphic designer", "visual designer", "creative designer"],
  ["digital marketing", "performance marketing", "seo", "social media marketing"],
];

const INDEX = new Map<string, string[]>();
for (const g of GROUPS) for (const term of g) INDEX.set(term, g);
const TERMS = [...INDEX.keys()].sort((a, b) => b.length - a.length);

/** Returns the search term with synonyms appended, and which synonyms were added (shown to the user). */
export function expandQuery(q: string): { term: string; expanded: string[] } {
  const base = q.trim().toLowerCase().replace(/\s+/g, " ");
  if (!base) return { term: "", expanded: [] };
  let rest = ` ${base} `;
  const added = new Set<string>();
  for (const t of TERMS) {
    const needle = ` ${t} `;
    if (!rest.includes(needle)) continue;
    for (const syn of INDEX.get(t)!) if (syn !== t && !base.includes(syn)) added.add(syn);
    rest = rest.replace(needle, " ");
  }
  const expanded = [...added];
  return { term: [base, ...expanded].join(" "), expanded };
}
