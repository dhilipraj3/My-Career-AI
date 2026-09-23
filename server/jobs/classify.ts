// Deterministic job classification for every segment of the Indian job market:
// category (white-collar and frontline), minimum education, and whether freshers are welcome.
import type { EducationLevel, JobCategory } from "../../shared/types.js";

// Order matters: the first rule whose pattern matches the TITLE wins; the description is only a fallback.
const CATEGORY_RULES: Array<[JobCategory, RegExp]> = [
  ["driver", /\b(driver|chauffeur|cab|forklift operator|heavy vehicle|lmv|hmv)\b/i],
  ["logistics_delivery", /\b(delivery (boy|partner|executive|associate|agent)|rider|courier|warehouse|picker|packer|loader|logistics|supply chain|dispatch|inventory|fleet|last[- ]mile|shipping)\b/i],
  ["skilled_trades", /\b(electrician|plumber|welder|fitter|carpenter|mechanic|technician|hvac|machinist|mason|painter|ac repair|tailor|beautician|barber|cnc)\b/i],
  ["security_facility", /\b(security guard|security officer|bouncer|housekeeping|house ?keeper|janitor|cleaner|facility (executive|manager)|office boy|peon|gardener|watchman)\b/i],
  ["healthcare", /\b(nurse|nursing|doctor|physician|pharmacist|medical (officer|representative)|lab technician|radiolog|physiotherap|dentist|dental|caregiver|ward boy|patient care|clinical|paramedic|mbbs|gnm|anm)\b/i],
  ["education", /\b(teacher|tutor|faculty|lecturer|professor|trainer|educator|counsellor|counselor|academic|principal|school)\b/i],
  ["hospitality_food", /\b(chef|cook|waiter|steward|barista|bartender|kitchen|restaurant|hotel|front office|hospitality|food (and|&) beverage|f&b|commis|captain)\b/i],
  ["retail", /\b(store (manager|executive|associate)|retail|cashier|sales ?(associate|staff|girl|boy) in store|merchandiser|shop|showroom|counter sales|visual merchandis)\b/i],
  ["office_admin", /\b(data entry|back office|receptionist|front desk|office (assistant|admin|executive)|admin(istrative)? (assistant|executive)|typist|computer operator|mis executive|document)\b/i],
  ["manufacturing", /\b(machine operator|production (supervisor|engineer|operator|executive)|assembly|plant|quality (inspector|control)|qc |shift supervisor|maintenance engineer|manufacturing|operator)\b/i],
  ["construction_realestate", /\b(site engineer|civil engineer|construction|surveyor|architect|interior designer|real estate|property|quantity surveyor|draughtsman|draftsman)\b/i],
  ["data_ai", /\b(data (scientist|analyst|engineer)|machine learning|ml engineer|ai engineer|analytics|business intelligence|bi (developer|analyst)|statistician|deep learning|nlp|computer vision|llm)\b/i],
  ["design", /\b(designer|ux|ui\/ux|graphic|illustrator|animator|video editor|creative director)\b/i],
  ["product", /\b(product (manager|owner|lead|analyst)|product management)\b/i],
  ["tech", /\b(software|developer|engineer|programmer|devops|sre|cloud|full[- ]?stack|front[- ]?end|back[- ]?end|mobile|android|ios|qa|tester|sdet|architect|it support|system admin|network|cyber|security engineer|database|dba)\b/i],
  ["customer_support", /\b(customer (support|service|care|success)|call cent(er|re)|bpo|voice process|non[- ]voice|telecaller|tele ?caller|helpdesk|help desk|chat support|kpo)\b/i],
  ["sales", /\b(sales|business development|bde|bdm|account (executive|manager)|relationship (manager|officer)|field (sales|executive)|marketing executive|insurance advisor|pre[- ]sales|inside sales|channel)\b/i],
  ["marketing", /\b(marketing|seo|sem|social media|content|copywriter|brand|digital marketing|performance marketing|growth|pr |public relations|communications)\b/i],
  ["finance_accounts", /\b(accountant|accounts|finance|financial|audit|tax|gst|ca\b|chartered accountant|cost accountant|payroll|treasury|credit analyst|banking|loan|underwriter|actuar|investment|equity|bookkeep)\b/i],
  ["hr", /\b(hr|human resources|recruiter|talent acquisition|people (partner|operations)|payroll executive|hrbp)\b/i],
  ["legal", /\b(lawyer|advocate|legal|counsel|paralegal|compliance|company secretary|cs\b)\b/i],
  ["media_content", /\b(journalist|reporter|editor|anchor|writer|photographer|videographer|content creator|producer)\b/i],
  ["operations", /\b(operations|process (associate|executive)|project (manager|coordinator)|program manager|delivery (manager|lead|head)|scrum master|pmo|coordinator|analyst|consultant|business analyst|procurement|purchase)\b/i],
];

export function classifyCategory(title: string, description = ""): JobCategory {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(title)) return cat;
  const head = description.slice(0, 600);
  for (const [cat, re] of CATEGORY_RULES) if (re.test(head)) return cat;
  return "other";
}

const EDU_RULES: Array<[EducationLevel, RegExp]> = [
  ["10th", /\b(10th|tenth|sslc|matric(ulation)?|ssc)\b( pass)?/i],
  ["12th", /\b(12th|twelfth|hsc|intermediate|puc|higher secondary)\b( pass)?/i],
  ["iti", /\biti\b|industrial training institute|\bncvt\b|\bscvt\b/i],
  ["diploma", /\bdiploma\b|\bpolytechnic\b/i],
  ["graduate", /\b(graduate|graduation|bachelor'?s?|b\.? ?(tech|e|sc|com|a|ba|ca|bba|pharm)\b|be\/btech|b\.e\.|any degree|degree in)\b/i],
  ["postgraduate", /\b(post ?graduate|master'?s?|m\.? ?(tech|sc|com|ba|ca|a)\b|mba|pgdm|ph\.?d|doctorate)\b/i],
];
const EDU_RANK: EducationLevel[] = ["none", "10th", "12th", "iti", "diploma", "graduate", "postgraduate"];

/** Lowest education level the posting asks for (the bar to clear), or undefined if it doesn't say. */
export function minimumEducation(text: string): EducationLevel | undefined {
  if (/\b(no (minimum )?(education|qualification) (required|needed)|illiterate|any qualification|education no bar)\b/i.test(text)) return "none";
  const found = EDU_RULES.filter(([, re]) => re.test(text)).map(([lvl]) => lvl);
  if (!found.length) return undefined;
  return found.sort((a, b) => EDU_RANK.indexOf(a) - EDU_RANK.indexOf(b))[0];
}

export const educationRank = (e: EducationLevel | undefined) => (e ? EDU_RANK.indexOf(e) : -1);

export function freshersWelcome(title: string, text: string, experienceMin?: number): boolean {
  if (experienceMin !== undefined && experienceMin > 1) return false;
  if (/\b(senior|sr\.?|lead|principal|staff|manager|head|director|vp|architect)\b/i.test(title)) return false;
  return experienceMin === 0 || /\b(freshers?|entry[- ]level|graduate (trainee|program)|trainee|apprentice|intern(ship)?|0\s*(-|–|to)\s*[12]\s*(years?|yrs?)|no experience (required|needed))\b/i.test(`${title} ${text.slice(0, 3000)}`);
}

/** Categories where pay is usually quoted per month and CTC above ~15 LPA is implausible. */
export const FRONTLINE: JobCategory[] = ["driver", "logistics_delivery", "skilled_trades", "security_facility", "hospitality_food", "retail", "manufacturing", "office_admin", "customer_support"];
