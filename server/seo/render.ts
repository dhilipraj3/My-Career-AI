// Server-rendered public pages: layout, styles and job formatting. Plain HTML + a small stylesheet, no JavaScript
// needed to read them — fast for people on slow phones and fully visible to search engines.
import type { EducationLevel, Job } from "../../shared/types.js";
import { BRAND } from "../../shared/brand.js";
import { config } from "../config.js";
import { slugify } from "./roles.js";

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const abs = (path: string) => new URL(path, config.siteUrl).toString();

export const WORK_MODE: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site", unknown: "" };
export const EMPLOYMENT: Record<string, string> = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship", temporary: "Temporary", unknown: "" };
const EDUCATION: Record<EducationLevel, string> = { none: "No minimum education", "10th": "10th pass", "12th": "12th pass", iti: "ITI", diploma: "Diploma", graduate: "Graduate", postgraduate: "Postgraduate" };
const SCHEMA_EMPLOYMENT: Record<string, string> = { full_time: "FULL_TIME", part_time: "PART_TIME", contract: "CONTRACTOR", internship: "INTERN", temporary: "TEMPORARY" };
const SCHEMA_EDUCATION: Partial<Record<EducationLevel, string>> = { "10th": "high school", "12th": "high school", iti: "professional certificate", diploma: "associate degree", graduate: "bachelor degree", postgraduate: "postgraduate degree" };

export const citySlug = (city: string) => slugify(city);

/** State for the cities most jobs are in (Google asks for addressRegion in job locations). */
const CITY_STATE: Record<string, string> = {
  Bengaluru: "Karnataka", Mysuru: "Karnataka", Mangaluru: "Karnataka", Hubballi: "Karnataka", Hyderabad: "Telangana", Warangal: "Telangana",
  Chennai: "Tamil Nadu", Coimbatore: "Tamil Nadu", Madurai: "Tamil Nadu", Tiruchirappalli: "Tamil Nadu", Salem: "Tamil Nadu", Hosur: "Tamil Nadu",
  Mumbai: "Maharashtra", "Navi Mumbai": "Maharashtra", Thane: "Maharashtra", Pune: "Maharashtra", Nagpur: "Maharashtra", Nashik: "Maharashtra", Aurangabad: "Maharashtra",
  Delhi: "Delhi", "New Delhi": "Delhi", Gurugram: "Haryana", Faridabad: "Haryana", Noida: "Uttar Pradesh", "Greater Noida": "Uttar Pradesh", Ghaziabad: "Uttar Pradesh",
  Lucknow: "Uttar Pradesh", Kanpur: "Uttar Pradesh", Varanasi: "Uttar Pradesh", Agra: "Uttar Pradesh", Kolkata: "West Bengal", Durgapur: "West Bengal",
  Ahmedabad: "Gujarat", Gandhinagar: "Gujarat", Surat: "Gujarat", Vadodara: "Gujarat", Rajkot: "Gujarat", Jaipur: "Rajasthan", Udaipur: "Rajasthan", Jodhpur: "Rajasthan",
  Kochi: "Kerala", Thiruvananthapuram: "Kerala", Kozhikode: "Kerala", Thrissur: "Kerala", Indore: "Madhya Pradesh", Bhopal: "Madhya Pradesh",
  Chandigarh: "Chandigarh", Mohali: "Punjab", Ludhiana: "Punjab", Amritsar: "Punjab", Bhubaneswar: "Odisha", Visakhapatnam: "Andhra Pradesh", Vijayawada: "Andhra Pradesh",
  Guntur: "Andhra Pradesh", Tirupati: "Andhra Pradesh", Patna: "Bihar", Ranchi: "Jharkhand", Jamshedpur: "Jharkhand", Raipur: "Chhattisgarh", Guwahati: "Assam",
  Dehradun: "Uttarakhand", Goa: "Goa", Panaji: "Goa", Puducherry: "Puducherry", Srinagar: "Jammu and Kashmir", Jammu: "Jammu and Kashmir", Shimla: "Himachal Pradesh",
};

export function jobPath(j: Job): string {
  const place = j.workMode === "remote" ? "remote" : j.cities?.[0] || j.city || "";
  const slug = slugify(`${j.title} ${j.company} ${place}`).slice(0, 90).replace(/-+$/, "");
  return `/jobs/${slug || "job"}-${j.id}`;
}

export function placeText(j: Job): string {
  if (j.workMode === "remote") return "Remote";
  if (j.panIndia) return "Pan India";
  if (j.cities?.length) return j.cities.slice(0, 3).join(", ") + (j.cities.length > 3 ? ` +${j.cities.length - 3}` : "");
  return j.city || j.location || "India";
}

export function payText(j: Job): string {
  if (j.salaryDisplay) return j.salaryDisplay;
  if (j.salaryMinLPA || j.salaryMaxLPA) return `₹${j.salaryMinLPA ?? "?"}–${j.salaryMaxLPA ?? "?"} LPA`;
  return "";
}

export const expText = (j: Job) =>
  j.experienceMin === undefined ? (j.freshersWelcome ? "Freshers welcome" : "") : j.experienceMin === 0 && !j.experienceMax ? "Freshers welcome" : `${j.experienceMin}${j.experienceMax ? `–${j.experienceMax}` : "+"} yrs`;

export function ago(iso?: string): string {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export const monthYear = () => new Date().toLocaleDateString("en-IN", { month: "short", year: "numeric" });

/** Posting text → safe HTML paragraphs and bullet lists. */
export function descriptionHtml(text: string): string {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((b) => {
    const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
    const bullet = /^([•●▪◦*\-–]|\d+[.)])\s+/;
    if (lines.length > 1 && lines.filter((l) => bullet.test(l)).length >= lines.length - 1) {
      const head = bullet.test(lines[0]) ? "" : `<p>${esc(lines.shift())}</p>`;
      return `${head}<ul>${lines.map((l) => `<li>${esc(l.replace(bullet, ""))}</li>`).join("")}</ul>`;
    }
    return `<p>${lines.map(esc).join("<br>")}</p>`;
  }).join("\n");
}

/** Google's JobPosting structured data (what puts a job into Google's job search). */
export function jobPostingLd(j: Job): Record<string, unknown> {
  const posted = (j.postedAt || j.firstSeenAt).slice(0, 10);
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: j.title,
    description: descriptionHtml(j.description),
    identifier: { "@type": "PropertyValue", name: j.company, value: j.id },
    datePosted: posted,
    hiringOrganization: { "@type": "Organization", name: j.company, ...(j.companyUrl ? { sameAs: j.companyUrl } : {}) },
    directApply: false,
    url: abs(jobPath(j)),
  };
  if (j.deadline) ld.validThrough = new Date(j.deadline).toISOString();
  if (SCHEMA_EMPLOYMENT[j.employmentType]) ld.employmentType = SCHEMA_EMPLOYMENT[j.employmentType];
  const cities = j.cities?.length ? j.cities : j.city ? [j.city] : [];
  if (j.workMode === "remote") {
    ld.jobLocationType = "TELECOMMUTE";
    ld.applicantLocationRequirements = { "@type": "Country", name: "India" };
  }
  if (cities.length && j.workMode !== "remote") {
    ld.jobLocation = cities.slice(0, 10).map((c) => {
      const region = CITY_STATE[c] || (cities.length === 1 ? j.state : "");
      return { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: c, ...(region ? { addressRegion: region } : {}), addressCountry: "IN" } };
    });
  } else if (!cities.length && j.workMode !== "remote") {
    ld.jobLocation = { "@type": "Place", address: { "@type": "PostalAddress", addressCountry: "IN" } };
  }
  if (j.salaryMinLPA || j.salaryMaxLPA) {
    const v = (lpa?: number) => (lpa ? Math.round(lpa * 100000) : undefined);
    ld.baseSalary = { "@type": "MonetaryAmount", currency: "INR", value: { "@type": "QuantitativeValue", ...(v(j.salaryMinLPA) ? { minValue: v(j.salaryMinLPA) } : {}), ...(v(j.salaryMaxLPA) ? { maxValue: v(j.salaryMaxLPA) } : {}), unitText: "YEAR" } };
  }
  if (j.experienceMin !== undefined && j.experienceMin > 0) ld.experienceRequirements = { "@type": "OccupationalExperienceRequirements", monthsOfExperience: j.experienceMin * 12 };
  else if (j.freshersWelcome) ld.experienceRequirements = "no requirements";
  if (j.education && SCHEMA_EDUCATION[j.education]) ld.educationRequirements = { "@type": "EducationalOccupationalCredential", credentialCategory: SCHEMA_EDUCATION[j.education] };
  if (j.skills.length) ld.skills = j.skills.slice(0, 15).map((s) => s.replace(/_/g, " ")).join(", ");
  return ld;
}

export const breadcrumbLd = (items: Array<[string, string]>) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: abs(path) })),
});

export function breadcrumbHtml(items: Array<[string, string]>): string {
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.map(([name, path], i) => (i === items.length - 1 ? `<li aria-current="page">${esc(name)}</li>` : `<li><a href="${esc(path)}">${esc(name)}</a></li>`)).join("")}</ol></nav>`;
}

export function jobCardHtml(j: Job): string {
  const meta = [placeText(j), WORK_MODE[j.workMode] && j.workMode !== "remote" ? WORK_MODE[j.workMode] : "", expText(j), payText(j)].filter(Boolean);
  return `<article class="job">
  <a class="job-link" href="${esc(jobPath(j))}"><h3>${esc(j.title)}</h3></a>
  <p class="co">${esc(j.company)}</p>
  <p class="meta">${meta.map((m) => `<span>${esc(m)}</span>`).join("")}</p>
  <p class="when">${j.freshersWelcome ? '<span class="tag">Freshers welcome</span>' : ""}Posted ${esc(ago(j.postedAt || j.firstSeenAt))}</p>
</article>`;
}

export interface PageOptions {
  title: string;
  description: string;
  path: string; // canonical path
  index: boolean;
  body: string;
  jsonLd?: unknown[];
  ogType?: string;
  footerLinks?: { cities: Array<[string, string]>; roles: Array<[string, string]> };
}

const GA = BRAND.gaMeasurementId;
// Same consent key as the app. Analytics loads only after "Allow".
const CONSENT_SCRIPT = `(function(){var k="mc_analytics_consent",c=null;try{c=localStorage.getItem(k)}catch(e){}
function load(){if(window.gtag)return;var s=document.createElement("script");s.async=true;s.src="https://www.googletagmanager.com/gtag/js?id=${GA}";document.head.appendChild(s);window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};gtag("js",new Date());gtag("config","${GA}")}
function set(v){try{localStorage.setItem(k,v)}catch(e){}document.getElementById("consent").hidden=true;if(v==="granted")load()}
if(c==="granted")load();else if(!c){var b=document.getElementById("consent");b.hidden=false;b.querySelector("[data-yes]").onclick=function(){set("granted")};b.querySelector("[data-no]").onclick=function(){set("denied")}}
document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("[data-track]");if(a&&window.gtag)gtag("event",a.getAttribute("data-track"),{from:"public_page"})});})();`;

export function page(o: PageOptions): string {
  const url = abs(o.path);
  const ld = (o.jsonLd || []).map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, "\\u003c")}</script>`).join("\n");
  const foot = o.footerLinks;
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(url)}">
<meta name="robots" content="${o.index ? "index, follow, max-image-preview:large" : "noindex, follow"}">
<meta name="theme-color" content="${BRAND.themeColor}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=3">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png?v=3">
<link rel="apple-touch-icon" href="/icons/icon-180.png?v=3">
<meta property="og:type" content="${o.ogType || "website"}">
<meta property="og:site_name" content="${BRAND.name}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${abs("/og-image.png")}">
<meta property="og:locale" content="en_IN">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/seo.css?v=2">
${ld}
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brand" href="/"><img src="/favicon.svg?v=3" alt="" width="30" height="30"><span>MyCareer<b>.AI</b></span></a>
  <nav><a href="/jobs">Browse jobs</a><a class="btn" href="/" data-track="sign_up_click">Get matched — free</a></nav>
</div></header>
<main class="wrap">
${o.body}
</main>
<footer class="foot"><div class="wrap">
  ${foot ? `<div class="cols">
    <div><h4>Jobs by city</h4><ul>${foot.cities.map(([n, p]) => `<li><a href="${esc(p)}">${esc(n)}</a></li>`).join("")}</ul></div>
    <div><h4>Popular searches</h4><ul>${foot.roles.map(([n, p]) => `<li><a href="${esc(p)}">${esc(n)}</a></li>`).join("")}</ul></div>
    <div><h4>${BRAND.name}</h4><ul><li><a href="/">How it works</a></li><li><a href="/jobs">All jobs</a></li><li><a href="/fresher-jobs">Fresher jobs</a></li><li><a href="/remote-jobs">Remote jobs</a></li></ul></div>
  </div>` : ""}
  <p class="fine"><img src="/favicon.svg?v=3" alt="" width="18" height="18"> ${BRAND.name} — ${BRAND.tagline}. Jobs come from company careers sites and licensed job boards; always apply on the employer's own page.</p>
</div></footer>
<div id="consent" class="consent" hidden role="dialog" aria-label="Analytics consent">
  <p><b>Help us improve ${BRAND.name}?</b> We'd like to use Google Analytics to count page visits. No personal details are sent.</p>
  <div><button data-yes class="btn">Allow</button><button data-no class="btn ghost">No thanks</button></div>
</div>
<script>${CONSENT_SCRIPT}</script>
</body>
</html>`;
}

export const SEO_CSS = `
:root{--ink:#0a2230;--text:#334155;--muted:#64748b;--line:#e2e8f0;--bg:#f8fafc;--brand:#0a7399;--brand-d:#0b5d7e;--brand-l:#ecf8fb;--green:#059669}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:radial-gradient(900px 600px at -5% -10%,rgb(11 141 179 / .10),transparent 60%),radial-gradient(800px 520px at 105% -5%,rgb(7 163 132 / .10),transparent 60%),var(--bg);background-attachment:fixed;color:var(--text);font:16px/1.6 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--brand)}img{max-width:100%}
h1,h2,h3,h4{font-family:"Plus Jakarta Sans",Inter,system-ui,sans-serif;color:var(--ink);line-height:1.25}
.wrap{max-width:1040px;margin:0 auto;padding:0 16px}
.top{background:rgb(255 255 255 / .72);-webkit-backdrop-filter:blur(16px) saturate(160%);backdrop-filter:blur(16px) saturate(160%);border-bottom:1px solid rgb(255 255 255 / .7);position:sticky;top:0;z-index:5}
.top .wrap{display:flex;align-items:center;justify-content:space-between;height:60px;gap:12px}
.brand{display:flex;align-items:center;gap:8px;text-decoration:none;font:800 19px "Plus Jakarta Sans",sans-serif;color:var(--ink)}.brand b{background:linear-gradient(90deg,var(--brand),#07a384);-webkit-background-clip:text;background-clip:text;color:transparent}
.top nav{display:flex;align-items:center;gap:16px}.top nav a{text-decoration:none;font-weight:500;font-size:15px;color:var(--text)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:12px;background:linear-gradient(135deg,var(--brand),#07a384);color:#fff!important;padding:10px 16px;font:600 15px Inter,sans-serif;text-decoration:none;cursor:pointer}
.btn:hover{filter:brightness(1.08)}.btn.ghost{background:#fff;color:var(--text)!important;border:1px solid var(--line)}.btn.big{padding:13px 20px;font-size:16px}
.crumbs ol{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:18px 0 6px;font-size:13px;color:var(--muted)}
.crumbs li+li::before{content:"›";margin-right:6px}.crumbs a{color:var(--muted);text-decoration:none}.crumbs a:hover{color:var(--brand)}
.hero{margin:6px 0 20px}.hero h1{font-size:clamp(26px,5vw,38px);margin:6px 0 8px}.hero p{margin:0;max-width:760px}
.count{display:inline-block;background:var(--brand-l);color:var(--brand-d);font-weight:600;font-size:13px;border-radius:999px;padding:3px 10px}
.search{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}.search input{flex:1 1 220px;min-width:0;border:1px solid var(--line);border-radius:12px;padding:11px 14px;font:inherit;background:#fff}
.grid{display:grid;grid-template-columns:1fr;gap:12px}@media(min-width:760px){.grid{grid-template-columns:1fr 1fr}}
.job{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px 18px;transition:border-color .15s,box-shadow .15s}
.job:hover{border-color:#a7e0ec;box-shadow:0 4px 16px rgba(79,70,229,.08)}
.job h3{margin:0;font-size:17px}.job-link{text-decoration:none}.job-link:hover h3{color:var(--brand)}
.job .co{margin:2px 0 8px;font-weight:500;color:var(--text)}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin:0}.meta span{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:2px 8px;font-size:13px}
.when{margin:10px 0 0;font-size:13px;color:var(--muted)}.tag{background:#ecfdf5;color:var(--green);border-radius:6px;padding:1px 7px;margin-right:8px;font-weight:600;font-size:12px}
.pager{display:flex;justify-content:space-between;align-items:center;margin:22px 0;font-size:14px;color:var(--muted)}
.links{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0;padding:0;list-style:none}.links a{display:inline-block;background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:14px;text-decoration:none;color:var(--text)}.links a:hover{border-color:var(--brand);color:var(--brand)}
section.more{margin:34px 0}section.more h2{font-size:20px;margin:0 0 4px}
.cta{background:linear-gradient(135deg,#0b5d7e,#07a384);color:#d3f0f6;border-radius:20px;padding:22px;margin:28px 0;display:flex;flex-wrap:wrap;align-items:center;gap:16px;justify-content:space-between}
.cta h2{color:#fff;margin:0 0 4px;font-size:20px}.cta p{margin:0}.cta .btn{background:#fff;color:var(--brand-d)!important}
.jobpage{display:grid;grid-template-columns:1fr;gap:20px;margin-bottom:30px}@media(min-width:900px){.jobpage{grid-template-columns:1fr 320px}}
.panel{background:#fff;border:1px solid var(--line);border-radius:18px;padding:20px 22px}
.jobhead h1{font-size:clamp(24px,4.5vw,32px);margin:4px 0}.jobhead .co{font-size:17px;font-weight:600;margin:0 0 12px}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;margin:16px 0 0;font-size:14px}.facts dt{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}.facts dd{margin:0;font-weight:500;color:var(--ink)}
.desc{overflow-wrap:anywhere}.desc h2{font-size:19px}.desc ul{padding-left:20px}.desc li{margin:4px 0}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}.chips span{background:var(--brand-l);color:var(--brand-d);border-radius:8px;padding:3px 9px;font-size:13px;font-weight:500}
.side{display:flex;flex-direction:column;gap:14px}.side .panel{position:relative}.side .btn{width:100%}.side p{font-size:14px;margin:8px 0 0}
.closed{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:14px;padding:12px 16px;margin:12px 0;font-weight:500}
.source{font-size:13px;color:var(--muted)}
.foot{border-top:1px solid var(--line);background:#fff;margin-top:40px;padding:28px 0 36px;font-size:14px}
.foot .cols{display:grid;grid-template-columns:1fr;gap:18px}@media(min-width:760px){.foot .cols{grid-template-columns:1fr 1fr 1fr}}
.foot h4{margin:0 0 6px;font-size:14px}.foot ul{list-style:none;margin:0;padding:0;columns:2}.foot li{margin:3px 0}.foot a{color:var(--text);text-decoration:none}.foot a:hover{color:var(--brand)}
.fine{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px;margin:22px 0 0}
.consent{position:fixed;left:12px;right:12px;bottom:12px;max-width:440px;margin:0 auto;background:#fff;border:1px solid var(--line);border-radius:16px;padding:14px 16px;box-shadow:0 12px 32px rgba(15,23,42,.15);font-size:14px;z-index:20}
.consent p{margin:0 0 10px}.consent div{display:flex;gap:8px}.consent .btn{padding:8px 14px;font-size:14px}
.empty{background:#fff;border:1px dashed var(--line);border-radius:16px;padding:28px;text-align:center}
@media(max-width:560px){.top nav a:not(.btn){display:none}.facts{grid-template-columns:1fr}}
`;
