// Pre-filled search links to the big Indian job portals. We never fetch these sites; the user opens the link in their
// own browser and can bring any job back with "Add a job". URL formats verified 2026-09-23.

export interface PortalLink {
  id: string;
  name: string;
  url: string;
  bestFor: string;
}

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const enc = encodeURIComponent;

export function portalLinks(input: { role: string; city?: string; experienceYears?: number }): PortalLink[] {
  const role = input.role.trim() || "jobs";
  const city = (input.city || "").replace(/^anywhere.*$/i, "").trim();
  const exp = input.experienceYears !== undefined ? Math.max(0, Math.floor(input.experienceYears)) : undefined;
  const links: PortalLink[] = [
    { id: "naukri", name: "Naukri", url: `https://www.naukri.com/${slug(role)}-jobs${city ? `-in-${slug(city)}` : ""}${exp !== undefined ? `?experience=${exp}` : ""}`, bestFor: "Most listings across India" },
    { id: "linkedin", name: "LinkedIn", url: `https://www.linkedin.com/jobs/search/?keywords=${enc(role)}&location=${enc(city ? `${city}, India` : "India")}`, bestFor: "Corporate and tech roles" },
    { id: "indeed", name: "Indeed", url: `https://in.indeed.com/jobs?q=${enc(role)}${city ? `&l=${enc(city)}` : ""}`, bestFor: "Wide mix, including frontline jobs" },
    { id: "foundit", name: "Foundit", url: `https://www.foundit.in/srp/results?query=${enc(role)}${city ? `&locations=${enc(city)}` : ""}`, bestFor: "Mid-level corporate roles" },
    { id: "shine", name: "Shine", url: `https://www.shine.com/job-search/${slug(role)}-jobs${city ? `-in-${slug(city)}` : ""}`, bestFor: "Corporate and sales roles" },
    { id: "apna", name: "Apna", url: city ? `https://apna.co/jobs/${slug(role)}-jobs-in-${slug(city)}` : `https://apna.co/jobs?text=${enc(role)}`, bestFor: "Local, frontline and entry-level jobs" },
    { id: "instahyre", name: "Instahyre", url: `https://www.instahyre.com/search-jobs/?q=${enc(role)}`, bestFor: "Tech and product roles" },
    { id: "internshala", name: "Internshala", url: `https://internshala.com/jobs/keywords-${slug(role)}/`, bestFor: "Freshers and internships" },
    { id: "ncs", name: "National Career Service", url: "https://www.ncs.gov.in/", bestFor: "Government-run portal, jobs across all sectors" },
  ];
  return links;
}
