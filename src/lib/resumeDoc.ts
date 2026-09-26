// The resume as a real A4 document. One HTML source is used for the on-screen preview and for "Download PDF", so what
// you see is exactly what prints. Layout is single-column and text-only (no tables, icons or images) so applicant
// tracking systems read it reliably, with page-break rules so no job or heading is split awkwardly across pages.
import type { BuiltResume } from "@shared/career";
import type { CandidateProfile, TailoredResumeContent } from "@shared/types";

export type Template = "classic" | "modern" | "compact";

export interface ResumeDoc {
  name: string;
  headline: string;
  contact: string[];
  summary: string;
  fit?: string[];
  skills: string[];
  experience: Array<{ title: string; company: string; period: string; location?: string; bullets: string[] }>;
  projects: Array<{ title: string; description: string }>;
  education: Array<{ degree: string; institution?: string; year?: string }>;
  certifications: string[];
}

export const fromBuilt = (r: BuiltResume): ResumeDoc => ({ ...r, education: r.education.map((e) => ({ degree: e.degree, institution: e.institution, year: e.year })) });

export function fromTailored(c: TailoredResumeContent, p: CandidateProfile): ResumeDoc {
  return {
    name: p.fullName || "Your Name", headline: c.headline,
    contact: [p.email, p.phone, [p.city, p.state].filter(Boolean).join(", "), p.links.linkedin, p.links.github].filter((x): x is string => Boolean(x)),
    summary: c.summary, fit: c.fit, skills: c.skills,
    experience: c.experience.map((e) => ({ title: e.designation, company: e.company, period: e.period, bullets: e.bullets })),
    projects: c.projects,
    education: c.education.map((e) => ({ degree: e.degree, institution: e.institution, year: e.gradYear })),
    certifications: c.certifications,
  };
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STYLE: Record<Template, { font: string; head: string; accent: string; base: number; gap: number; center: boolean }> = {
  classic: { font: "Georgia, 'Times New Roman', serif", head: "Georgia, 'Times New Roman', serif", accent: "#1f2937", base: 10.5, gap: 12, center: true },
  modern: { font: "Inter, 'Segoe UI', Arial, sans-serif", head: "'Plus Jakarta Sans', Inter, 'Segoe UI', Arial, sans-serif", accent: "#0a7399", base: 10.2, gap: 11, center: false },
  compact: { font: "Inter, 'Segoe UI', Arial, sans-serif", head: "Inter, 'Segoe UI', Arial, sans-serif", accent: "#111827", base: 9.6, gap: 8, center: false },
};

/** A complete, standalone HTML page for the resume. `screen` adds a paper look (shadow, page gaps) for the preview. */
export function resumeHtml(r: ResumeDoc, t: Template, opts: { screen?: boolean; title?: string } = {}): string {
  const s = STYLE[t];
  const section = (title: string, body: string) => (body ? `<section><h2>${esc(title)}</h2>${body}</section>` : "");
  const list = (items: string[]) => (items.length ? `<ul>${items.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : "");
  const exp = r.experience.map((e) => `<div class="item"><div class="row"><div><strong>${esc(e.title)}</strong>${e.company ? `<span class="sep">, </span>${esc(e.company)}` : ""}${e.location ? `<span class="muted"> · ${esc(e.location)}</span>` : ""}</div><div class="date">${esc(e.period)}</div></div>${list(e.bullets)}</div>`).join("");
  const edu = r.education.map((e) => `<div class="item row"><div><strong>${esc(e.degree)}</strong>${e.institution ? `<span class="sep">, </span>${esc(e.institution)}` : ""}</div>${e.year ? `<div class="date">${esc(e.year)}</div>` : ""}</div>`).join("");
  const projects = r.projects.map((p) => `<div class="item"><strong>${esc(p.title)}</strong>${p.description ? `: ${esc(p.description)}` : ""}</div>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(opts.title || `${r.name} - Resume`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Plus+Jakarta+Sans:wght@700;800&display=swap" rel="stylesheet">
<style>
@page { size: A4; margin: 14mm 15mm; }
* { box-sizing: border-box; }
html { background: ${opts.screen ? "#dfe5ea" : "#fff"}; }
body { margin: 0; color: #1f2937; font-family: ${s.font}; font-size: ${s.base}pt; line-height: 1.42; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { background: #fff; width: 210mm; min-height: 297mm; margin: ${opts.screen ? "0 auto" : "0"}; padding: ${opts.screen ? "14mm 15mm" : "0"}; ${opts.screen ? "box-shadow: 0 2px 18px rgba(15,35,50,.18);" : ""} }
header { ${s.center ? "text-align: center;" : ""} margin-bottom: ${s.gap + 2}px; ${t === "modern" ? `border-left: 4px solid ${s.accent}; padding-left: 12px;` : ""} }
h1 { font-family: ${s.head}; font-size: ${t === "compact" ? 18 : 22}pt; line-height: 1.15; margin: 0 0 3px; color: ${t === "modern" ? s.accent : "#111827"}; font-weight: 700; letter-spacing: -.2px; }
.headline { font-size: ${s.base + 1}pt; color: #374151; margin: 0 0 3px; }
.contact { font-size: ${s.base - 1}pt; color: #4b5563; margin: 0; }
.contact span + span::before { content: "  |  "; color: #9ca3af; white-space: pre; }
section { margin-top: ${s.gap}px; }
h2 { font-family: ${s.head}; font-size: ${s.base}pt; text-transform: uppercase; letter-spacing: .8px; color: ${s.accent}; margin: 0 0 5px; padding-bottom: 3px; border-bottom: ${t === "modern" ? `1.5px solid ${s.accent}` : "0.8px solid #9ca3af"}; break-after: avoid; page-break-after: avoid; }
p { margin: 0; }
ul { margin: 3px 0 0; padding-left: 16px; }
li { margin: 1.5px 0; }
.item { margin-bottom: ${Math.round(s.gap * 0.7)}px; break-inside: avoid; page-break-inside: avoid; }
.item:last-child { margin-bottom: 0; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.date { flex-shrink: 0; font-size: ${s.base - 1}pt; color: #4b5563; white-space: nowrap; }
.muted { color: #6b7280; }
.skills { line-height: 1.55; }
.fit li { margin: 2px 0; }
@media screen and (max-width: 220mm) { body { font-size: ${s.base}pt; } }
</style></head><body><div class="page">
<header><h1>${esc(r.name)}</h1>${r.headline ? `<p class="headline">${esc(r.headline)}</p>` : ""}${r.contact.length ? `<p class="contact">${r.contact.map((c) => `<span>${esc(c)}</span>`).join("")}</p>` : ""}</header>
${section("Summary", r.summary ? `<p>${esc(r.summary)}</p>` : "")}
${section("Why I'm a fit for this role", r.fit?.length ? `<ul class="fit">${r.fit.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : "")}
${section("Skills", r.skills.length ? `<p class="skills">${r.skills.map(esc).join(" &nbsp;•&nbsp; ")}</p>` : "")}
${section("Experience", exp)}
${section("Projects", projects)}
${section("Education", edu)}
${section("Certifications", r.certifications.length ? list(r.certifications) : "")}
</div></body></html>`;
}

/** Print through a hidden frame, so the browser's "Save as PDF" gets only the resume, on as many pages as it needs. */
export function printResume(r: ResumeDoc, t: Template, fileTitle?: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(resumeHtml(r, t, { title: fileTitle || `${r.name} - Resume` }));
  doc.close();
  const go = () => {
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 60_000); // some browsers return from print() before the dialog closes
  };
  // Wait for the web fonts so the PDF uses them, but never longer than 2.5 seconds.
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  Promise.race([fonts ? fonts.ready : Promise.resolve(), new Promise((r) => setTimeout(r, 2500))]).then(() => setTimeout(go, 50));
}

/** Open the resume full size in a new tab (on phones the preview is scaled down; this one can be zoomed). */
export function openResume(r: ResumeDoc, t: Template): void {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.open();
  w.document.write(resumeHtml(r, t, { screen: true }).replace("<head>", '<head><meta name="viewport" content="width=device-width, initial-scale=0.5, maximum-scale=4">'));
  w.document.close();
}
