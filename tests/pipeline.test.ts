import { beforeEach, describe, expect, it } from "vitest";
import type { CandidateProfile, Job, TailoredResumeContent } from "../shared/types.js";
import { getStore } from "../server/db/store.js";
import { normalizeRaw, isRejected, computeFreshness } from "../server/jobs/normalize.js";
import { ingestRawJobs, refreshFreshness } from "../server/jobs/ingest.js";
import { regionOk, runDiscovery, listConnectorHealth, setConnectors, setConnectorEnabled } from "../server/jobs/discovery.js";
import { computeMatch } from "../server/matching/engine.js";
import { deterministicParse } from "../server/resume/parse.js";
import { applyParsedResume, newProfile, updatePreferences, saveProfile } from "../server/profile/service.js";
import { deterministicTailoring, repairTailored, validateTailored, checkClaims } from "../server/resume/tailor.js";
import { RESUME_TEXT, fakeConnector, freshEnv, rawJob } from "./fixtures.js";

async function readyProfile(uid = "u1"): Promise<CandidateProfile> {
  const base = applyParsedResume(newProfile({ uid, email: "p@example.com", name: "Priya Sharma" }), deterministicParse(RESUME_TEXT), "res1");
  const store = await getStore();
  await store.put("profiles", uid, base);
  await updatePreferences(uid, { targetRoles: ["Senior Project Manager"], locations: ["Chennai"], workModes: ["hybrid", "remote"], minSalaryLPA: 20, noticePeriodDays: 30 });
  return (await store.get<CandidateProfile>("profiles", uid))!;
}

beforeEach(() => freshEnv());

describe("job normalisation & quality", () => {
  it("normalises a raw job into the canonical shape", () => {
    const n = normalizeRaw(rawJob());
    if (isRejected(n)) throw new Error("rejected");
    const j = n.job;
    expect(j.city).toBe("Chennai");
    expect(j.country).toBe("India");
    expect(j.experienceMin).toBe(8);
    expect(j.salaryMinLPA).toBe(25);
    expect(j.salaryMaxLPA).toBe(32);
    expect(j.workMode).toBe("hybrid");
    expect(j.skills).toEqual(expect.arrayContaining(["agile", "scrum", "jira", "ms_project"]));
    expect(j.companyKey).toBe("acme");
    expect(j.status).toBe("new");
  });
  it("rejects jobs with missing essentials", () => {
    expect(normalizeRaw(rawJob({ title: "" }))).toEqual({ reason: "missing_title" });
    expect(normalizeRaw(rawJob({ company: "" }))).toEqual({ reason: "missing_company" });
    expect(normalizeRaw(rawJob({ description: "too short" }))).toEqual({ reason: "missing_description" });
    expect(normalizeRaw(rawJob({ url: "", applyUrl: "" }))).toEqual({ reason: "missing_url" });
  });
  it("flags spam and marks suspicious without deleting", () => {
    const n = normalizeRaw(rawJob({ description: rawJob().description + " Pay a registration fee of 500 and contact us on WhatsApp to start earning ₹5000 per day." }));
    if (isRejected(n)) throw new Error("should be kept, flagged");
    expect(n.job.quality.flags).toContain("spam_language");
    expect(n.job.quality.suspicious).toBe(true);
  });
  it("only keeps jobs a candidate in India could take", () => {
    expect(regionOk({ location: "Bengaluru", remote: false })).toBe(true);
    expect(regionOk({ location: "Remote", remote: true })).toBe(true);
    expect(regionOk({ location: "Remote - US only", remote: true })).toBe(false);
    expect(regionOk({ location: "London, United Kingdom", remote: false })).toBe(false);
  });
});

describe("dedupe & freshness", () => {
  it("merges the same opportunity from different sources into one canonical job", async () => {
    const a = rawJob();
    const b = rawJob({ connector: "adzuna", sourceName: "Adzuna", sourceJobId: "zz9", company: "ACME Technologies Private Limited", title: "Sr. Project Manager", url: "https://adzuna.in/x", applyUrl: "https://adzuna.in/x" });
    const stats = await ingestRawJobs([a, b]);
    expect(stats.inserted).toBe(1);
    expect(stats.merged).toBe(1);
    const jobs = await (await getStore()).query<Job>("jobs");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].sources.map((s) => s.connector).sort()).toEqual(["adzuna", "greenhouse"]);
  });
  it("detects duplicates by description similarity even with different titles", async () => {
    await ingestRawJobs([rawJob()]);
    const stats = await ingestRawJobs([rawJob({ connector: "lever", sourceJobId: "9", title: "Project Manager, Senior Level", url: "https://x.example/a", applyUrl: "https://x.example/a" })]);
    expect(stats.merged).toBe(1);
    expect(await (await getStore()).query("jobs")).toHaveLength(1);
  });
  it("keeps genuinely different jobs apart", async () => {
    await ingestRawJobs([rawJob(), rawJob({ sourceJobId: "2", title: "Data Engineer", description: "Build ETL pipelines with Python, SQL and Spark for our analytics platform in Chennai. 4+ years of experience required. " + "x".repeat(60), url: "https://a.example/2", applyUrl: "https://a.example/2" })]);
    expect(await (await getStore()).query("jobs")).toHaveLength(2);
  });
  it("re-ingesting the same job refreshes verification instead of duplicating", async () => {
    const first = await ingestRawJobs([rawJob()]);
    const second = await ingestRawJobs([rawJob()]);
    expect(first.inserted).toBe(1);
    expect(second.inserted).toBe(0);
    expect(second.merged).toBe(1);
  });
  it("walks the freshness state machine", () => {
    const now = Date.now();
    const day = 86400000;
    const mk = (verifiedAgo: number, firstSeenAgo = 30 * day) => ({ lastVerifiedAt: new Date(now - verifiedAgo).toISOString(), firstSeenAt: new Date(now - firstSeenAgo).toISOString(), status: "active" as const });
    expect(computeFreshness(mk(3600_000, 3600_000), now)).toBe("new");
    expect(computeFreshness(mk(3600_000), now)).toBe("recently_verified");
    expect(computeFreshness(mk(2 * day), now)).toBe("active");
    expect(computeFreshness(mk(5 * day), now)).toBe("stale");
    expect(computeFreshness(mk(10 * day), now)).toBe("potentially_expired");
    expect(computeFreshness(mk(20 * day), now)).toBe("expired");
    expect(computeFreshness({ ...mk(3600_000), deadline: new Date(now - day).toISOString() }, now)).toBe("expired");
  });
  it("expires jobs no source lists any more", async () => {
    await ingestRawJobs([rawJob()]);
    const store = await getStore();
    const [j] = await store.query<Job>("jobs");
    await store.update<Job>("jobs", j.id, { lastVerifiedAt: new Date(Date.now() - 20 * 86400000).toISOString() });
    expect(await refreshFreshness()).toBe(1);
    expect((await store.get<Job>("jobs", j.id))!.status).toBe("expired");
  });
});

describe("connector isolation & health", () => {
  it("a failing source never stops the others", async () => {
    setConnectors([
      fakeConnector("good", [rawJob()]),
      fakeConnector("bad", async () => { throw new Error("HTTP 503 from example.com"); }),
    ]);
    const report = await runDiscovery();
    expect(report.connectors.find((c) => c.id === "good")).toMatchObject({ inserted: 1 });
    expect(report.connectors.find((c) => c.id === "bad")!.error).toMatch(/503/);
    const health = await listConnectorHealth();
    expect(health.find((h) => h.id === "good")!.status).toBe("healthy");
    expect(health.find((h) => h.id === "bad")!.status).toBe("degraded");
  });
  it("marks a repeatedly failing connector as failing and admin can disable it", async () => {
    setConnectors([fakeConnector("bad", async () => { throw new Error("boom"); })]);
    for (let i = 0; i < 3; i++) await runDiscovery();
    expect((await listConnectorHealth())[0].status).toBe("failing");
    await setConnectorEnabled("bad", false);
    const report = await runDiscovery();
    expect(report.connectors).toHaveLength(0);
    expect((await listConnectorHealth())[0].status).toBe("disabled");
  });
});

describe("matching engine", () => {
  const jobOf = (over: Partial<ReturnType<typeof rawJob>> = {}) => {
    const n = normalizeRaw(rawJob(over));
    if (isRejected(n)) throw new Error("rejected");
    return n.job;
  };

  it("scores a strong match high with an explanation", async () => {
    const p = await readyProfile();
    const m = computeMatch({ profile: p, job: jobOf() });
    expect(m.score).toBeGreaterThanOrEqual(75);
    expect(m.hardFailures).toEqual([]);
    expect(m.reasons.length).toBeGreaterThan(1);
    expect(m.matchedSkills).toEqual(expect.arrayContaining(["Agile", "JIRA"]));
    expect(m.breakdown.location).toBe(100);
  });
  it("scores an unrelated job low", async () => {
    const p = await readyProfile();
    const m = computeMatch({ profile: p, job: jobOf({ title: "Senior Sales Executive", location: "Pune, India", description: "Drive B2B sales, lead generation and account management using Salesforce CRM. Minimum 6 years of experience. Field role in Pune, on-site. ".repeat(3) }) });
    expect(m.score).toBeLessThan(55);
  });
  it("applies hard constraints: salary, experience, exclusions, work mode", async () => {
    const p = await readyProfile();
    const lowSalary = computeMatch({ profile: p, job: jobOf({ description: rawJob().description.replace("25-32 LPA", "8-10 LPA") }) });
    expect(lowSalary.hardFailures.join(" ")).toMatch(/below your minimum/);
    expect(lowSalary.score).toBeLessThanOrEqual(45);

    const tooSenior = computeMatch({ profile: { ...p, totalExperienceYears: 2 }, job: jobOf() });
    expect(tooSenior.hardFailures.join(" ")).toMatch(/Requires 8\+ years/);

    const excluded = computeMatch({ profile: { ...p, preferences: { ...p.preferences, excludedCompanies: ["acme"] } }, job: jobOf() });
    expect(excluded.hardFailures.join(" ")).toMatch(/exclusion list/);

    const onsite = computeMatch({ profile: { ...p, preferences: { ...p.preferences, workModes: ["remote"] } }, job: jobOf({ description: rawJob().description.replace("(hybrid)", "(on-site)") }) });
    expect(onsite.hardFailures.join(" ")).toMatch(/Work mode/);
  });
  it("never counts AI-derived skills the candidate does not have", async () => {
    const p = await readyProfile();
    const withGuess: CandidateProfile = { ...p, skills: [...p.skills.filter((s) => s.key !== "jira"), { name: "JIRA", key: "jira", category: "tool", source: "ai_derived", confidence: 0.4 }] };
    const m = computeMatch({ profile: withGuess, job: jobOf() });
    expect(m.missingSkills).toContain("JIRA");
  });
  it("reports lower confidence for thin postings", async () => {
    const p = await readyProfile();
    const thin = jobOf({ description: "Looking for a project manager to join our team in Chennai. Apply now if interested in the role. We offer a great culture." });
    expect(computeMatch({ profile: p, job: thin }).confidence).not.toBe("high");
  });
  it("ranks a fresh actionable job above a stale one with equal score", async () => {
    const p = await readyProfile();
    const fresh = computeMatch({ profile: p, job: jobOf() });
    const stale = computeMatch({ profile: p, job: { ...jobOf(), status: "stale" } });
    expect(fresh.rankScore).toBeGreaterThan(stale.rankScore);
  });
});

describe("resume truthfulness (scope §29.1)", () => {
  it("deterministic tailoring is always valid and uses only verified content", async () => {
    const p = await readyProfile();
    const n = normalizeRaw(rawJob()); if (isRejected(n)) throw new Error();
    const c = deterministicTailoring(p, n.job);
    const v = validateTailored(c, p);
    expect(v.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(c.experience.length).toBe(2);
    expect(c.skills.length).toBeGreaterThan(3);
  });

  async function baseContent() {
    const p = await readyProfile();
    const n = normalizeRaw(rawJob()); if (isRejected(n)) throw new Error();
    return { p, c: deterministicTailoring(p, n.job) };
  }

  it("rejects a fabricated skill, employer, title, dates, certification and education", async () => {
    const { p, c } = await baseContent();
    const bad: TailoredResumeContent = JSON.parse(JSON.stringify(c));
    bad.skills.push("Kubernetes");
    bad.experience[0].company = "Google";
    bad.experience[1].designation = "Director of Engineering";
    bad.experience[1].period = "2010 – 2020";
    bad.certifications.push("AWS Solutions Architect");
    bad.education.push({ degree: "MBA", institution: "IIM Ahmedabad" });
    const v = validateTailored(bad, p);
    expect(v.ok).toBe(false);
    const msgs = v.issues.map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/Kubernetes/);
    expect(msgs).toMatch(/Company was changed/);
    expect(msgs).toMatch(/Job title was changed/);
    expect(msgs).toMatch(/Dates were changed/);
    expect(msgs).toMatch(/AWS Solutions Architect/);
    expect(msgs).toMatch(/Education entry/);
  });
  it("rejects invented bullets and inflated numbers", async () => {
    const { p, c } = await baseContent();
    const bad: TailoredResumeContent = JSON.parse(JSON.stringify(c));
    bad.experience[0].bullets = [
      "Led a team of 250 engineers delivering a core banking platform using Agile and Scrum", // number changed 25 -> 250
      "Architected a machine learning recommendation engine serving 10 million users", // invented
      c.experience[0].bullets[0], // legit
    ];
    const v = validateTailored(bad, p);
    const errs = v.issues.filter((i) => i.path.includes("bullets"));
    expect(errs).toHaveLength(2);
    expect(errs[0].message).toMatch(/250/);
  });
  it("catches inflated years and skills smuggled into the summary", async () => {
    const { p, c } = await baseContent();
    const bad = { ...c, summary: "Project manager with 15 years of experience skilled in Kubernetes and Terraform." };
    const msgs = validateTailored(bad, p).issues.map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/15 years/);
    expect(msgs).toMatch(/kubernetes/i);
    expect(checkClaims("I have 5 years of experience with JIRA", p, "x").filter((i) => i.severity === "error")).toEqual([]);
  });
  it("repair strips unverifiable content and yields a valid resume", async () => {
    const { p, c } = await baseContent();
    const bad: TailoredResumeContent = JSON.parse(JSON.stringify(c));
    bad.skills.push("Kubernetes");
    bad.experience[0].bullets.push("Invented a quantum computing platform saving 90% costs");
    bad.certifications.push("AWS Solutions Architect");
    bad.summary = "Expert in Terraform with 20 years experience.";
    const fixed = repairTailored(bad, p);
    expect(validateTailored(fixed, p).ok).toBe(true);
    expect(fixed.skills).not.toContain("Kubernetes");
    expect(fixed.experience[0].bullets.join(" ")).not.toMatch(/quantum/);
  });
});

describe("profile readiness (scope §11-12)", () => {
  it("asks only essential questions, then becomes ready", async () => {
    const store = await getStore();
    const base = applyParsedResume(newProfile({ uid: "u2", email: "a@b.co", name: "A B" }), deterministicParse(RESUME_TEXT), "r");
    await store.put("profiles", "u2", base);
    expect(base.status).toBe("needs_info");
    const essential = base.completeness.missing.filter((m) => m.essential).map((m) => m.field);
    expect(essential).toEqual(expect.arrayContaining(["locations", "workModes", "minSalaryLPA", "noticePeriodDays"]));
    expect(base.completeness.missing.some((m) => !m.essential)).toBe(true);

    const p = await updatePreferences("u2", { locations: ["Chennai"], workModes: ["remote"], minSalaryLPA: 0, noticePeriodDays: 0 });
    expect(p.status).toBe("ready");
    expect(p.provenance["preferences.minSalaryLPA"]).toBe("user");
    expect(p.preferences.targetRoles.length).toBeGreaterThan(0);
    expect(p.provenance["preferences.targetRoles"]).toBe("ai_derived");
  });
  it("re-uploading a resume never overwrites user answers or user-edited fields", async () => {
    const p = await readyProfile("u3");
    const edited = await saveProfile({ ...p, fullName: "Priya S.", provenance: { ...p.provenance, fullName: "user" } });
    const again = applyParsedResume(edited, deterministicParse(RESUME_TEXT), "res2");
    expect(again.fullName).toBe("Priya S.");
    expect(again.preferences.minSalaryLPA).toBe(20);
    expect(again.status).toBe("ready");
  });
});

describe("pruning long-dead jobs", () => {
  it("forgets jobs unseen for 45+ days, but keeps ones someone applied to or saved", async () => {
    const { pruneDeadJobs } = await import("../server/jobs/ingest.js");
    await ingestRawJobs([rawJob(), rawJob({ sourceJobId: "2", company: "Other Co", url: "https://boards.greenhouse.io/other/jobs/2" }), rawJob({ sourceJobId: "3", company: "Third Co", url: "https://boards.greenhouse.io/third/jobs/3" })]);
    const store = await getStore();
    const jobs = await store.query<Job>("jobs");
    const old = new Date(Date.now() - 60 * 86400000).toISOString();
    for (const j of jobs) await store.update<Job>("jobs", j.id, { status: "expired", lastVerifiedAt: old });
    await store.put("applications", "app1", { id: "app1", uid: "u1", jobId: jobs[0].id });
    await store.put("matches", `u1_${jobs[1].id}`, { id: `u1_${jobs[1].id}`, uid: "u1", jobId: jobs[1].id, saved: true });
    await store.put("matches", `u1_${jobs[2].id}`, { id: `u1_${jobs[2].id}`, uid: "u1", jobId: jobs[2].id, saved: false });
    expect(await pruneDeadJobs()).toBe(1);
    expect(await store.get("jobs", jobs[2].id)).toBeNull();
    expect(await store.get("matches", `u1_${jobs[2].id}`)).toBeNull();
    expect(await store.get("jobs", jobs[0].id)).not.toBeNull();
    expect(await store.get("jobs", jobs[1].id)).not.toBeNull();
  });
});
