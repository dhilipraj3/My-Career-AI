import crypto from "node:crypto";
import type { CandidateProfile, ResumeRecord } from "../../shared/types.js";
import { audit } from "../audit.js";
import type { AuthedUser } from "../auth.js";
import { getStore } from "../db/store.js";
import { enrichTop, matchCandidate } from "../matching/service.js";
import { notify } from "../notifications.js";
import { applyParsedResume, getOrCreateProfile, getProfile, saveProfile } from "../profile/service.js";
import { extractResumeText } from "./extract.js";
import { parseResume } from "./parse.js";

export interface UploadResult {
  resume: ResumeRecord;
  duplicate: boolean;
}

/** Synchronous, cheap part: validate + extract text + store. Throws ResumeError on bad files. */
export async function storeResume(user: AuthedUser, file: { buffer: Buffer; originalname: string; mimetype: string }): Promise<UploadResult> {
  const { text, sha256 } = await extractResumeText(file.buffer, file.originalname, user.uid);
  const store = await getStore();
  const existing = (await store.query<ResumeRecord>("resumes", { where: { uid: user.uid } })).find((r) => r.sha256 === sha256 && !r.archived);
  if (existing) return { resume: existing, duplicate: true };
  const resume: ResumeRecord = {
    id: `res_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`, uid: user.uid, fileName: file.originalname.slice(0, 120), mimeType: file.mimetype,
    sizeBytes: file.buffer.length, sha256, text, createdAt: new Date().toISOString(), archived: false,
  };
  await store.put("resumes", resume.id, resume);
  await audit(user.uid, "resume.uploaded", { resumeId: resume.id, sizeBytes: resume.sizeBytes });
  return { resume, duplicate: false };
}

/** Slow part (AI parsing + first matching). Runs in the background; the client polls the profile status. */
export async function processResume(user: AuthedUser, resume: ResumeRecord): Promise<CandidateProfile> {
  let profile = await getOrCreateProfile(user);
  profile = await saveProfile({ ...profile, status: "parsing" });
  try {
    const parsed = await parseResume(user.uid, resume.text);
    const next = applyParsedResume(profile, parsed, resume.id);
    const saved = await saveProfile(next);
    await audit(user.uid, "profile.built_from_resume", { parsedBy: parsed.parsedBy, skills: saved.skills.length, experience: saved.experience.length });
    const missing = saved.completeness.missing.filter((m) => m.essential);
    await notify(user.uid, saved.status === "ready"
      ? { kind: "profile", title: "Your profile is ready", body: "I'll start finding matching jobs for you." }
      : { kind: "profile", title: "A few quick questions", body: `I understood most of your resume. I need ${missing.length} more detail${missing.length === 1 ? "" : "s"} before I start searching.` });
    if (saved.status === "ready") void kickOffMatching(user.uid);
    return saved;
  } catch (err) {
    console.error("[resume] processing failed", err);
    const failed = await getProfile(user.uid);
    if (failed) await saveProfile({ ...failed, status: failed.skills.length || failed.experience.length ? "needs_info" : "empty" });
    await notify(user.uid, { kind: "profile", title: "We couldn't read your resume", body: "Please try uploading a PDF or DOCX again, or paste your details in chat." });
    throw err;
  }
}

export async function kickOffMatching(uid: string): Promise<void> {
  try {
    await matchCandidate(uid, { notifyNew: true });
    await enrichTop(uid, 8);
  } catch (err) {
    console.warn("[matching] initial run failed", err);
  }
}
