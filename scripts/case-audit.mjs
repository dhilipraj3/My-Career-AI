// Finds UI text in Title Case ("Save Job", "Why This Fits") so all labels use sentence case ("Save job").
// Proper nouns and acronyms are allowed. Run: node scripts/case-audit.mjs
import fs from "node:fs";
import path from "node:path";

const OK = new Set("I AI MyCareer.AI MyCareer Asha Google Gemini India Indian LinkedIn Naukri Indeed Foundit Instahyre Apna Internshala NCS WhatsApp Telegram Gmail Outlook Chrome Edge Hindi English Tamil Telugu Kannada Marathi Bengali Malayalam Gujarati PDF DOCX DOC TXT JPG PNG CTC LPA ATS JIRA SQL PMP STAR Scrum Agile Excel Workday Greenhouse Lever Ashby Adzuna Careerjet Jooble Cloudflare Firebase Firestore Render GST ITI API URL CSV J K S H O Ctrl Enter Esc Escape OK Mon Tue Wed Thu Fri Sat Sun Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec Chennai Bengaluru Pune Mumbai Delhi Hyderabad Kolkata Noida Gurugram Remote Hybrid Pan AM PM EN HI SWAYAM NPTEL YouTube React Python Java Excellent Good Fair".split(" "));
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p); } };
walk("src");
const hits = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const texts = [
    ...[...src.matchAll(/>([^<>{}\n]{3,80})</g)].map((m) => m[1]),
    ...[...src.matchAll(/\b(?:label|title|placeholder|aria-label|hint|subtitle|cta)[=:]\s*["'`]([^"'`\n]{3,80})["'`]/g)].map((m) => m[1]),
    ...[...src.matchAll(/\[\s*"[a-z_]+",\s*"([^"\n]{3,60})"\s*\]/g)].map((m) => m[1]),
  ];
  for (const raw of texts) {
    const t = raw.trim();
    if (!/[a-z]/.test(t) || /[{}$=()]|^[a-z-]+$/.test(t) || t.includes("  ")) continue;
    const words = t.replace(/[“”"'.,:;!?…·—–()/&+0-9%₹]/g, " ").split(/\s+/).filter(Boolean);
    const caps = words.slice(1).filter((w) => /^[A-Z][a-z]/.test(w) && !OK.has(w));
    if (caps.length >= 1 && words.length >= 2 && words.length <= 8) hits.push(`${path.relative(".", f)}: "${t}"  → ${caps.join(", ")}`);
  }
}
console.log([...new Set(hits)].join("\n"));
console.log(`\n${new Set(hits).size} label(s) to check`);
