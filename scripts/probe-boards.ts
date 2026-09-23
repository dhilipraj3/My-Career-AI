// Probes candidate ATS board slugs against the live public APIs and prints which ones work.
// Usage: npx tsx scripts/probe-boards.ts
import { fetchAshbyBoard, fetchGreenhouseBoard, fetchLeverSite, fetchSmartRecruiters } from "../server/jobs/connectors.js";
import { regionOk } from "../server/jobs/discovery.js";

const candidates: Record<string, string[]> = {
  greenhouse: ["razorpay", "groww", "browserstack", "postman", "chargebee", "druva", "thoughtspot", "clevertap", "mindtickle", "sprinklr", "zeta", "coinswitch", "cars24", "inmobi", "glance", "freshworks", "phonepe", "swiggy", "meesho", "sharechat", "dunzo", "urbancompany", "lenskart", "unacademy", "upgrad", "cred", "hasura", "uniphore", "whatfix", "gojek", "tekion", "juspay", "navi", "slice", "atlan", "ola", "flipkart", "myntra", "zomato", "paytm", "airtel", "jio", "wipro", "infosys", "cloudflare", "stripe", "databricks", "elastic", "gitlab", "twilio", "okta", "datadog", "mongodb", "confluent", "hashicorp", "airbnb", "uber", "dropbox", "asana", "atlassian", "grammarly", "figma", "canva", "notion"],
  lever: ["cred", "paytm", "meesho", "upgrad", "zeta", "dream11", "policybazaar", "gojek", "shopify", "palantir", "netflix", "spotify", "coinswitch", "cleartax", "khatabook", "jupiter", "slice", "leadsquared", "yellowai", "mindtickle", "hasura"],
  ashby: ["notion", "ramp", "linear", "openai", "anthropic", "deel", "zapier", "airtable", "snowflake", "cohere", "vercel", "retool", "duolingo"],
  smartrecruiters: ["Visa", "BoschGroup", "Ubisoft", "McDonaldsCorporation", "Sanofi", "Infosys", "WesternUnion", "Experian", "Freshworks"],
};

const fetchers: Record<string, (s: string) => Promise<any[]>> = {
  greenhouse: fetchGreenhouseBoard, lever: fetchLeverSite, ashby: fetchAshbyBoard, smartrecruiters: fetchSmartRecruiters,
};

const working: Record<string, Array<{ slug: string; total: number; india: number }>> = {};
for (const [kind, slugs] of Object.entries(candidates)) {
  working[kind] = [];
  await Promise.all(slugs.map(async (slug) => {
    try {
      const jobs = await fetchers[kind](slug);
      working[kind].push({ slug, total: jobs.length, india: jobs.filter(regionOk).length });
    } catch { /* not a valid board */ }
  }));
  working[kind].sort((a, b) => b.india - a.india);
  console.log(`\n${kind}:`);
  for (const w of working[kind]) console.log(`  ${w.slug.padEnd(20)} total=${String(w.total).padStart(4)}  india/remote=${w.india}`);
}
