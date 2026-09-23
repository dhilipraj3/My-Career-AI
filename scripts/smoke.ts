// End-to-end smoke test over real HTTP against the LIVE job sources (no mocks).
//   Self-hosted (recommended):  SELF_HOST=1 npx tsx scripts/smoke.ts
//   Against a running server:   BASE=http://localhost:3000 npx tsx scripts/smoke.ts   (server needs DEV_AUTH_BYPASS=true)
process.env.DEV_AUTH_BYPASS = "true";
process.env.DISCOVERY_INTERVAL_MINUTES = "0";
process.env.USER_RATE_LIMIT_PER_MIN = "1000";

let base = process.env.BASE || "http://localhost:3000";
if (process.env.SELF_HOST) {
  const { createApp } = await import("../server/app.js");
  const { setStore, FileStore } = await import("../server/db/store.js");
  setStore(new FileStore());
  await new Promise<void>((resolve) => createApp().listen(3199, resolve));
  base = "http://localhost:3199";
}
const { RESUME_TEXT } = await import("../tests/fixtures.js");

const H = { Authorization: `Bearer dev:smoke${Date.now() % 100000}` };
const call = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(base + path, { ...init, headers: { ...H, ...(init.json ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) }, body: init.json ? JSON.stringify(init.json) : init.body });
      return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
    } catch (e) {
      if (attempt >= 5) throw e; // transient connect errors happen while the same process is busy fetching job boards
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
};
const step = (n: string) => console.log(`\n▶ ${n}`);
const ok = (c: boolean, m: string) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) process.exitCode = 1; };

step("health & auth");
ok((await fetch(base + "/api/health")).status === 200, "health is public");
ok((await fetch(base + "/api/me")).status === 401, "me requires auth");
const bad = await fetch(base + "/api/profile/answer", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: "{not json" });
ok(bad.status === 400, `malformed JSON -> 400 (${bad.status})`);

step("upload resume");
const form = new FormData();
form.append("resume", new Blob([RESUME_TEXT], { type: "text/plain" }), "priya.txt");
const up = await call("/api/resume", { method: "POST", body: form });
ok(up.status === 202, `accepted (${up.status})`);
let profile: any;
for (let i = 0; i < 40; i++) { profile = (await call("/api/me")).body.profile; if (!["parsing", "empty"].includes(profile.status)) break; await new Promise((r) => setTimeout(r, 300)); }
ok(profile.status === "needs_info", `profile built, needs info (${profile.status})`);
ok(/Project Manager/.test(profile.currentRole), `role: ${profile.currentRole}`);
ok(profile.totalExperienceYears > 9, `experience: ${profile.totalExperienceYears} yrs`);
console.log("  questions asked:", profile.completeness.missing.filter((m: any) => m.essential).map((m: any) => m.field).join(", "));

step("answer questions");
const ans = await call("/api/profile/answer", { method: "POST", json: { text: "Chennai or Bengaluru, hybrid or remote, minimum 20 LPA, 30 days notice" } });
ok(ans.body.profile.status === "ready", `profile ready (${ans.body.profile.status})`);

step("live job search (real sources, ~1 min)");
const s = await call("/api/search", { method: "POST", json: {} });
ok(s.body.started === true, "search started");
let feed: any[] = [];
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 4000));
  const notes = (await call("/api/notifications")).body.notifications || [];
  if (notes.some((n: any) => /search finished/i.test(n.title))) break;
}
feed = (await call("/api/feed?minScore=40")).body.items || [];
ok(feed.length > 0, `feed has ${feed.length} matched jobs`);
for (const { job, match } of feed.slice(0, 8)) console.log(`  ${String(match.score).padStart(3)}%  ${job.title} @ ${job.company} (${job.city || job.location}, ${job.workMode}) [${match.confidence}]`);
if (!feed.length) { console.log("\nSMOKE TEST FAILED"); process.exit(1); }

step("job detail, tailoring, approval, tracking");
const top = feed[0];
const detail = await call(`/api/jobs/${top.job.id}`);
ok(detail.body.match.reasons.length + detail.body.match.gaps.length > 0, "match is explained");
const prep = await call(`/api/jobs/${top.job.id}/prepare`, { method: "POST", json: {} });
ok(prep.status === 201 && prep.body.resume.validation.ok, `tailored resume valid (${prep.body.resume?.generatedBy})`);
const early = await call(`/api/applications/${prep.body.application.id}/status`, { method: "POST", json: { status: "applied" } });
ok(early.status === 409, "cannot apply before approving resume");
ok((await call(`/api/resume-versions/${prep.body.resume.id}/approve`, { method: "POST", json: {} })).body.approved === true, "resume approved");
ok((await call(`/api/applications/${prep.body.application.id}/status`, { method: "POST", json: { status: "applied" } })).status === 200, "marked applied");

step("agent (basic mode: no AI keys configured)");
const chat = await call("/api/agent/chat", { method: "POST", json: { message: "Show today's best opportunities" } });
ok(chat.status === 200 && chat.body.mode === "basic" && chat.body.cards.length > 0, `basic-mode reply with ${chat.body.cards?.length} job cards`);
const found = await call("/api/agent/chat", { method: "POST", json: { message: "Find project manager jobs in Bengaluru" } });
ok(found.status === 200, `search via chat: ${found.body.reply?.slice(0, 80)}`);

console.log(process.exitCode ? "\nSMOKE TEST FAILED" : "\nSMOKE TEST PASSED");
process.exit(process.exitCode ?? 0);
