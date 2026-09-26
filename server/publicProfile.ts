// Shareable profile page (/p/<slug>): optional, off by default, and entirely user-controlled. It never shows contact
// details, only first name plus last initial, and the person picks which sections appear. Search engines are kept
// out unless the person also opts in.
import { experienceText } from "../shared/format.js";
import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import type { CandidateProfile } from "../shared/types.js";
import { AppError } from "./applications/service.js";
import { audit } from "./audit.js";
import { getStore } from "./db/store.js";
import { displayName } from "./nlp/skills.js";
import { getProfile } from "./profile/service.js";
import { BRAND } from "../shared/brand.js";
import { esc } from "./seo/render.js";
import { page } from "./seo/render.js";

export interface PublicProfileSettings {
  id: string; // the slug
  uid: string;
  enabled: boolean;
  indexable: boolean;
  show: { city: boolean; experience: boolean; skills: boolean; summary: boolean; education: boolean; roles: boolean };
  updatedAt: string;
}

export const SettingsBody = z.object({
  enabled: z.boolean(), indexable: z.boolean().optional(),
  show: z.object({ city: z.boolean(), experience: z.boolean(), skills: z.boolean(), summary: z.boolean(), education: z.boolean(), roles: z.boolean() }).partial().optional(),
});

const DEFAULT_SHOW = { city: true, experience: true, skills: true, summary: true, education: false, roles: true };
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16) || "member";

export async function getPublicSettings(uid: string): Promise<PublicProfileSettings | null> {
  return (await (await getStore()).query<PublicProfileSettings>("publicProfiles", { where: { uid } }))[0] || null;
}

export async function savePublicSettings(uid: string, input: z.infer<typeof SettingsBody>): Promise<PublicProfileSettings> {
  const store = await getStore();
  const profile = await getProfile(uid);
  if (!profile || profile.status !== "ready") throw new AppError(409, "Finish your profile first.");
  const cur = await getPublicSettings(uid);
  const next: PublicProfileSettings = {
    id: cur?.id || `${slugify(profile.fullName.split(/\s+/)[0] || "")}-${crypto.randomBytes(3).toString("hex")}`,
    uid, enabled: input.enabled, indexable: input.enabled ? (input.indexable ?? cur?.indexable ?? false) : false,
    show: { ...DEFAULT_SHOW, ...(cur?.show || {}), ...(input.show || {}) }, updatedAt: new Date().toISOString(),
  };
  await store.put("publicProfiles", next.id, next);
  await audit(uid, "publicprofile.updated", { enabled: next.enabled, indexable: next.indexable });
  return next;
}

/** "Rajkumar Balasubramanian" → "Rajkumar B." */
export const shortName = (full: string) => { const p = full.trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0] || "Job seeker"; };

export function renderPublicProfile(s: PublicProfileSettings, p: CandidateProfile): string {
  const claimable = p.skills.filter((k) => k.source !== "ai_derived").slice(0, 20);
  const name = shortName(p.fullName);
  const role = p.preferences.targetRoles[0] || p.currentRole;
  const bits = [role, s.show.city && p.city ? p.city : "", s.show.experience && p.totalExperienceYears ? `${experienceText(p.totalExperienceYears)} experience` : ""].filter(Boolean);
  const section = (title: string, html: string) => (html ? `<section class="pp"><h2>${esc(title)}</h2>${html}</section>` : "");
  const body = `<div class="hero" style="margin-top:28px"><h1>${esc(name)}</h1><p>${esc(bits.join(" · "))}</p></div>
${s.show.summary && p.summary ? section("About", `<p>${esc(p.summary)}</p>`) : ""}
${s.show.skills && claimable.length ? section("Skills", `<p>${claimable.map((k) => `<span class="tag">${esc(displayName(k.key, k.name))}</span>`).join(" ")}</p>`) : ""}
${s.show.roles && p.preferences.targetRoles.length ? section("Looking for", `<p>${esc(p.preferences.targetRoles.slice(0, 4).join(", "))}</p>`) : ""}
${s.show.education && p.education.length ? section("Education", `<ul>${p.education.slice(0, 3).map((e) => `<li>${esc([e.degree, e.institution, e.gradYear].filter(Boolean).join(", "))}</li>`).join("")}</ul>`) : ""}
<p class="fine" style="margin-top:24px">Hiring? <a href="/" data-track="employer_cta">Post a job on ${BRAND.name}</a> and candidates like ${esc(name)} can apply directly. Contact details are shared only when a candidate applies.</p>`;
  return page({ title: `${name}: ${role || "Profile"} | ${BRAND.name}`, description: `${name}${role ? `, ${role}` : ""}${p.city && s.show.city ? ` in ${p.city}` : ""}. Profile on ${BRAND.name}.`, path: `/p/${s.id}`, index: s.indexable, body });
}

export function publicProfileRouter(): Router {
  const r = Router();
  r.get("/p/:slug", (req, res, next) => {
    (async () => {
      const s = await (await getStore()).get<PublicProfileSettings>("publicProfiles", req.params.slug);
      const p = s?.enabled ? await getProfile(s.uid) : null;
      res.set("Cache-Control", "no-store");
      if (!s || !p) return res.status(404).type("html").send(page({ title: `Profile not found | ${BRAND.name}`, description: "This profile isn't available.", path: "/", index: false, body: `<div class="hero" style="margin-top:28px"><h1>This profile isn't available</h1><p>The owner may have turned it off.</p></div>` }));
      res.type("html").send(renderPublicProfile(s, p));
    })().catch(next);
  });
  return r;
}
