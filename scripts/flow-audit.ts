// Click-through audit: opens every screen with demo data, clicks every safe button and link, and reports what a
// person would call a bug: script errors, failed API calls, clicks that do nothing, and screens that stay blank.
// Run: VITE_DEV_AUTH=true npm run build -- --outDir dist-shots; npx tsx scripts/flow-audit.ts
// (FLOW_ONLY=matches,profile to limit the screens; FLOW_DEVICE=m for a phone.)
process.env.DEV_AUTH_BYPASS = "true";
process.env.DISCOVERY_INTERVAL_MINUTES = "0";
process.env.ADMIN_EMAILS = "priya.sharma@example.com";
import fs from "node:fs";
import path from "node:path";

const { createApp } = await import("../server/app.js");
const { setStore, FileStore, getStore } = await import("../server/db/store.js");
const { runDiscovery, setConnectors } = await import("../server/jobs/discovery.js");
const { matchCandidate } = await import("../server/matching/service.js");
const { storeResume, processResume } = await import("../server/resume/process.js");
const { updatePreferences, getOrCreateProfile } = await import("../server/profile/service.js");
const { prepareApplication, updateStatus } = await import("../server/applications/service.js");
const { approveResumeVersion } = await import("../server/resume/tailor.js");
const { setProviders } = await import("../server/ai/gateway.js");
const { RESUME_TEXT, rawJob, fakeConnector } = await import("../tests/fixtures.js");
const express = (await import("express")).default;
const puppeteer = (await import("puppeteer-core")).default;

setStore(new FileStore(path.resolve("data", "mc-flow-audit.json")));
setProviders([], async () => null);
const user = { uid: "demo", email: "priya.sharma@example.com", name: "Priya Sharma" };
await getOrCreateProfile(user);
const { resume } = await storeResume(user, { buffer: Buffer.from(RESUME_TEXT), originalname: "priya.txt", mimetype: "text/plain" });
await processResume(user, resume);
await updatePreferences("demo", { locations: ["Chennai"], workModes: ["hybrid", "remote"], minSalaryLPA: 10, noticePeriodDays: 30, targetRoles: ["Senior Project Manager"] });
const body = (t: string) => `${t} Agile, Scrum, JIRA, stakeholder management, risk management, budget management. 8+ years. ` + "Lead cross-functional teams and vendor management. ".repeat(5);
const raws = ["Chennai", "Bengaluru", "Mumbai", "Pune"].flatMap((city, i) => ["Senior Project Manager", "Delivery Manager", "Program Manager"].map((title, j) => rawJob({ sourceJobId: `${i}${j}`, title, company: `Co${i}${j}`, location: `${city}, India`, url: `https://x.example/${i}${j}`, applyUrl: `https://x.example/${i}${j}`, description: body(`${title} in ${city}.`) })));
setConnectors([fakeConnector("demo", raws)]);
await runDiscovery();
await matchCandidate("demo", { notifyNew: true });
const jobs = await (await getStore()).query<any>("jobs");
const pkg = await prepareApplication("demo", jobs[0].id);
await approveResumeVersion("demo", pkg.resume!.id);
await updateStatus("demo", pkg.application.id, "applied");

const dist = path.resolve(process.env.AUDIT_DIST || "dist-shots");
const app = createApp();
app.use(express.static(dist));
app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
const server = await new Promise<import("node:http").Server>((r) => { const s = app.listen(3196, () => r(s)); });
const edge = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].find((p) => fs.existsSync(p))!;
const browser = await puppeteer.launch({ executablePath: edge, headless: true, args: ["--no-first-run", "--disable-gpu"] });

const PAGES = ["", "matches", "search", `job/${jobs[0].id}`, "applications", "interview", "insights", "resume", "profile", "settings", "employer", "admin"];
const only = process.env.FLOW_ONLY?.split(",");
const device = process.env.FLOW_DEVICE === "m" ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1280, height: 900 };
// Buttons a click-through must not press: they end the session, delete data or spend something.
const SKIP = /sign out|log out|logout|delete|erase|remove|discard|withdraw|reset|clear|reject|block|unpublish|close job|revoke|disconnect|stop|hide|not relevant|download|export|talk|call/i;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const problems: string[] = [];
let clicks = 0;

for (const route of PAGES) {
  const name = route.split("/")[0] || "home";
  if (only && !only.includes(name)) continue;
  const page = await browser.newPage();
  await page.setViewport(device);
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem("mc_analytics_consent", "denied"); localStorage.setItem("mc_tour_done", "1"); localStorage.setItem("mc_guide", JSON.stringify({ mode: "quiet", voice: false })); } catch { /* */ } });
  let where = "loading";
  const seen = new Set<string>();
  const report = (msg: string) => { const line = `[${name}] (${where}) ${msg}`; if (!seen.has(line)) { seen.add(line); problems.push(line); } };
  let netCount = 0;
  page.on("pageerror", (e) => report(`script error: ${String(e).slice(0, 160)}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|net::ERR/.test(m.text())) report(`console error: ${m.text().slice(0, 160)}`); });
  page.on("request", (r) => { if (r.url().includes("/api/")) netCount++; });
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/") && r.status() >= 400 && !/\/(analytics|health)/.test(u)) report(`${r.request().method()} ${u.split("/api")[1].slice(0, 70)} → ${r.status()}`);
  });
  const open = async () => { await page.goto("about:blank"); await page.goto(`http://localhost:3196/?dev=demo&notour&theme=dark#${route}`, { waitUntil: "networkidle0", timeout: 60000 }); await wait(500); };
  await open();
  // Blank screens
  const text = await page.evaluate(() => (document.querySelector("main")?.textContent || document.body.textContent || "").trim().length);
  if (text < 40) report("screen looks empty");

  // Every button and link on the screen, by its label.
  const labels = await page.evaluate((skipSrc) => {
    const skip = new RegExp(skipSrc, "i");
    const out: string[] = [];
    for (const e of document.querySelectorAll<HTMLElement>("main button, main a[href], main [role=tab], main summary")) {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(e).visibility === "hidden") continue;
      const label = (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50);
      if (!label || skip.test(label) || (e as HTMLAnchorElement).target === "_blank" || /^(mailto|tel):/.test(e.getAttribute("href") || "")) continue;
      if (!out.includes(label)) out.push(label);
    }
    return out.slice(0, 40);
  }, SKIP.source);

  for (const label of labels) {
    where = `click "${label}"`;
    clicks++;
    const before = netCount;
    await page.evaluate(() => { (window as any).__mut = 0; (window as any).__mo?.disconnect(); const mo = new MutationObserver((m) => { (window as any).__mut += m.length; }); mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); (window as any).__mo = mo; }).catch(() => undefined);
    const hash0 = await page.evaluate(() => location.hash).catch(() => "");
    const clicked = await page.evaluate((l) => {
      const el = [...document.querySelectorAll<HTMLElement>("main button, main a[href], main [role=tab], main summary")].find((e) => (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50) === l);
      if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true;
    }, label).catch(() => false);
    if (!clicked) continue;
    await wait(650);
    const after = await page.evaluate(() => ({ mut: (window as any).__mut || 0, hash: location.hash, dialog: Boolean(document.querySelector("[role=dialog], aside, [data-modal]")) })).catch(() => ({ mut: 1, hash: hash0, dialog: false }));
    if (after.mut === 0 && after.hash === hash0 && netCount === before) report("did nothing");
    // Get back to a clean screen for the next click.
    if (after.hash !== hash0 || after.dialog || after.mut > 40) await open();
  }
  await page.close();
}

await browser.close();
server.close();
try { fs.rmSync(path.resolve("data", "mc-flow-audit.json")); } catch { /* */ }
console.log(`${clicks} clicks, ${problems.length} problem(s)`);
for (const p of problems) console.log(" -", p);
process.exit(problems.length ? 1 : 0);
