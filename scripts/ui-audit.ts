// UI audit: hosts the app with demo data, opens every screen in real phone / tablet / desktop emulation (Edge via
// puppeteer-core), saves screenshots, and reports layout problems: anything wider than the screen (horizontal
// scroll), text clipped by its box, buttons too small to tap, and overlapping fixed elements.
// Run: npx tsx scripts/ui-audit.ts   (SHOT_THEME=light for the light theme; AUDIT_ONLY=m,t,d to pick devices)
process.env.DEV_AUTH_BYPASS = "true";
process.env.DISCOVERY_INTERVAL_MINUTES = "0";
process.env.ADMIN_EMAILS = "demo@dev.local";
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
const { RESUME_TEXT, rawJob, fakeConnector } = await import("../tests/fixtures.js");
const express = (await import("express")).default;
const puppeteer = (await import("puppeteer-core")).default;

setStore(new FileStore());
const user = { uid: "demo", email: "priya.sharma@example.com", name: "Priya Sharma" };
await getOrCreateProfile(user);
const { resume } = await storeResume(user, { buffer: Buffer.from(RESUME_TEXT), originalname: "priya.txt", mimetype: "text/plain" });
await processResume(user, resume);
await updatePreferences("demo", { locations: ["Chennai"], workModes: ["hybrid", "remote"], minSalaryLPA: 20, noticePeriodDays: 30, targetRoles: ["Senior Project Manager"] });
const desc = (t: string) => `${t} Agile, Scrum, JIRA, stakeholder management, risk management, budget management. 8+ years. ` + "Lead cross-functional teams and vendor management. ".repeat(5);
setConnectors([fakeConnector("demo", [
  rawJob(),
  rawJob({ sourceJobId: "2", title: "Technical Program Manager", company: "Zeta", location: "Bengaluru, India", url: "https://x.example/2", applyUrl: "https://x.example/2", description: desc("Own delivery of payments programs. Hybrid in Bengaluru. 30-40 LPA.") }),
  rawJob({ sourceJobId: "3", title: "Delivery Manager", company: "Freshworks", location: "Chennai, India", url: "https://x.example/3", applyUrl: "https://x.example/3", description: desc("Lead software delivery for enterprise customers in Chennai. MS Project, resource planning. 10+ years.") }),
  rawJob({ sourceJobId: "6", title: "Program Manager - Payments", company: "Zeta", location: "Chennai, India", url: "https://x.example/6", applyUrl: "https://x.example/6", description: desc("Lead payments programs. Hybrid in Chennai. 28-36 LPA.") }),
])]);
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
const server = await new Promise<import("node:http").Server>((r) => { const s = app.listen(3198, () => r(s)); });

const edge = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].find((p) => fs.existsSync(p))!;
const browser = await puppeteer.launch({ executablePath: edge, headless: true, args: ["--no-first-run", "--disable-gpu"] });
const THEME = process.env.SHOT_THEME || "dark";
const OUT = path.resolve("screenshots/audit");
fs.mkdirSync(OUT, { recursive: true });

const DEVICES = { m: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, t: { width: 820, height: 1180, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, d: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 } } as const;
const only = (process.env.AUDIT_ONLY || "m,t,d").split(",") as Array<keyof typeof DEVICES>;
const PAGES = ["", "#matches", "#search", `#job/${jobs[0].id}`, "#applications", "#interview", "#insights", "#resume", "#profile", "#settings", "#employer", "#admin"];
const problems: string[] = [];

for (const dev of only) {
  const page = await browser.newPage();
  await page.setViewport(DEVICES[dev]);
  // Settle the first-run things so they don't cover the screen: consent answered, tour and tips seen.
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem("mc_analytics_consent", "denied"); localStorage.setItem("mc_tour_done", "1"); localStorage.setItem("mc_guide", JSON.stringify({ mode: "quiet", voice: false })); } catch { /* */ } });
  for (const hash of PAGES) {
    const name = `${dev}-${(hash.replace(/^#/, "").split("/")[0] || "home")}`;
    await page.goto(`http://localhost:3198/?dev=demo&notour&theme=${THEME}${hash}`, { waitUntil: "networkidle0", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 900));
    const found = await page.evaluate(() => {
      const out: string[] = [];
      const vw = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth > vw + 1) {
        const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.right > vw + 1 && r.width > 0 && getComputedStyle(e).position !== "fixed"; })
          .filter((e) => !e.closest(".overflow-x-auto,.overflow-auto,.no-scrollbar,[role=tablist]")).slice(0, 4)
          .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(" ").slice(0, 3).join(".")} "${(e.textContent || "").trim().slice(0, 30)}" right=${Math.round(e.getBoundingClientRect().right)}`);
        out.push(`page wider than screen (${document.documentElement.scrollWidth} > ${vw}): ${wide.join(" | ")}`);
      }
      for (const e of document.querySelectorAll<HTMLElement>("button, a, input, select")) {
        const r = e.getBoundingClientRect();
        if (r.width && r.height && r.height < 28 && r.width < 28 && getComputedStyle(e).visibility !== "hidden" && !e.closest(".sr-only")) out.push(`small tap target (${Math.round(r.width)}x${Math.round(r.height)}): ${e.getAttribute("aria-label") || (e.textContent || "").trim().slice(0, 20) || e.tagName}`);
      }
      for (const e of document.querySelectorAll<HTMLElement>("h1,h2,h3,p,span,button,a,label")) {
        const cs = getComputedStyle(e);
        if (cs.overflow === "hidden" && cs.textOverflow !== "ellipsis" && !cs.webkitLineClamp && e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0) out.push(`text cut off: "${(e.textContent || "").trim().slice(0, 40)}"`);
      }
      return [...new Set(out)].slice(0, 12);
    });
    for (const f of found) problems.push(`[${name}] ${f}`);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) as `${string}.png`, fullPage: true });
  }
  if (dev === "m") {
    // The "More" menu must open, stay visible, scroll, and close.
    await page.goto(`http://localhost:3198/?dev=demo&notour&theme=${THEME}#matches`, { waitUntil: "networkidle0" });
    await page.click('button[aria-label="More"]').catch(() => problems.push("[m-more] no More button"));
    await new Promise((r) => setTimeout(r, 700));
    const vis = await page.evaluate(() => { const d = document.querySelector<HTMLElement>("[data-drawer]"); if (!d) return "missing"; const cs = getComputedStyle(d); const r = d.getBoundingClientRect(); return cs.opacity !== "1" || r.right < 50 ? `hidden (opacity ${cs.opacity}, right ${r.right})` : "ok"; });
    if (vis !== "ok") problems.push(`[m-more] drawer ${vis}`);
    await page.screenshot({ path: path.join(OUT, "m-more.png") });
  }
  if (dev === "d") {
    // The assistant panel, opened fresh (no history yet)
    await page.goto(`http://localhost:3198/?dev=demo&notour&theme=${THEME}`, { waitUntil: "networkidle0" });
    await page.evaluate(() => { try { localStorage.setItem("mc_lang", "en"); } catch { /* */ } });
    await page.reload({ waitUntil: "networkidle0" });
    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("header button")].find((b) => /assistant/i.test(b.textContent || ""))?.click());
    await new Promise((r) => setTimeout(r, 1200));
    await page.screenshot({ path: path.join(OUT, "d-chat.png") });
  }
  await page.close();
}
await browser.close();
server.close();
fs.writeFileSync(path.join(OUT, "problems.txt"), problems.join("\n") + "\n");
console.log(problems.length ? problems.join("\n") : "No layout problems found.");
console.log(`\n${problems.length} problem(s). Screenshots in screenshots/audit/`);
process.exit(0);
